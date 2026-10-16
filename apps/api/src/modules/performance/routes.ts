import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { goalElapsed, goalProgress, scoreLevel, TIMELOG_ACTIVITIES, type FlagSeverity } from '@dumax/shared';
import { prisma, userLite } from '../../lib/prisma';
import { authenticate, canSeeUser, isHR, visibleUserIds, getSubordinateIds, type AuthUser } from '../../lib/auth';
import { forbidden, notFound, parse } from '../../lib/http';
import { notify } from '../../lib/notify';
import { decryptText, encryptText } from '../../lib/crypto';
import { buildFlags, computePerformance, weeklySeries } from './engine';

const periodQuery = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
  departmentId: z.string().optional(),
  teamId: z.string().optional(),
});

function window(days: number) {
  const to = new Date();
  const from = new Date(to.getTime() - days * 86400000);
  const prevFrom = new Date(from.getTime() - days * 86400000);
  return { from, to, prevFrom };
}

/** Pessoas que o usuário pode analisar, com filtros opcionais */
async function scopedUsers(me: AuthUser, filter: { departmentId?: string; teamId?: string }) {
  const scope = await visibleUserIds(me);
  return prisma.user.findMany({
    where: {
      active: true,
      ...(scope ? { id: { in: scope } } : {}),
      ...(filter.departmentId ? { departmentId: filter.departmentId } : {}),
      ...(filter.teamId ? { teamMemberships: { some: { teamId: filter.teamId } } } : {}),
    },
    select: { ...userLite, department: { select: { id: true, name: true, color: true } }, managerId: true },
    orderBy: { name: 'asc' },
  });
}

/** Pode registrar/ver feedback privado: RH ou gestor acima na hierarquia */
async function isManagerOf(me: AuthUser, userId: string) {
  if (isHR(me)) return true;
  if (me.role !== 'MANAGER' || me.id === userId) return false;
  return (await getSubordinateIds(me.id)).includes(userId);
}

