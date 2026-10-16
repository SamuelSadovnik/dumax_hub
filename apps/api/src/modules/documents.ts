import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import type { Document, DocumentSigner, Prisma } from '@prisma/client';
import { prisma, userLite } from '../lib/prisma';
import { authenticate, isHR } from '../lib/auth';
import { badRequest, forbidden, notFound, parse } from '../lib/http';
import { readPrivate, saveUpload } from '../lib/storage';
import { decryptText, encryptText } from '../lib/crypto';
import { mailLayout, sendMail } from '../lib/mailer';
import { notify } from '../lib/notify';
import { brDateTimeLabel } from '../lib/dates';
import { env } from '../env';

/**
 * Documentos para assinatura eletrônica.
 *
 * Validade: assinatura eletrônica simples/avançada (Lei 14.063/2020 e MP 2.200-2/2001, art. 10 §2º)
 * — vale entre as partes que aceitam o meio. A trilha de auditoria guarda: quem, quando, IP,
 * navegador, imagem/nome da assinatura e o SHA-256 do PDF original.
 * Para documentos que exigem ICP-Brasil, integre um provedor (Clicksign, D4Sign, DocuSign).
 */

const signerInput = z.object({
  userId: z.string().optional(),
  name: z.string().min(2).optional(),
  email: z.string().email().optional(),
  cpf: z.string().max(20).optional(),
  role: z.string().max(60).default('Signatário'),
});

const docInclude = {
  createdBy: { select: userLite },
  signers: { orderBy: { order: 'asc' as const } },
  events: { orderBy: { createdAt: 'asc' as const } },
} satisfies Prisma.DocumentInclude;

type DocWithSigners = Document & { signers: DocumentSigner[] };

const signUrl = (token: string) => `${env.WEB_URL}/assinar/${token}`;
const clientIp = (req: FastifyRequest) => req.ip;

/** Signatários que podem assinar agora (todos, ou o próximo da fila se sequencial) */
function signersOnTurn(doc: DocWithSigners) {
  const pending = doc.signers.filter((s) => s.status === 'PENDING');
  if (!doc.sequential) return pending;
  const minOrder = Math.min(...pending.map((s) => s.order));
  return pending.filter((s) => s.order === minOrder);
}

/** Avisa quem está na vez (notificação no Hub para colaboradores + e-mail para todos) */
async function notifySigners(doc: DocWithSigners, senderName: string, reminder = false) {
  const turn = signersOnTurn(doc);
  for (const s of turn) {
    if (s.userId) {
      await notify([s.userId], {
        type: 'document.sign',
        title: `${reminder ? 'Lembrete: ' : ''}${senderName} enviou um documento para você assinar`,
        body: doc.title,
        link: `/assinar/${s.token}`,
      });
    }
    await sendMail(
      s.email,
      `${reminder ? 'Lembrete — ' : ''}Documento para assinar: ${doc.title}`,
      mailLayout(
        `Olá, ${s.name.split(' ')[0]}`,
        [
          `${senderName} enviou o documento "${doc.title}" para você assinar eletronicamente.`,
          ...(doc.message ? [doc.message] : []),
          ...(doc.dueAt ? [`Prazo: ${brDateTimeLabel(doc.dueAt)}`] : []),
        ],
        { label: 'Revisar e assinar', url: signUrl(s.token) },
      ),
    ).catch(() => undefined);
    await prisma.documentSigner.update({ where: { id: s.id }, data: { lastNotifiedAt: new Date() } });
  }
  return turn.length;
}

