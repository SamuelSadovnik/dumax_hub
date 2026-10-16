import type { FastifyInstance } from 'fastify';
import { Prisma, type TaskStatus } from '@prisma/client';
import { prisma, userLite } from '../lib/prisma';
import { authenticate, isHR, requireRole, visibleUserIds, type AuthUser } from '../lib/auth';
import { brDateKey, dateOnly, daysAgo } from '../lib/dates';

const OPEN: TaskStatus[] = ['TODO', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW'];

/** Métricas de demandas por pessoa (usado no painel e pelo assistente de IA) */
export async function peopleTaskMetrics(user: AuthUser) {
  const scope = await visibleUserIds(user);
  const users = await prisma.user.findMany({
    where: { active: true, ...(scope ? { id: { in: scope } } : {}) },
    select: { ...userLite, department: { select: { id: true, name: true, color: true } } },
    orderBy: { name: 'asc' },
  });
  const ids = users.map((u) => u.id);
  const now = new Date();
  const since30 = daysAgo(30);

  const [open, overdue, inProgress, blocked, done30, doneOnTime, doneWithDue, lateDays] = await Promise.all([
    prisma.task.groupBy({ by: ['assigneeId'], where: { assigneeId: { in: ids }, status: { in: OPEN } }, _count: true }),
    prisma.task.groupBy({ by: ['assigneeId'], where: { assigneeId: { in: ids }, status: { in: OPEN }, dueAt: { lt: now } }, _count: true }),
    prisma.task.groupBy({ by: ['assigneeId'], where: { assigneeId: { in: ids }, status: 'IN_PROGRESS' }, _count: true }),
    prisma.task.groupBy({ by: ['assigneeId'], where: { assigneeId: { in: ids }, status: 'BLOCKED' }, _count: true }),
    prisma.task.groupBy({ by: ['assigneeId'], where: { assigneeId: { in: ids }, status: 'DONE', completedAt: { gte: since30 } }, _count: true }),
    // concluída no prazo = completedAt <= dueAt (comparação coluna x coluna via SQL)
    prisma.$queryRaw<{ assigneeId: string; n: bigint }[]>`
      SELECT "assigneeId", COUNT(*)::bigint AS n FROM tasks
      WHERE status = 'DONE' AND "dueAt" IS NOT NULL AND "completedAt" <= "dueAt" AND "completedAt" >= ${since30}
      GROUP BY "assigneeId"`,
    prisma.task.groupBy({ by: ['assigneeId'], where: { assigneeId: { in: ids }, status: 'DONE', dueAt: { not: null }, completedAt: { gte: since30 } }, _count: true }),
    prisma.timeDay.groupBy({ by: ['userId'], where: { userId: { in: ids }, status: 'LATE', date: { gte: dateOnly(brDateKey(since30)) } }, _count: true }),
  ]);

  const get = (rows: { assigneeId: string; _count: number }[], id: string) => rows.find((r) => r.assigneeId === id)?._count ?? 0;

  return users
    .map((u) => {
      const withDue = get(doneWithDue, u.id);
      const onTime = Number(doneOnTime.find((r) => r.assigneeId === u.id)?.n ?? 0);
      return {
        user: u,
        open: get(open, u.id),
        overdue: get(overdue, u.id),
        inProgress: get(inProgress, u.id),
        blocked: get(blocked, u.id),
        doneLast30: get(done30, u.id),
        onTimeRate: withDue ? onTime / withDue : null,
        lateArrivals30: lateDays.find((r) => r.userId === u.id)?._count ?? 0,
      };
    })
    .sort((a, b) => b.overdue - a.overdue || b.open - a.open);
}

export async function metricsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);
  app.addHook('preHandler', requireRole('ADMIN', 'HR', 'MANAGER'));

  app.get('/overview', async (req) => {
    const me = req.auth;
    const scope = await visibleUserIds(me);
    const assignee = scope ? { assigneeId: { in: scope } } : {};
    const now = new Date();
    const today = dateOnly(brDateKey());

    const [people, byStatus, done7, created7, headcount, departments, todayDays, contested] = await Promise.all([
      peopleTaskMetrics(me),
      prisma.task.groupBy({ by: ['status'], where: { ...assignee, status: { not: 'CANCELED' } }, _count: true }),
      prisma.task.count({ where: { ...assignee, status: 'DONE', completedAt: { gte: daysAgo(7) } } }),
      prisma.task.count({ where: { ...assignee, createdAt: { gte: daysAgo(7) } } }),
      prisma.user.count({ where: { active: true, ...(scope ? { id: { in: scope } } : {}) } }),
      prisma.department.findMany({
        select: { id: true, name: true, color: true, _count: { select: { members: { where: { active: true, ...(scope ? { id: { in: scope } } : {}) } } } } },
      }),
      prisma.timeDay.groupBy({ by: ['status'], where: { date: today, ...(scope ? { userId: { in: scope } } : {}) }, _count: true }),
      prisma.timeDay.count({ where: { validation: 'CONTESTED', ...(scope ? { userId: { in: scope } } : {}) } }),
    ]);

    // Tendência de entregas — últimas 8 semanas
    const weekly = await prisma.$queryRaw<{ week: Date; done: bigint; created: bigint }[]>`
      WITH weeks AS (
        SELECT generate_series(date_trunc('week', now()) - interval '7 weeks', date_trunc('week', now()), interval '1 week') AS week
      )
      SELECT w.week,
        (SELECT COUNT(*) FROM tasks t WHERE t.status = 'DONE' AND date_trunc('week', t."completedAt") = w.week
           ${scope ? prismaIn('t."assigneeId"', scope) : emptySql}) AS done,
        (SELECT COUNT(*) FROM tasks t WHERE date_trunc('week', t."createdAt") = w.week
           ${scope ? prismaIn('t."assigneeId"', scope) : emptySql}) AS created
      FROM weeks w ORDER BY w.week`;

    const openTotal = people.reduce((a, p) => a + p.open, 0);
    const overdueTotal = people.reduce((a, p) => a + p.overdue, 0);

    const result: Record<string, unknown> = {
      scope: scope ? 'team' : 'company',
      headcount,
      tasks: {
        open: openTotal,
        overdue: overdueTotal,
        doneLast7: done7,
        createdLast7: created7,
        byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count])),
        weekly: weekly.map((w) => ({ week: w.week, done: Number(w.done), created: Number(w.created) })),
        peopleWithOverdue: people.filter((p) => p.overdue > 0).length,
        peopleClear: people.filter((p) => p.open === 0).length,
      },
      people,
      departments: departments.map((d) => ({ id: d.id, name: d.name, color: d.color, headcount: d._count.members })).filter((d) => d.headcount > 0),
      ponto: {
        today: Object.fromEntries(todayDays.map((d) => [d.status, d._count])),
        contested,
      },
    };

    // Clima e recrutamento: só RH/admin (gestor vê só a média geral do pulse)
    const surveys = await prisma.pulseSurvey.findMany({
      orderBy: { weekStart: 'desc' },
      take: 8,
      include: { _count: { select: { responses: true } }, responses: { select: { score: true } } },
    });
    result.pulse = surveys
      .map((s) => ({
        weekStart: s.weekStart,
        responses: s._count.responses,
        average: s.responses.length ? s.responses.reduce((a, r) => a + r.score, 0) / s.responses.length : null,
      }))
      .reverse();

    if (isHR(me)) {
      const [openJobs, apps30, funnel, hired] = await Promise.all([
        prisma.job.count({ where: { status: 'OPEN' } }),
        prisma.application.count({ where: { createdAt: { gte: daysAgo(30) } } }),
        prisma.application.groupBy({ by: ['stage'], _count: true }),
        prisma.application.findMany({ where: { stage: 'HIRED', hiredAt: { not: null } }, select: { createdAt: true, hiredAt: true }, take: 100, orderBy: { hiredAt: 'desc' } }),
      ]);
      const tth = hired.length ? hired.reduce((a, h) => a + (h.hiredAt!.getTime() - h.createdAt.getTime()) / 86400000, 0) / hired.length : null;
      result.recruitment = {
        openJobs,
        applicationsLast30: apps30,
        funnel: Object.fromEntries(funnel.map((f) => [f.stage, f._count])),
        avgTimeToHireDays: tth ? Math.round(tth) : null,
      };
    }
    return result;
  });

  app.get('/people', async (req) => peopleTaskMetrics(req.auth));
}

// helpers para SQL dinâmico seguro
const emptySql = Prisma.empty;
function prismaIn(column: string, ids: string[]) {
  return Prisma.sql`AND ${Prisma.raw(column)} IN (${Prisma.join(ids)})`;
}