export async function performanceRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  /** Painel do time: nota, métricas e alertas por pessoa */
  app.get('/overview', async (req) => {
    const q = parse(periodQuery, req.query);
    const users = await scopedUsers(req.auth, q);
    const ids = users.map((u) => u.id);
    const { from, to, prevFrom } = window(q.days);
    const [cur, prev] = await Promise.all([computePerformance(ids, from, to), computePerformance(ids, prevFrom, from)]);

    const people = users.map((u) => {
      const r = cur.get(u.id)!;
      const p = prev.get(u.id)!;
      const flags = buildFlags(r.metrics, r.score, p.score);
      return {
        user: u,
        score: r.score,
        prevScore: p.score,
        delta: r.score !== null && p.score !== null ? r.score - p.score : null,
        level: scoreLevel(r.score)?.key ?? null,
        components: r.components,
        metrics: { ...r.metrics, activity: undefined, goalsBehind: undefined },
        flags,
      };
    });

    const vals = <T,>(fn: (x: (typeof people)[number]) => T | null) => people.map(fn).filter((v): v is T => v !== null);
    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
    const sev: Record<FlagSeverity, number> = { high: 0, medium: 1, low: 2, positive: 3 };

    return {
      period: { from, to, days: q.days },
      summary: {
        people: people.length,
        avgScore: avg(vals((p) => p.score)),
        prevAvgScore: avg(vals((p) => p.prevScore)),
        avgUtilization: avg(vals((p) => p.metrics.utilization)),
        avgOnTime: avg(vals((p) => p.metrics.onTimeRate)),
        avgPunctuality: avg(vals((p) => p.metrics.punctuality)),
        workedHours: people.reduce((a, p) => a + p.metrics.workedMinutes, 0) / 60,
        untrackedHours: people.reduce((a, p) => a + p.metrics.untrackedMinutes, 0) / 60,
        tasksDone: people.reduce((a, p) => a + p.metrics.tasksDone, 0),
        overdueOpen: people.reduce((a, p) => a + p.metrics.overdueOpen, 0),
        distribution: {
          ALTO: people.filter((p) => p.level === 'ALTO').length,
          ADEQUADO: people.filter((p) => p.level === 'ADEQUADO').length,
          ATENCAO: people.filter((p) => p.level === 'ATENCAO').length,
          CRITICO: people.filter((p) => p.level === 'CRITICO').length,
        },
      },
      people: people.sort((a, b) => (a.score ?? 101) - (b.score ?? 101)),
      insights: people
        .flatMap((p) => p.flags.map((f) => ({ ...f, user: p.user })))
        .sort((a, b) => sev[a.severity] - sev[b.severity])
        .slice(0, 40),
    };
  });

  /** Raio-x de uma pessoa ("me" = o próprio usuário) */
  app.get('/people/:id', async (req) => {
    const { id: raw } = req.params as { id: string };
    const id = raw === 'me' ? req.auth.id : raw;
    if (id !== req.auth.id && !(await canSeeUser(req.auth, id))) throw forbidden('Você não tem acesso ao desempenho desta pessoa');
    const q = parse(periodQuery, req.query);
    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        ...userLite,
        hiredAt: true,
        department: { select: { id: true, name: true, color: true } },
        manager: { select: userLite },
        workSchedule: true,
      },
    });
    if (!user) throw notFound('Pessoa não encontrada');

    // a nota é relativa aos colegas de área (volume entregue)
    const peers = await prisma.user.findMany({
      where: { active: true, departmentId: user.department?.id ?? undefined },
      select: { id: true },
    });
    const ids = [...new Set([id, ...peers.map((p) => p.id)])];
    const { from, to, prevFrom } = window(q.days);
    const [cur, prev, weekly] = await Promise.all([
      computePerformance(ids, from, to),
      computePerformance(ids, prevFrom, from),
      weeklySeries(id, Math.min(12, Math.max(4, Math.ceil(q.days / 7)))),
    ]);
    const r = cur.get(id)!;
    const p = prev.get(id)!;
    const peerScores = ids.map((x) => cur.get(x)!.score).filter((s): s is number => s !== null);

    const [openTasks, recentDone, goals, feedbacks, logs] = await Promise.all([
      prisma.task.findMany({
        where: { assigneeId: id, status: { in: ['TODO', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW'] } },
        orderBy: [{ dueAt: { sort: 'asc', nulls: 'last' } }],
        take: 15,
        include: { createdBy: { select: userLite } },
      }),
      prisma.task.findMany({
        where: { assigneeId: id, status: 'DONE', completedAt: { gte: from } },
        orderBy: { completedAt: 'desc' },
        take: 10,
        select: { id: true, title: true, completedAt: true, dueAt: true, priority: true },
      }),
      prisma.goal.findMany({
        where: { ownerId: id, status: { not: 'CANCELED' } },
        orderBy: [{ status: 'asc' }, { dueDate: 'asc' }],
        include: { checkins: { orderBy: { createdAt: 'desc' }, take: 1, include: { author: { select: userLite } } } },
      }),
      listFeedbacks(req.auth, id),
      prisma.timeLog.findMany({
        where: { userId: id, startedAt: { gte: from } },
        orderBy: { startedAt: 'desc' },
        take: 30,
        include: { task: { select: { id: true, title: true } } },
      }),
    ]);

    return {
      user,
      period: { from, to, days: q.days },
      score: r.score,
      prevScore: p.score,
      level: scoreLevel(r.score)?.key ?? null,
      components: r.components,
      metrics: r.metrics,
      prevMetrics: { ...p.metrics, activity: undefined, goalsBehind: undefined },
      peerAvgScore: peerScores.length ? peerScores.reduce((a, b) => a + b, 0) / peerScores.length : null,
      flags: buildFlags(r.metrics, r.score, p.score),
      weekly,
      activity: [...TIMELOG_ACTIVITIES, 'AGENDA' as const].map((k) => ({ key: k, minutes: r.metrics.activity[k] })),
      openTasks,
      recentDone,
      goals: goals.map((g) => ({ ...g, progress: goalProgress(g), elapsed: goalElapsed(g) })),
      feedbacks,
      logs,
      canManage: await isManagerOf(req.auth, id),
    };
  });

  // ─── Feedback / 1:1 ───
  app.get('/people/:id/feedbacks', async (req) => {
    const { id } = req.params as { id: string };
    if (id !== req.auth.id && !(await canSeeUser(req.auth, id))) throw forbidden();
    return listFeedbacks(req.auth, id);
  });

  app.post('/people/:id/feedbacks', async (req) => {
    const { id } = req.params as { id: string };
    if (!(await isManagerOf(req.auth, id))) throw forbidden('Só o gestor da pessoa ou o RH registram feedback');
    const body = parse(
      z.object({
        type: z.enum(['ONE_ON_ONE', 'POSITIVO', 'MELHORIA', 'ALINHAMENTO']),
        body: z.string().min(3).max(10000),
        actionItems: z.array(z.string().min(1).max(300)).max(20).default([]),
        private: z.boolean().default(false),
      }),
      req.body,
    );
    const fb = await prisma.feedback.create({
      data: { ...body, body: encryptText(body.body), actionItems: body.actionItems.map((a) => encryptText(a)), subjectId: id, authorId: req.auth.id },
      include: { author: { select: userLite } },
    });
    if (!body.private) {
      await notify([id], { type: 'feedback', title: `${req.auth.name} registrou um feedback para você`, link: '/desempenho' });
    }
    return { ...fb, body: decryptText(fb.body), actionItems: fb.actionItems.map((a) => decryptText(a)) };
  });

  app.delete('/feedbacks/:id', async (req) => {
    const { id } = req.params as { id: string };
    const fb = await prisma.feedback.findUnique({ where: { id } });
    if (!fb) throw notFound();
    if (fb.authorId !== req.auth.id && !isHR(req.auth)) throw forbidden();
    await prisma.feedback.delete({ where: { id } });
    return { ok: true };
  });
}

async function listFeedbacks(me: AuthUser, subjectId: string) {
  const manager = await isManagerOf(me, subjectId);
  const list = await prisma.feedback.findMany({
    where: { subjectId, ...(manager ? {} : { private: false }) },
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: { author: { select: userLite } },
  });
  return list.map((f) => ({ ...f, body: decryptText(f.body), actionItems: f.actionItems.map((a) => decryptText(a)) }));
}
