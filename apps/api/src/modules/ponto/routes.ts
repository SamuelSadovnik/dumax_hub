import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma, userLite } from '../../lib/prisma';
import { authenticate, canSeeUser, isHR, requireRole, visibleUserIds, type AuthUser } from '../../lib/auth';
import { badRequest, forbidden, notFound, parse, unauthorized } from '../../lib/http';
import { notify } from '../../lib/notify';
import { addDays, brDateKey, dateOnly } from '../../lib/dates';
import { env } from '../../env';
import { mapPunch, type ExternalPunch } from './providers';
import { computeDay, dayBounds, ingestPunches, syncPonto } from './service';

const range = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

function resolveRange(q: { from?: string; to?: string }, defaultDays = 30) {
  const to = q.to ?? brDateKey();
  const from = q.from ?? addDays(dateOnly(to), -defaultDays + 1).toISOString().slice(0, 10);
  return { from, to, fromDate: dateOnly(from), toDate: dateOnly(to) };
}

/** Totais de um conjunto de dias */
function summarize(days: { workedMinutes: number; expectedMinutes: number; balanceMinutes: number; lateMinutes: number; status: string; validation: string; adjustedWorkedMinutes: number | null }[]) {
  return {
    days: days.length,
    workedMinutes: days.reduce((a, d) => a + (d.adjustedWorkedMinutes ?? d.workedMinutes), 0),
    expectedMinutes: days.reduce((a, d) => a + d.expectedMinutes, 0),
    balanceMinutes: days.reduce((a, d) => a + (d.adjustedWorkedMinutes != null ? d.adjustedWorkedMinutes - d.expectedMinutes : d.balanceMinutes), 0),
    lateCount: days.filter((d) => d.status === 'LATE').length,
    lateMinutes: days.reduce((a, d) => a + d.lateMinutes, 0),
    absentCount: days.filter((d) => d.status === 'ABSENT').length,
    incompleteCount: days.filter((d) => d.status === 'INCOMPLETE').length,
    pendingValidation: days.filter((d) => d.validation === 'PENDING' && d.status !== 'OFF').length,
    contested: days.filter((d) => d.validation === 'CONTESTED').length,
  };
}

/** Quem pode revisar o dia de alguém: RH/admin ou gestor na hierarquia acima */
async function canReview(reviewer: AuthUser, userId: string) {
  if (reviewer.role === 'ADMIN' || reviewer.role === 'HR') return true;
  if (reviewer.role !== 'MANAGER' || reviewer.id === userId) return false;
  return canSeeUser(reviewer, userId);
}

