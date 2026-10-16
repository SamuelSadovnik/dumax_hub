import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AuthUser } from '../lib/auth';
import { prisma, userLite } from '../lib/prisma';
import { authenticate, isHR } from '../lib/auth';
import { badRequest, forbidden, notFound, parse } from '../lib/http';
import { notify } from '../lib/notify';

const itemInclude = { author: { select: userLite }, owner: { select: userLite } } as const;
const meetingInclude = { items: { orderBy: { createdAt: 'asc' as const }, include: itemInclude } } as const;

/** O par gestor ↔ pessoa (só gestor direto) */
async function pairOf(meId: string, otherId: string) {
  const [me, other] = await Promise.all([
    prisma.user.findUnique({ where: { id: meId }, select: { id: true, managerId: true } }),
    prisma.user.findUnique({ where: { id: otherId }, select: { id: true, managerId: true, active: true } }),
  ]);
  if (!me || !other) return null;
  if (other.managerId === me.id) return { managerId: me.id, reportId: other.id };
  if (me.managerId === other.id) return { managerId: other.id, reportId: me.id };
  return null;
}

async function loadMeeting(user: AuthUser, id: string) {
  const m = await prisma.oneOnOne.findUnique({ where: { id } });
  if (!m) throw notFound('1:1 não encontrado');
  if (m.managerId !== user.id && m.reportId !== user.id && !isHR(user)) throw forbidden();
  return m;
}

async function pairSummary(managerId: string, reportId: string) {
  const now = new Date();
  const [next, last, openActions] = await Promise.all([
    prisma.oneOnOne.findFirst({ where: { managerId, reportId, status: 'OPEN', scheduledAt: { gte: new Date(now.getTime() - 12 * 3600000) } }, orderBy: { scheduledAt: 'asc' } }),
    prisma.oneOnOne.findFirst({ where: { managerId, reportId, OR: [{ status: 'DONE' }, { scheduledAt: { lt: now } }] }, orderBy: { scheduledAt: 'desc' } }),
    prisma.oneOnOneItem.count({ where: { kind: 'ACTION', done: false, oneOnOne: { managerId, reportId } } }),
  ]);
  return { next, last, openActions };
}

