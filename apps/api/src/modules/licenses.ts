import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { License, Prisma } from '@prisma/client';
import { LICENSE_CATEGORY_LABEL, daysUntil, licenseState } from '@dumax/shared';
import { prisma, userLite } from '../lib/prisma';
import { authenticate, isHR, type AuthUser } from '../lib/auth';
import { badRequest, forbidden, notFound, parse } from '../lib/http';
import { mimeOf, readPrivate, saveUpload } from '../lib/storage';
import { notify } from '../lib/notify';
import { mailLayout, sendMail } from '../lib/mailer';
import { brDateKey, dateOnly } from '../lib/dates';
import { env } from '../env';

const categoryEnum = z.enum(['ALVARA', 'AVCB', 'AMBIENTAL', 'SANITARIA', 'CERTIFICADO_DIGITAL', 'SOFTWARE', 'CONTRATO', 'SEGURO', 'OUTRO']);
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida');

const licenseInput = z.object({
  name: z.string().min(2, 'Informe o nome').max(200),
  category: categoryEnum.default('OUTRO'),
  number: z.string().max(100).nullish(),
  issuer: z.string().max(200).nullish(),
  description: z.string().max(3000).nullish(),
  issuedAt: dateStr.nullish(),
  expiresAt: dateStr,
  responsibleId: z.string({ required_error: 'Escolha o responsável' }),
  backupId: z.string().nullish(),
  alertDays: z.array(z.number().int().min(0).max(730)).max(10).default([60, 30, 15, 7, 1]),
  notifyEmails: z.array(z.string().email()).max(10).default([]),
  notifyAdmins: z.boolean().default(true),
  cost: z.number().nonnegative().nullish(),
});

const include = {
  responsible: { select: userLite },
  backup: { select: userLite },
  renewals: { orderBy: { createdAt: 'desc' as const }, include: { renewedBy: { select: userLite } } },
} satisfies Prisma.LicenseInclude;

function decorate<L extends License>(l: L) {
  const daysLeft = daysUntil(l.expiresAt, brDateKey());
  return { ...l, daysLeft, state: licenseState(daysLeft, l.alertDays) };
}

const canEdit = (me: AuthUser, l: { responsibleId: string; backupId: string | null }) =>
  isHR(me) || me.role === 'ADMIN' || l.responsibleId === me.id || l.backupId === me.id;

/** Lê multipart: campo "data" (JSON) + arquivo opcional "file" */
async function readMultipart(req: FastifyRequest) {
  let saved: Awaited<ReturnType<typeof saveUpload>> | null = null;
  let json: unknown = {};
  if (!req.isMultipart()) return { json: req.body, saved };
  for await (const part of req.parts()) {
    if (part.type === 'file') {
      if (saved) {
        part.file.resume();
        continue;
      }
      saved = await saveUpload(part, { folder: 'licenses', allowedExt: ['.pdf', '.png', '.jpg', '.jpeg'] });
    } else if (part.fieldname === 'data') {
      try {
        json = JSON.parse(String(part.value));
      } catch {
        throw badRequest('Dados inválidos');
      }
    }
  }
  return { json, saved };
}

/**
 * Avisos de vencimento. Para cada licença, dispara o menor limite já atingido
 * (ex.: faltando 6 dias com alertas [30, 7, 1] → avisa "7 dias") uma única vez
 * por data de vencimento. Também avisa no dia em que vence.
 */