export async function pontoRoutes(app: FastifyInstance) {
  /** Webhook público: o sistema de ponto pode empurrar batidas em tempo real */
  app.post('/webhook', async (req) => {
    if (!env.PONTO_WEBHOOK_SECRET || req.headers['x-ponto-secret'] !== env.PONTO_WEBHOOK_SECRET) {
      throw unauthorized('Assinatura do webhook inválida');
    }
    const body = req.body as unknown;
    const list = (Array.isArray(body) ? body : [body]) as Record<string, unknown>[];
    const punches = list.map(mapPunch).filter((p): p is ExternalPunch => p !== null);
    if (!punches.length) throw badRequest('Nenhuma batida válida no payload');
    return ingestPunches(punches, 'webhook');
  });

  app.register(async (r) => {
    r.addHook('preHandler', authenticate);

    /** Meu ponto: dias consolidados + batidas + resumo */
    r.get('/me', async (req) => {
      const { from, to, fromDate, toDate } = resolveRange(parse(range, req.query));
      const days = await prisma.timeDay.findMany({
        where: { userId: req.auth.id, date: { gte: fromDate, lte: toDate } },
        orderBy: { date: 'desc' },
        include: { reviewer: { select: userLite } },
      });
      const entries = await prisma.timeEntry.findMany({
        where: { userId: req.auth.id, at: { gte: dayBounds(from).start, lt: dayBounds(to).end } },
        orderBy: { at: 'asc' },
      });
      const schedule = await prisma.workSchedule.findUnique({ where: { userId: req.auth.id } });
      return { from, to, schedule, summary: summarize(days), days, entries };
    });

    /** Painel "Hoje": quem chegou, quem atrasou, quem não bateu ponto */
    r.get('/today', async (req) => {
      const scope = await visibleUserIds(req.auth);
      const key = brDateKey();
      const users = await prisma.user.findMany({
        where: { active: true, ...(scope ? { id: { in: scope } } : {}) },
        select: { ...userLite, department: { select: { name: true, color: true } }, workSchedule: true },
        orderBy: { name: 'asc' },
      });
      // garante consolidação atualizada de hoje
      for (const u of users) await computeDay(u.id, key);
      const days = await prisma.timeDay.findMany({ where: { date: dateOnly(key), userId: { in: users.map((u) => u.id) } } });
      const { start, end } = dayBounds(key);
      const entries = await prisma.timeEntry.findMany({ where: { userId: { in: users.map((u) => u.id) }, at: { gte: start, lt: end } }, orderBy: { at: 'asc' } });
      return {
        date: key,
        people: users.map((u) => {
          const day = days.find((d) => d.userId === u.id) ?? null;
          const es = entries.filter((e) => e.userId === u.id);
          return { user: u, day, entries: es, working: es.length % 2 === 1 };
        }),
      };
    });

    /** Dias consolidados do time (com filtros) — para gestor/RH validar */
    r.get('/days', async (req) => {
      const q = parse(
        range.extend({
          userId: z.string().optional(),
          status: z.string().optional(),
          validation: z.string().optional(),
        }),
        req.query,
      );
      const { fromDate, toDate } = resolveRange(q, 14);
      const scope = await visibleUserIds(req.auth);
      if (q.userId && scope && !scope.includes(q.userId)) throw forbidden();
      const where: Prisma.TimeDayWhereInput = {
        date: { gte: fromDate, lte: toDate },
        userId: q.userId ?? (scope ? { in: scope } : undefined),
        ...(q.status ? { status: { in: q.status.split(',') as never } } : {}),
        ...(q.validation ? { validation: { in: q.validation.split(',') as never } } : {}),
      };
      const days = await prisma.timeDay.findMany({
        where,
        orderBy: [{ date: 'desc' }, { user: { name: 'asc' } }],
        include: { user: { select: userLite }, reviewer: { select: userLite } },
        take: 1000,
      });
      return { summary: summarize(days), days };
    });

    /** Resumo por pessoa no período (para métricas e para a IA) */
    r.get('/summary', async (req) => {
      const { fromDate, toDate, from, to } = resolveRange(parse(range, req.query));
      const scope = await visibleUserIds(req.auth);
      const users = await prisma.user.findMany({
        where: { active: true, ...(scope ? { id: { in: scope } } : {}) },
        select: { ...userLite, department: { select: { name: true } } },
        orderBy: { name: 'asc' },
      });
      const days = await prisma.timeDay.findMany({ where: { userId: { in: users.map((u) => u.id) }, date: { gte: fromDate, lte: toDate } } });
      return {
        from,
        to,
        people: users.map((u) => ({ user: u, ...summarize(days.filter((d) => d.userId === u.id)) })),
        total: summarize(days),
      };
    });

    r.get('/days/:id/entries', async (req) => {
      const { id } = req.params as { id: string };
      const day = await prisma.timeDay.findUnique({ where: { id } });
      if (!day) throw notFound();
      if (!(await canSeeUser(req.auth, day.userId))) throw forbidden();
      const { start, end } = dayBounds(day.date.toISOString().slice(0, 10));
      return prisma.timeEntry.findMany({ where: { userId: day.userId, at: { gte: start, lt: end } }, orderBy: { at: 'asc' } });
    });

    // ─── Validação ───

    /** Colaborador confirma que o dia está correto */
    r.post('/days/:id/confirm', async (req) => {
      const { id } = req.params as { id: string };
      const day = await prisma.timeDay.findUnique({ where: { id } });
      if (!day || day.userId !== req.auth.id) throw notFound();
      if (day.validation === 'APPROVED' || day.validation === 'ADJUSTED') throw badRequest('Dia já fechado pelo gestor');
      return prisma.timeDay.update({ where: { id }, data: { validation: 'CONFIRMED', confirmedAt: new Date(), employeeNote: null } });
    });

    /** Confirma todos os dias pendentes de uma vez */
    r.post('/confirm-all', async (req) => {
      const res = await prisma.timeDay.updateMany({
        where: { userId: req.auth.id, validation: 'PENDING', date: { lt: dateOnly(brDateKey()) }, status: { in: ['OK', 'OFF'] } },
        data: { validation: 'CONFIRMED', confirmedAt: new Date() },
      });
      return { confirmed: res.count };
    });

    /** Colaborador contesta (ex.: "esqueci de bater a saída, saí às 18h") */
    r.post('/days/:id/contest', async (req) => {
      const { id } = req.params as { id: string };
      const { note } = parse(z.object({ note: z.string().min(5, 'Explique o que aconteceu').max(1000) }), req.body);
      const day = await prisma.timeDay.findUnique({ where: { id }, include: { user: { select: { managerId: true, name: true } } } });
      if (!day || day.userId !== req.auth.id) throw notFound();
      if (day.validation === 'APPROVED' || day.validation === 'ADJUSTED') throw badRequest('Dia já fechado pelo gestor');
      const updated = await prisma.timeDay.update({ where: { id }, data: { validation: 'CONTESTED', employeeNote: note } });
      const reviewers = day.user.managerId
        ? [day.user.managerId]
        : (await prisma.user.findMany({ where: { role: { in: ['ADMIN', 'HR'] }, active: true }, select: { id: true } })).map((u) => u.id);
      await notify(reviewers, {
        type: 'ponto.contested',
        title: `${day.user.name} contestou o ponto`,
        body: `${day.date.toISOString().slice(0, 10).split('-').reverse().join('/')}: ${note.slice(0, 120)}`,
        link: '/admin/ponto?validation=CONTESTED',
      });
      return updated;
    });

    /** Gestor/RH aprova ou ajusta */
    r.post('/days/:id/review', async (req) => {
      const { id } = req.params as { id: string };
      const body = parse(
        z.object({
          action: z.enum(['APPROVE', 'ADJUST', 'REOPEN']),
          adjustedWorkedMinutes: z.number().int().min(0).max(24 * 60).optional(),
          note: z.string().max(1000).optional(),
        }),
        req.body,
      );
      const day = await prisma.timeDay.findUnique({ where: { id } });
      if (!day) throw notFound();
      if (!(await canReview(req.auth, day.userId))) throw forbidden('Só o gestor da pessoa ou o RH podem revisar');
      if (body.action === 'ADJUST' && body.adjustedWorkedMinutes === undefined) throw badRequest('Informe as horas ajustadas');

      const updated = await prisma.timeDay.update({
        where: { id },
        data:
          body.action === 'REOPEN'
            ? { validation: 'PENDING', reviewerId: null, reviewedAt: null, reviewNote: null, adjustedWorkedMinutes: null }
            : {
                validation: body.action === 'APPROVE' ? 'APPROVED' : 'ADJUSTED',
                reviewerId: req.auth.id,
                reviewedAt: new Date(),
                reviewNote: body.note,
                adjustedWorkedMinutes: body.action === 'ADJUST' ? body.adjustedWorkedMinutes : null,
              },
      });
      if (body.action !== 'REOPEN' && day.userId !== req.auth.id) {
        await notify([day.userId], {
          type: 'ponto.reviewed',
          title: body.action === 'APPROVE' ? 'Seu ponto foi aprovado ✅' : 'Seu ponto foi ajustado pelo gestor',
          body: body.note ?? undefined,
          link: '/ponto',
        });
      }
      if (body.action === 'REOPEN') await computeDay(day.userId, day.date.toISOString().slice(0, 10));
      return updated;
    });

    /** Aprova em lote os dias confirmados pelos colaboradores */
    r.post('/approve-confirmed', async (req) => {
      const { ids } = parse(z.object({ ids: z.array(z.string()).min(1) }), req.body);
      const days = await prisma.timeDay.findMany({ where: { id: { in: ids }, validation: 'CONFIRMED' } });
      let approved = 0;
      for (const d of days) {
        if (!(await canReview(req.auth, d.userId))) continue;
        await prisma.timeDay.update({ where: { id: d.id }, data: { validation: 'APPROVED', reviewerId: req.auth.id, reviewedAt: new Date() } });
        approved++;
      }
      return { approved };
    });

    // ─── Integração (RH/admin) ───
    r.post('/sync', { preHandler: requireRole('ADMIN', 'HR') }, async (req) => {
      const q = parse(range, req.body ?? {});
      const { fromDate, toDate } = resolveRange(q, 2);
      const to = q.to ? new Date(toDate.getTime() + 86400000 - 1) : new Date();
      return syncPonto(fromDate, to);
    });

    r.get('/sync/logs', { preHandler: requireRole('ADMIN', 'HR') }, async () =>
      prisma.pontoSyncLog.findMany({ orderBy: { startedAt: 'desc' }, take: 30 }),
    );

    /** Lançamento manual de batida (RH) — ex.: relógio quebrado */
    r.post('/entries', async (req) => {
      if (!isHR(req.auth)) throw forbidden();
      const body = parse(
        z.object({ userId: z.string(), at: z.coerce.date(), type: z.enum(['IN', 'BREAK_START', 'BREAK_END', 'OUT']), note: z.string().max(300).optional() }),
        req.body,
      );
      const entry = await prisma.timeEntry.create({ data: { ...body, source: 'manual', note: body.note ?? `Lançado por ${req.auth.name}` } });
      await computeDay(body.userId, brDateKey(body.at));
      return entry;
    });
  });
}