/** Lembretes a cada 2 dias e expiração por prazo (chamado pelo agendador) */
export async function documentHousekeeping() {
  const now = new Date();
  const expired = await prisma.document.updateMany({ where: { status: 'PENDING', dueAt: { lt: now } }, data: { status: 'EXPIRED' } });
  const pending = await prisma.document.findMany({
    where: { status: 'PENDING' },
    include: { signers: { orderBy: { order: 'asc' } }, createdBy: { select: { name: true } } },
  });
  let reminded = 0;
  for (const d of pending) {
    const stale = signersOnTurn(d).some((s) => !s.lastNotifiedAt || now.getTime() - s.lastNotifiedAt.getTime() > 48 * 3600000);
    if (stale) {
      reminded += await notifySigners(d, d.createdBy.name, true);
      await prisma.documentEvent.create({ data: { documentId: d.id, type: 'REMINDED', actorName: 'Sistema' } });
    }
  }
  return { expired: expired.count, reminded };
}

/** Registra assinatura ou recusa (comum às rotas interna e pública) */
async function signAs(
  signer: DocumentSigner & { document: DocWithSigners & { createdBy: { id: string; name: string } } },
  req: FastifyRequest,
  action: { type: 'SIGN'; signatureImage?: string; signatureText: string; cpf?: string } | { type: 'DECLINE'; reason: string },
) {
  const doc = signer.document;
  if (doc.status !== 'PENDING') throw badRequest('Este documento não está mais aguardando assinaturas');
  if (signer.status !== 'PENDING') throw badRequest('Você já respondeu este documento');
  if (!signersOnTurn(doc).some((s) => s.id === signer.id)) throw badRequest('Ainda não é a sua vez de assinar (assinatura em ordem)');

  const ip = clientIp(req);
  const userAgent = String(req.headers['user-agent'] ?? '').slice(0, 300);

  if (action.type === 'DECLINE') {
    await prisma.$transaction([
      prisma.documentSigner.update({ where: { id: signer.id }, data: { status: 'DECLINED', declinedAt: new Date(), declineReason: action.reason, ip, userAgent } }),
      prisma.document.update({ where: { id: doc.id }, data: { status: 'CANCELED', canceledAt: new Date() } }),
      prisma.documentEvent.create({ data: { documentId: doc.id, type: 'DECLINED', actorName: signer.name, signerId: signer.id, ip } }),
    ]);
    await notify([doc.createdById], { type: 'document.declined', title: `${signer.name} recusou assinar`, body: `${doc.title}: ${action.reason}`, link: `/documentos/${doc.id}` });
    return { status: 'DECLINED' as const };
  }

  if (action.signatureImage && (!action.signatureImage.startsWith('data:image/png;base64,') || action.signatureImage.length > 400_000)) {
    throw badRequest('Assinatura inválida');
  }
  await prisma.$transaction([
    prisma.documentSigner.update({
      where: { id: signer.id },
      data: {
        status: 'SIGNED',
        signedAt: new Date(),
        signatureImage: encryptText(action.signatureImage),
        signatureText: action.signatureText,
        cpf: action.cpf ? encryptText(action.cpf) : signer.cpf,
        ip,
        userAgent,
      },
    }),
    prisma.documentEvent.create({ data: { documentId: doc.id, type: 'SIGNED', actorName: signer.name, signerId: signer.id, ip } }),
  ]);

  const fresh = await prisma.document.findUniqueOrThrow({ where: { id: doc.id }, include: { signers: { orderBy: { order: 'asc' } } } });
  if (fresh.signers.every((s) => s.status === 'SIGNED')) {
    await prisma.$transaction([
      prisma.document.update({ where: { id: doc.id }, data: { status: 'COMPLETED', completedAt: new Date() } }),
      prisma.documentEvent.create({ data: { documentId: doc.id, type: 'COMPLETED', actorName: 'Sistema' } }),
    ]);
    const internal = fresh.signers.map((s) => s.userId).filter((x): x is string => Boolean(x));
    await notify([doc.createdById, ...internal], { type: 'document.completed', title: 'Documento assinado por todos ✓', body: doc.title, link: `/documentos/${doc.id}` });
    for (const s of fresh.signers.filter((x) => !x.userId)) {
      await sendMail(s.email, `Documento assinado: ${doc.title}`, mailLayout('Assinaturas concluídas', [`Todas as partes assinaram "${doc.title}".`], { label: 'Ver comprovante', url: signUrl(s.token) })).catch(() => undefined);
    }
    return { status: 'COMPLETED' as const };
  }
  await notify([doc.createdById], { type: 'document.signed', title: `${signer.name} assinou`, body: doc.title, link: `/documentos/${doc.id}` });
  if (doc.sequential) await notifySigners(fresh, doc.createdBy.name);
  return { status: 'SIGNED' as const };
}