export async function runLicenseAlerts() {
  const today = brDateKey();
  const licenses = await prisma.license.findMany({
    where: { archived: false },
    include: { responsible: { select: { id: true, name: true, email: true } }, backup: { select: { id: true, email: true } } },
  });
  const admins = await prisma.user.findMany({ where: { active: true, role: { in: ['ADMIN', 'HR'] } }, select: { id: true } });
  let sent = 0;

  for (const l of licenses) {
    const left = daysUntil(l.expiresAt, today);
    const thresholds = [...new Set([...l.alertDays, 0])].sort((a, b) => a - b);
    const crossed = thresholds.filter((t) => left <= t);
    if (!crossed.length) continue;
    const target = crossed[0]; // o mais urgente
    const already = await prisma.licenseAlertLog.findUnique({
      where: { licenseId_expiresAt_daysBefore: { licenseId: l.id, expiresAt: l.expiresAt, daysBefore: target } },
    });
    if (already) continue;
    // registra todos os limites ultrapassados para não reenviar os maiores depois
    await prisma.licenseAlertLog.createMany({
      data: crossed.map((d) => ({ licenseId: l.id, expiresAt: l.expiresAt, daysBefore: d })),
      skipDuplicates: true,
    });

    const when = left < 0 ? `venceu há ${-left} dia(s)` : left === 0 ? 'vence hoje' : `vence em ${left} dia(s)`;
    const title = `${left <= 0 ? '⛔' : '⚠️'} ${l.name} ${when}`;
    const recipients = [l.responsibleId, ...(l.backupId ? [l.backupId] : []), ...(l.notifyAdmins ? admins.map((a) => a.id) : [])];
    await notify(recipients, { type: 'license.expiring', title, body: `${LICENSE_CATEGORY_LABEL[l.category]} · responsável: ${l.responsible.name}`, link: `/licencas?id=${l.id}` });

    const emails = [l.responsible.email, l.backup?.email, ...l.notifyEmails].filter((e): e is string => Boolean(e));
    for (const to of new Set(emails)) {
      await sendMail(
        to,
        title.replace(/^\S+ /, ''),
        mailLayout(
          title.replace(/^\S+ /, ''),
          [
            `${LICENSE_CATEGORY_LABEL[l.category]}${l.number ? ` nº ${l.number}` : ''}${l.issuer ? ` — ${l.issuer}` : ''}.`,
            `Vencimento: ${l.expiresAt.toISOString().slice(0, 10).split('-').reverse().join('/')}.`,
            `Responsável pela renovação: ${l.responsible.name}.`,
          ],
          { label: 'Abrir no Hub', url: `${env.WEB_URL}/licencas?id=${l.id}` },
        ),
      ).catch(() => undefined);
    }
    sent++;
  }
  return { checked: licenses.length, sent };
}

