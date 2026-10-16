import type { FastifyInstance } from 'fastify';
import { daysUntil, goalElapsed, goalProgress, licenseState } from '@dumax/shared';
import { prisma, userLite } from '../lib/prisma';
import { authenticate, getSubordinateIds, isHR } from '../lib/auth';
import { brDateKey, dateOnly } from '../lib/dates';
import { dayBounds } from './ponto/service';
import { buildFlags, computePerformance } from './performance/engine';

/**
 * "Pendências": tudo que pede uma ação do usuário, num lugar só.
 * Alimenta a tela inicial.
 */
export async function inboxRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.get('/', async (req) => {
    const me = req.auth;
    const now = new Date();
    const todayKey = brDateKey(now);
    const { start: dayStart, end: dayEnd } = dayBounds(todayKey);
    const open = ['TODO', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW'] as const;

    const [tasks, docs, pontoPending, survey, licenses, goals, running, meetings] = await Promise.all([
      prisma.task.findMany({
        where: { assigneeId: me.id, status: { in: [...open] } },
        select: { id: true, title: true, dueAt: true, priority: true, status: true, createdBy: { select: userLite } },
        orderBy: [{ dueAt: { sort: 'asc', nulls: 'last' } }],
      }),
      prisma.documentSigner.findMany({
        where: { userId: me.id, status: 'PENDING', document: { status: 'PENDING' } },
        select: { token: true, document: { select: { id: true, title: true, dueAt: true, createdBy: { select: { name: true } } } } },
      }),
      prisma.timeDay.count({ where: { userId: me.id, validation: 'PENDING', status: { not: 'OFF' }, date: { lt: dateOnly(todayKey) } } }),
      prisma.pulseSurvey.findFirst({ where: { status: 'OPEN' }, orderBy: { weekStart: 'desc' }, include: { responses: { where: { userId: me.id }, select: { id: true } } } }),
      prisma.license.findMany({ where: { archived: false, OR: [{ responsibleId: me.id }, { backupId: me.id }] }, select: { id: true, name: true, expiresAt: true, alertDays: true } }),
      prisma.goal.findMany({ where: { ownerId: me.id, status: 'ACTIVE' }, select: { id: true, title: true, unit: true, startValue: true, targetValue: true, currentValue: true, higherIsBetter: true, startDate: true, dueDate: true } }),
      prisma.timeLog.findFirst({ where: { userId: me.id, endedAt: null }, include: { task: { select: { id: true, title: true } } } }),
      prisma.meeting.findMany({
        where: { canceledAt: null, startsAt: { gte: dayStart, lt: dayEnd }, participants: { some: { userId: me.id, rsvp: { not: 'DECLINED' } } } },
        orderBy: { startsAt: 'asc' },
        select: { id: true, title: true, startsAt: true, endsAt: true, videoUrl: true, location: true },
      }),
    ]);

    const lic = licenses
      .map((l) => {
        const daysLeft = daysUntil(l.expiresAt, todayKey);
        return { id: l.id, name: l.name, expiresAt: l.expiresAt, daysLeft, state: licenseState(daysLeft, l.alertDays) };
      })
      .filter((l) => l.state !== 'VALID')
      .sort((a, b) => a.daysLeft - b.daysLeft);

    // Para gestores: quem do time precisa de atenção (últimos 14 dias)
    let team: { contestedPonto: number; alerts: { user: { id: string; name: string; avatarUrl: string | null }; message: string; severity: string }[] } | null = null;
    if (me.role !== 'EMPLOYEE') {
      const ids = isHR(me) ? (await prisma.user.findMany({ where: { active: true, id: { not: me.id } }, select: { id: true } })).map((u) => u.id) : await getSubordinateIds(me.id);
      if (ids.length) {
        const from = new Date(now.getTime() - 14 * 86400000);
        const perf = await computePerformance(ids, from, now);
        const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, avatarUrl: true } });
        const alerts = users
          .flatMap((u) => buildFlags(perf.get(u.id)!.metrics, perf.get(u.id)!.score, null).filter((f) => f.severity === 'high').map((f) => ({ user: u, message: f.message, severity: f.severity })))
          .slice(0, 6);
        const contestedPonto = await prisma.timeDay.count({ where: { userId: { in: ids }, validation: 'CONTESTED' } });
        team = { contestedPonto, alerts };
      }
    }

    return {
      tasks: {
        open: tasks.length,
        overdue: tasks.filter((t) => t.dueAt && t.dueAt < now).length,
        dueToday: tasks.filter((t) => t.dueAt && t.dueAt >= dayStart && t.dueAt < dayEnd).length,
        top: tasks.slice(0, 6),
      },
      documentsToSign: docs.map((d) => ({ ...d.document, from: d.document.createdBy.name, token: d.token })),
      pontoToValidate: pontoPending,
      pulse: survey ? { id: survey.id, question: survey.question, answered: survey.responses.length > 0 } : null,
      licenses: lic,
      goals: goals.map((g) => ({ ...g, progress: goalProgress(g), elapsed: goalElapsed(g) })),
      runningTimer: running,
      meetingsToday: meetings,
      team,
    };
  });
}