const publicDoc = (doc: DocWithSigners & { createdBy: { name: string } }) => ({
  id: doc.id,
  title: doc.title,
  message: doc.message,
  category: doc.category,
  status: doc.status,
  fileName: doc.fileName,
  fileHash: doc.fileHash,
  sequential: doc.sequential,
  dueAt: doc.dueAt,
  createdAt: doc.createdAt,
  completedAt: doc.completedAt,
  createdBy: doc.createdBy.name,
  signers: doc.signers.map((s) => ({ id: s.id, name: s.name, role: s.role, order: s.order, status: s.status, signedAt: s.signedAt })),
});

export async function documentRoutes(app: FastifyInstance) {
  // ══════════════ Público (link de assinatura) ══════════════
  const loadByToken = async (token: string) => {
    const signer = await prisma.documentSigner.findUnique({
      where: { token },
      include: { document: { include: { signers: { orderBy: { order: 'asc' } }, createdBy: { select: { id: true, name: true } } } } },
    });
    if (!signer) throw notFound('Link de assinatura inválido');
    return signer;
  };

  app.get('/public/sign/:token', async (req) => {
    const { token } = req.params as { token: string };
    const signer = await loadByToken(token);
    if (!signer.viewedAt) {
      await prisma.documentSigner.update({ where: { id: signer.id }, data: { viewedAt: new Date() } });
      await prisma.documentEvent.create({ data: { documentId: signer.documentId, type: 'VIEWED', actorName: signer.name, signerId: signer.id, ip: clientIp(req) } });
    }
    return {
      document: publicDoc(signer.document),
      me: { id: signer.id, name: signer.name, email: signer.email, cpf: decryptText(signer.cpf), role: signer.role, status: signer.status, signedAt: signer.signedAt },
      canSign: signer.document.status === 'PENDING' && signer.status === 'PENDING' && signersOnTurn(signer.document).some((s) => s.id === signer.id),
    };
  });

  app.get('/public/sign/:token/file', async (req, reply) => {
    const { token } = req.params as { token: string };
    const signer = await loadByToken(token);
    reply.type('application/pdf').header('Content-Disposition', `inline; filename="${encodeURIComponent(signer.document.fileName)}"`);
    return reply.send(await readPrivate(signer.document.filePath));
  });

  app.post('/public/sign/:token', async (req) => {
    const { token } = req.params as { token: string };
    const body = parse(
      z.object({
        signatureText: z.string().min(3, 'Digite seu nome completo'),
        signatureImage: z.string().optional(),
        cpf: z.string().max(20).optional(),
        accept: z.literal(true, { errorMap: () => ({ message: 'É preciso confirmar que leu e concorda' }) }),
      }),
      req.body,
    );
    const signer = await loadByToken(token);
    return signAs(signer, req, { type: 'SIGN', signatureText: body.signatureText, signatureImage: body.signatureImage, cpf: body.cpf });
  });

  app.post('/public/sign/:token/decline', async (req) => {
    const { token } = req.params as { token: string };
    const { reason } = parse(z.object({ reason: z.string().min(3, 'Informe o motivo').max(1000) }), req.body);
    return signAs(await loadByToken(token), req, { type: 'DECLINE', reason });
  });

  /** Verificação pública de autenticidade (código do documento + hash) */
  app.get('/public/documents/:id/verify', async (req) => {
    const { id } = req.params as { id: string };
    const doc = await prisma.document.findUnique({ where: { id }, include: { signers: { orderBy: { order: 'asc' } }, createdBy: { select: { name: true } } } });
    if (!doc) throw notFound('Documento não encontrado');
    return publicDoc(doc);
  });

  // ══════════════ Autenticado ══════════════
  app.register(async (r) => {
    r.addHook('preHandler', authenticate);

    const canView = (doc: DocWithSigners, userId: string, hr: boolean) => hr || doc.createdById === userId || doc.signers.some((s) => s.userId === userId);

    r.get('/documents', async (req) => {
      const q = parse(z.object({ box: z.enum(['to_sign', 'sent', 'signed', 'all']).default('to_sign') }), req.query);
      const me = req.auth.id;
      const where: Prisma.DocumentWhereInput =
        q.box === 'to_sign' ? { status: 'PENDING', signers: { some: { userId: me, status: 'PENDING' } } }
        : q.box === 'sent' ? { createdById: me }
        : q.box === 'signed' ? { signers: { some: { userId: me, status: 'SIGNED' } } }
        : isHR(req.auth) ? {} : { OR: [{ createdById: me }, { signers: { some: { userId: me } } }] };
      const docs = await prisma.document.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 200,
        include: { createdBy: { select: userLite }, signers: { orderBy: { order: 'asc' } } },
      });
      return docs.map((d) => ({
        ...d,
        signers: d.signers.map(({ token, signatureImage: _s, ip: _i, userAgent: _u, cpf: _c, ...s }) => ({ ...s, myToken: s.userId === me ? token : undefined })),
        myTurn: d.status === 'PENDING' && signersOnTurn(d).some((s) => s.userId === me),
      }));
    });

    r.get('/documents/counts', async (req) => {
      const me = req.auth.id;
      const [toSign, waiting] = await Promise.all([
        prisma.document.count({ where: { status: 'PENDING', signers: { some: { userId: me, status: 'PENDING' } } } }),
        prisma.document.count({ where: { status: 'PENDING', createdById: me } }),
      ]);
      return { toSign, waiting };
    });

    /** Envio: multipart com "file" (PDF) + campos; signers = JSON */
    r.post('/documents', async (req) => {
      let saved: Awaited<ReturnType<typeof saveUpload>> | null = null;
      const fields: Record<string, string> = {};
      for await (const part of req.parts()) {
        if (part.type === 'file') {
          if (saved) {
            part.file.resume();
            continue;
          }
          saved = await saveUpload(part, { folder: 'documents', allowedExt: ['.pdf'] });
        } else fields[part.fieldname] = String(part.value ?? '');
      }
      if (!saved) throw badRequest('Anexe o PDF do documento');

      const data = parse(
        z.object({
          title: z.string().min(3, 'Dê um título ao documento').max(200),
          message: z.string().max(3000).optional(),
          category: z.string().max(60).default('Outro'),
          dueAt: z.string().optional(),
          sequential: z.enum(['true', 'false']).default('false'),
          signers: z.string(),
        }),
        fields,
      );
      let signersRaw: unknown;
      try {
        signersRaw = JSON.parse(data.signers);
      } catch {
        throw badRequest('Lista de signatários inválida');
      }
      const signers = parse(z.array(signerInput).min(1, 'Adicione pelo menos um signatário').max(20), signersRaw);

      // resolve colaboradores internos (nome/e-mail vêm do cadastro)
      const internalIds = signers.map((s) => s.userId).filter((x): x is string => Boolean(x));
      const users = await prisma.user.findMany({ where: { id: { in: internalIds }, active: true }, select: { id: true, name: true, email: true } });
      const rows = signers.map((s, i) => {
        const u = s.userId ? users.find((x) => x.id === s.userId) : null;
        if (s.userId && !u) throw badRequest('Colaborador signatário inválido');
        if (!u && (!s.name || !s.email)) throw badRequest('Signatário externo precisa de nome e e-mail');
        return {
          userId: u?.id ?? null,
          name: u?.name ?? s.name!,
          email: (u?.email ?? s.email!).toLowerCase(),
          cpf: s.cpf ? encryptText(s.cpf) : null,
          role: s.role,
          order: data.sequential === 'true' ? i : 0,
          token: randomBytes(24).toString('base64url'),
        };
      });

      const doc = await prisma.document.create({
        data: {
          title: data.title,
          message: data.message || null,
          category: data.category,
          dueAt: data.dueAt ? new Date(data.dueAt) : null,
          sequential: data.sequential === 'true',
          filePath: saved.key,
          fileName: saved.name,
          fileSize: saved.size,
          fileHash: saved.sha256,
          createdById: req.auth.id,
          signers: { create: rows },
          events: { create: [{ type: 'CREATED', actorName: req.auth.name, ip: clientIp(req) }, { type: 'SENT', actorName: req.auth.name }] },
        },
        include: docInclude,
      });
      await notifySigners(doc, req.auth.name);
      return doc;
    });

    r.get('/documents/:id', async (req) => {
      const { id } = req.params as { id: string };
      const doc = await prisma.document.findUnique({ where: { id }, include: docInclude });
      if (!doc) throw notFound('Documento não encontrado');
      if (!canView(doc, req.auth.id, isHR(req.auth))) throw forbidden();
      const owner = doc.createdById === req.auth.id || isHR(req.auth);
      return {
        ...doc,
        // o criador vê os links para reenviar manualmente; cada signatário vê só o próprio
        signers: doc.signers.map(({ token, ...s }) => ({ ...s, cpf: decryptText(s.cpf), signatureImage: decryptText(s.signatureImage), signUrl: owner || s.userId === req.auth.id ? signUrl(token) : undefined, myToken: s.userId === req.auth.id ? token : undefined })),
        canManage: owner,
      };
    });

    r.get('/documents/:id/file', async (req, reply) => {
      const { id } = req.params as { id: string };
      const doc = await prisma.document.findUnique({ where: { id }, include: { signers: true } });
      if (!doc) throw notFound();
      if (!canView(doc, req.auth.id, isHR(req.auth))) throw forbidden();
      reply.type('application/pdf').header('Content-Disposition', `inline; filename="${encodeURIComponent(doc.fileName)}"`);
      return reply.send(await readPrivate(doc.filePath));
    });

    r.post('/documents/:id/remind', async (req) => {
      const { id } = req.params as { id: string };
      const doc = await prisma.document.findUnique({ where: { id }, include: { signers: { orderBy: { order: 'asc' } } } });
      if (!doc) throw notFound();
      if (doc.createdById !== req.auth.id && !isHR(req.auth)) throw forbidden();
      if (doc.status !== 'PENDING') throw badRequest('Documento não está pendente');
      const n = await notifySigners(doc, req.auth.name, true);
      await prisma.documentEvent.create({ data: { documentId: id, type: 'REMINDED', actorName: req.auth.name } });
      return { reminded: n };
    });

    r.post('/documents/:id/cancel', async (req) => {
      const { id } = req.params as { id: string };
      const doc = await prisma.document.findUnique({ where: { id }, include: { signers: true } });
      if (!doc) throw notFound();
      if (doc.createdById !== req.auth.id && !isHR(req.auth)) throw forbidden();
      if (doc.status !== 'PENDING') throw badRequest('Só documentos pendentes podem ser cancelados');
      await prisma.$transaction([
        prisma.document.update({ where: { id }, data: { status: 'CANCELED', canceledAt: new Date() } }),
        prisma.documentEvent.create({ data: { documentId: id, type: 'CANCELED', actorName: req.auth.name } }),
      ]);
      const internal = doc.signers.map((s) => s.userId).filter((x): x is string => Boolean(x));
      await notify(internal, { type: 'document.canceled', title: 'Documento cancelado', body: doc.title, link: `/documentos/${id}` });
      return { ok: true };
    });
  });
}