export async function licenseRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  /** RH/admin veem todas; os demais, as que estão sob sua responsabilidade */
  app.get('/', async (req) => {
    const q = parse(z.object({ archived: z.coerce.boolean().default(false) }), req.query);
    const mine = !isHR(req.auth);
    const list = await prisma.license.findMany({
      where: { archived: q.archived, ...(mine ? { OR: [{ responsibleId: req.auth.id }, { backupId: req.auth.id }] } : {}) },
      orderBy: { expiresAt: 'asc' },
      include,
    });
    return list.map(decorate);
  });

  app.get('/summary', async (req) => {
    const mine = !isHR(req.auth);
    const list = (
      await prisma.license.findMany({
        where: { archived: false, ...(mine ? { OR: [{ responsibleId: req.auth.id }, { backupId: req.auth.id }] } : {}) },
      })
    ).map(decorate);
    return {
      total: list.length,
      expired: list.filter((l) => l.state === 'EXPIRED').length,
      expiring: list.filter((l) => l.state === 'EXPIRING').length,
      next: list.filter((l) => l.daysLeft >= 0).slice(0, 5).map((l) => ({ id: l.id, name: l.name, daysLeft: l.daysLeft, expiresAt: l.expiresAt })),
    };
  });

  app.post('/', async (req) => {
    if (!isHR(req.auth) && req.auth.role !== 'MANAGER') throw forbidden('Só RH, admin e gestores cadastram licenças');
    const { json, saved } = await readMultipart(req);
    const body = parse(licenseInput, json);
    const l = await prisma.license.create({
      data: {
        ...body,
        issuedAt: body.issuedAt ? dateOnly(body.issuedAt) : null,
        expiresAt: dateOnly(body.expiresAt),
        alertDays: [...new Set(body.alertDays)].sort((a, b) => b - a),
        filePath: saved?.key,
        fileName: saved?.name,
      },
      include,
    });
    if (body.responsibleId !== req.auth.id) {
      await notify([body.responsibleId], { type: 'license.assigned', title: `Você é responsável pela licença "${l.name}"`, body: `Vence em ${l.expiresAt.toISOString().slice(0, 10).split('-').reverse().join('/')}`, link: `/licencas?id=${l.id}` });
    }
    return decorate(l);
  });

  app.patch('/:id', async (req) => {
    const { id } = req.params as { id: string };
    const current = await prisma.license.findUnique({ where: { id } });
    if (!current) throw notFound('Licença não encontrada');
    if (!canEdit(req.auth, current)) throw forbidden();
    const { json, saved } = await readMultipart(req);
    const body = parse(licenseInput.partial().extend({ archived: z.boolean().optional() }), json);
    const l = await prisma.license.update({
      where: { id },
      data: {
        ...body,
        issuedAt: body.issuedAt === undefined ? undefined : body.issuedAt ? dateOnly(body.issuedAt) : null,
        expiresAt: body.expiresAt ? dateOnly(body.expiresAt) : undefined,
        alertDays: body.alertDays ? [...new Set(body.alertDays)].sort((a, b) => b - a) : undefined,
        ...(saved ? { filePath: saved.key, fileName: saved.name } : {}),
      },
      include,
    });
    return decorate(l);
  });

  /** Renovação: nova validade + comprovante; guarda histórico */
  app.post('/:id/renew', async (req) => {
    const { id } = req.params as { id: string };
    const current = await prisma.license.findUnique({ where: { id } });
    if (!current) throw notFound('Licença não encontrada');
    if (!canEdit(req.auth, current)) throw forbidden('Só o responsável, o substituto ou o RH renovam');
    const { json, saved } = await readMultipart(req);
    const body = parse(z.object({ newExpiresAt: dateStr, note: z.string().max(2000).optional(), number: z.string().max(100).optional() }), json);
    const newDate = dateOnly(body.newExpiresAt);
    if (newDate <= current.expiresAt) throw badRequest('A nova validade precisa ser depois da atual');
    await prisma.$transaction([
      prisma.licenseRenewal.create({
        data: { licenseId: id, previousExpiresAt: current.expiresAt, newExpiresAt: newDate, renewedById: req.auth.id, note: body.note, filePath: saved?.key, fileName: saved?.name },
      }),
      prisma.license.update({
        where: { id },
        data: { expiresAt: newDate, number: body.number ?? undefined, ...(saved ? { filePath: saved.key, fileName: saved.name } : {}) },
      }),
    ]);
    const l = await prisma.license.findUniqueOrThrow({ where: { id }, include });
    const others = [l.responsibleId, l.backupId].filter((x): x is string => Boolean(x) && x !== req.auth.id);
    await notify(others, { type: 'license.renewed', title: `${l.name} renovada ✓`, body: `Nova validade: ${body.newExpiresAt.split('-').reverse().join('/')}`, link: `/licencas?id=${id}` });
    return decorate(l);
  });

  app.get('/:id/file', async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = parse(z.object({ renewalId: z.string().optional() }), req.query);
    const l = await prisma.license.findUnique({ where: { id } });
    if (!l) throw notFound();
    if (!canEdit(req.auth, l) && req.auth.role !== 'MANAGER') throw forbidden();
    let key = l.filePath;
    let name = l.fileName;
    if (q.renewalId) {
      const r = await prisma.licenseRenewal.findFirst({ where: { id: q.renewalId, licenseId: id } });
      key = r?.filePath ?? null;
      name = r?.fileName ?? null;
    }
    if (!key) throw notFound('Sem arquivo anexado');
    reply.type(mimeOf(key)).header('Content-Disposition', `inline; filename="${encodeURIComponent(name ?? 'arquivo')}"`);
    return reply.send(await readPrivate(key));
  });

  app.delete('/:id', async (req) => {
    if (!isHR(req.auth)) throw forbidden();
    const { id } = req.params as { id: string };
    await prisma.license.delete({ where: { id } });
    return { ok: true };
  });

  app.post('/run-alerts', async (req) => {
    if (!isHR(req.auth)) throw forbidden();
    return runLicenseAlerts();
  });
}