/** 1:1 entre gestor e pessoa: pauta compartilhada, itens de ação e histórico (como no Lattice) */
export async function oneOnOneRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  /** Minha visão: meu time (como gestor) e meu gestor (como pessoa) */
  app.get('/', async (req) => {
    const me = await prisma.user.findUniqueOrThrow({ where: { id: req.auth.id }, select: { managerId: true, manager: { select: userLite } } });
    const reports = await prisma.user.findMany({ where: { managerId: req.auth.id, active: true }, select: userLite, orderBy: { name: 'asc' } });
    return {
      reports: await Promise.all(reports.map(async (u) => ({ user: u, ...(await pairSummary(req.auth.id, u.id)) }))),
      manager: me.manager ? { user: me.manager, ...(await pairSummary(me.manager.id, req.auth.id)) } : null,
    };
  });

  /** Histórico do par + itens de ação em aberto */
  app.get('/with/:userId', async (req) => {
    const { userId } = req.params as { userId: string };
    const pair = await pairOf(req.auth.id, userId);
    if (!pair) throw forbidden('O 1:1 é entre a pessoa e o gestor direto');
    const [manager, report, meetings, openActions] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: pair.managerId }, select: userLite }),
      prisma.user.findUniqueOrThrow({ where: { id: pair.reportId }, select: userLite }),
      prisma.oneOnOne.findMany({ where: pair, orderBy: { scheduledAt: 'desc' }, take: 30, include: meetingInclude }),
      prisma.oneOnOneItem.findMany({ where: { kind: 'ACTION', done: false, oneOnOne: pair }, orderBy: [{ dueAt: { sort: 'asc', nulls: 'last' } }], include: itemInclude }),
    ]);
    return { manager, report, meetings, openActions };
  });

  /** Marca um novo 1:1 */
  app.post('/with/:userId', async (req) => {
    const { userId } = req.params as { userId: string };
    const pair = await pairOf(req.auth.id, userId);
    if (!pair) throw forbidden('O 1:1 é entre a pessoa e o gestor direto');
    const body = parse(z.object({ scheduledAt: z.coerce.date() }), req.body);
    const m = await prisma.oneOnOne.create({ data: { ...pair, scheduledAt: body.scheduledAt }, include: meetingInclude });
    const when = body.scheduledAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    await notify([userId], { type: 'oneonone.scheduled', title: `1:1 marcado com ${req.auth.name.split(' ')[0]}`, body: `${when}. Adicione assuntos à pauta.`, link: `/1-1?com=${req.auth.id}` });
    return m;
  });

  app.patch('/:id', async (req) => {
    const { id } = req.params as { id: string };
    const m = await loadMeeting(req.auth, id);
    const body = parse(z.object({ notes: z.string().max(10000).nullish(), status: z.enum(['OPEN', 'DONE']).optional(), scheduledAt: z.coerce.date().optional() }), req.body);
    if (body.status && m.managerId !== req.auth.id && !isHR(req.auth)) throw forbidden('Só o gestor encerra o 1:1');
    return prisma.oneOnOne.update({ where: { id }, data: body, include: meetingInclude });
  });

  app.delete('/:id', async (req) => {
    const { id } = req.params as { id: string };
    const m = await loadMeeting(req.auth, id);
    if (m.managerId !== req.auth.id && !isHR(req.auth)) throw forbidden('Só o gestor exclui o 1:1');
    await prisma.oneOnOne.delete({ where: { id } });
    return { ok: true };
  });

  /** Assunto da pauta ou item de ação */
  app.post('/:id/items', async (req) => {
    const { id } = req.params as { id: string };
    const m = await loadMeeting(req.auth, id);
    if (m.managerId !== req.auth.id && m.reportId !== req.auth.id) throw forbidden('Só quem participa edita a pauta');
    const body = parse(
      z.object({ kind: z.enum(['TOPIC', 'ACTION']).default('TOPIC'), text: z.string().trim().min(2, 'Escreva o assunto').max(500), ownerId: z.string().nullish(), dueAt: z.coerce.date().nullish() }),
      req.body,
    );
    if (body.ownerId && body.ownerId !== m.managerId && body.ownerId !== m.reportId) throw badRequest('O responsável precisa ser um dos participantes');
    const item = await prisma.oneOnOneItem.create({
      data: { oneOnOneId: id, authorId: req.auth.id, kind: body.kind, text: body.text, ownerId: body.kind === 'ACTION' ? body.ownerId ?? m.reportId : null, dueAt: body.kind === 'ACTION' ? body.dueAt : null },
      include: itemInclude,
    });
    const other = req.auth.id === m.managerId ? m.reportId : m.managerId;
    if (body.kind === 'TOPIC') {
      await notify([other], { type: 'oneonone.topic', title: `${req.auth.name.split(' ')[0]} adicionou um assunto ao 1:1`, body: body.text.slice(0, 120), link: `/1-1?com=${req.auth.id}` });
    }
    return item;
  });

  app.patch('/items/:itemId', async (req) => {
    const { itemId } = req.params as { itemId: string };
    const item = await prisma.oneOnOneItem.findUnique({ where: { id: itemId } });
    if (!item) throw notFound();
    const m = await loadMeeting(req.auth, item.oneOnOneId);
    if (m.managerId !== req.auth.id && m.reportId !== req.auth.id) throw forbidden();
    const body = parse(z.object({ done: z.boolean().optional(), text: z.string().trim().min(2).max(500).optional(), dueAt: z.coerce.date().nullish() }), req.body);
    return prisma.oneOnOneItem.update({ where: { id: itemId }, data: body, include: itemInclude });
  });

  app.delete('/items/:itemId', async (req) => {
    const { itemId } = req.params as { itemId: string };
    const item = await prisma.oneOnOneItem.findUnique({ where: { id: itemId } });
    if (!item) throw notFound();
    if (item.authorId !== req.auth.id) throw forbidden('Só quem escreveu remove');
    await prisma.oneOnOneItem.delete({ where: { id: itemId } });
    return { ok: true };
  });
}
