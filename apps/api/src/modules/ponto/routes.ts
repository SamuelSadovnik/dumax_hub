import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma, userLite } from '../../lib/prisma';
import { authenticate, canSeeUser, requireRole, visibleUserIds } from '../../lib/auth';
import { badRequest, forbidden, notFound, parse, unauthorized } from '../../lib/http';
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
function summarize(days: { workedMinutes: number; expectedMinutes: number; balanceMinutes: number; lateMinutes: number; status: string }[]) {
  return {
    days: days.length,
    workedMinutes: days.reduce((acc, d) => acc + d.workedMinutes, 0),
    expectedMinutes: days.reduce((acc, d) => acc + d.expectedMinutes, 0),
    balanceMinutes: days.reduce((acc, d) => acc + d.balanceMinutes, 0),
    lateCount: days.filter((d) => d.status === 'LATE').length,
    lateMinutes: days.reduce((acc, d) => acc + d.lateMinutes, 0),
    absentCount: days.filter((d) => d.status === 'ABSENT').length,
    incompleteCount: days.filter((d) => d.status === 'INCOMPLETE').length,
  };
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

    /** Dias consolidados do time (com filtros) — somente leitura, vindos da API de ponto */
    r.get('/days', async (req) => {
      const q = parse(
        range.extend({
          userId: z.string().optional(),
          status: z.string().optional(),
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
      };
      const days = await prisma.timeDay.findMany({
        where,
        orderBy: [{ date: 'desc' }, { user: { name: 'asc' } }],
        include: { user: { select: userLite } },
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
  });
}
