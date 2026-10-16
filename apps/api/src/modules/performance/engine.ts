import type { TaskStatus } from '@prisma/client';
import {
  OVERDUE_PENALTY, SCORE_WEIGHTS, TIMELOG_ACTIVITIES, goalElapsed, goalProgress, formatMinutes,
  type PerformanceFlag, type TimeLogActivity,
} from '@dumax/shared';
import { prisma } from '../../lib/prisma';
import { brDateKey, dateOnly } from '../../lib/dates';

/**
 * Motor de desempenho.
 *
 * Responde "onde a pessoa não está sendo produtiva" cruzando quatro fontes:
 *  - Demandas: volume entregue, % no prazo, atrasadas em aberto, tempo de ciclo
 *  - Ponto: horas trabalhadas, atrasos, faltas
 *  - Apontamento + agenda: no que as horas trabalhadas foram gastas
 *    → "horas sem atividade registrada" = trabalhadas − apontadas − reuniões
 *  - Metas: progresso vs. tempo decorrido
 */

const OPEN: TaskStatus[] = ['TODO', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW'];

export interface PersonMetrics {
  tasksDone: number;
  effortDone: number;
  onTimeRate: number | null;
  overdueOpen: number;
  openTasks: number;
  blocked: number;
  avgCycleHours: number | null;
  workedMinutes: number;
  expectedMinutes: number;
  loggedMinutes: number;
  meetingMinutes: number;
  untrackedMinutes: number;
  utilization: number | null;
  workDays: number;
  lateDays: number;
  absentDays: number;
  punctuality: number | null;
  goalsCount: number;
  goalProgress: number | null;
  goalsBehind: { id: string; title: string; progress: number; elapsed: number }[];
  reworkMinutes: number;
  activity: Record<TimeLogActivity | 'AGENDA', number>;
}

export interface PersonResult {
  userId: string;
  metrics: PersonMetrics;
  score: number | null;
  components: Partial<Record<keyof typeof SCORE_WEIGHTS, number>>;
}

const minutesOf = (start: Date, end: Date | null, now: Date) =>
  Math.max(0, Math.round(((end ?? now).getTime() - start.getTime()) / 60000));

function median(values: number[]) {
  const v = values.filter((x) => x > 0).sort((a, b) => a - b);
  if (!v.length) return 0;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/** Calcula métricas e nota de cada pessoa no intervalo [from, to) */
export async function computePerformance(userIds: string[], from: Date, to: Date): Promise<Map<string, PersonResult>> {
  const now = new Date();
  const end = to > now ? now : to;
  const fromDay = dateOnly(brDateKey(from));
  const toDay = dateOnly(brDateKey(new Date(end.getTime() - 1)));

  const [done, open, days, logs, meetings, goals] = await Promise.all([
    prisma.task.findMany({
      where: { assigneeId: { in: userIds }, status: 'DONE', completedAt: { gte: from, lt: end } },
      select: { assigneeId: true, dueAt: true, completedAt: true, startedAt: true, createdAt: true, estimatedHours: true },
    }),
    prisma.task.findMany({
      where: { assigneeId: { in: userIds }, status: { in: OPEN } },
      select: { assigneeId: true, dueAt: true, status: true },
    }),
    prisma.timeDay.findMany({
      where: { userId: { in: userIds }, date: { gte: fromDay, lte: toDay } },
      select: { userId: true, status: true, workedMinutes: true, adjustedWorkedMinutes: true, expectedMinutes: true },
    }),
    prisma.timeLog.findMany({
      where: { userId: { in: userIds }, startedAt: { gte: from, lt: end } },
      select: { userId: true, startedAt: true, endedAt: true, minutes: true, activity: true },
    }),
    prisma.meetingParticipant.findMany({
      where: {
        userId: { in: userIds },
        rsvp: { not: 'DECLINED' },
        meeting: { canceledAt: null, startsAt: { gte: from, lt: end } },
      },
      select: { userId: true, meeting: { select: { startsAt: true, endsAt: true } } },
    }),
    prisma.goal.findMany({
      where: { ownerId: { in: userIds }, status: { not: 'CANCELED' }, startDate: { lte: toDay }, dueDate: { gte: fromDay } },
      select: { id: true, ownerId: true, title: true, startValue: true, targetValue: true, currentValue: true, higherIsBetter: true, startDate: true, dueDate: true, status: true },
    }),
  ]);

  const raw = new Map<string, PersonMetrics>();
  for (const id of userIds) {
    const d = done.filter((t) => t.assigneeId === id);
    const withDue = d.filter((t) => t.dueAt);
    const onTime = withDue.filter((t) => t.completedAt! <= t.dueAt!).length;
    const cycles = d.map((t) => (t.completedAt!.getTime() - (t.startedAt ?? t.createdAt).getTime()) / 3600000);
    const o = open.filter((t) => t.assigneeId === id);

    const ds = days.filter((x) => x.userId === id);
    const worked = ds.reduce((a, x) => a + (x.adjustedWorkedMinutes ?? x.workedMinutes), 0);
    const workDays = ds.filter((x) => x.status !== 'OFF' && x.status !== 'ABSENT').length;
    const lateDays = ds.filter((x) => x.status === 'LATE').length;
    const absentDays = ds.filter((x) => x.status === 'ABSENT').length;

    const activity = Object.fromEntries([...TIMELOG_ACTIVITIES, 'AGENDA'].map((k) => [k, 0])) as PersonMetrics['activity'];
    for (const l of logs.filter((x) => x.userId === id)) {
      activity[l.activity] += l.endedAt ? l.minutes : minutesOf(l.startedAt, null, now);
    }
    const logged = TIMELOG_ACTIVITIES.reduce((a, k) => a + activity[k], 0);
    // Reuniões da agenda contam como tempo ocupado (sem duplicar quem já apontou "Reunião")
    const agendaMinutes = meetings
      .filter((m) => m.userId === id)
      .reduce((a, m) => a + minutesOf(m.meeting.startsAt, m.meeting.endsAt > now ? now : m.meeting.endsAt, now), 0);
    activity.AGENDA = Math.max(0, agendaMinutes - activity.REUNIAO);
    const meetingMinutes = activity.REUNIAO + activity.AGENDA;
    const tracked = logged + activity.AGENDA;

    const gs = goals.filter((g) => g.ownerId === id);
    const progresses = gs.map((g) => ({ g, p: g.status === 'COMPLETED' ? 1 : goalProgress(g), e: goalElapsed(g, now) }));

    raw.set(id, {
      tasksDone: d.length,
      effortDone: d.reduce((a, t) => a + (t.estimatedHours ?? 1), 0),
      onTimeRate: withDue.length ? onTime / withDue.length : null,
      overdueOpen: o.filter((t) => t.dueAt && t.dueAt < now).length,
      openTasks: o.length,
      blocked: o.filter((t) => t.status === 'BLOCKED').length,
      avgCycleHours: cycles.length ? cycles.reduce((a, b) => a + b, 0) / cycles.length : null,
      workedMinutes: worked,
      expectedMinutes: ds.reduce((a, x) => a + x.expectedMinutes, 0),
      loggedMinutes: logged,
      meetingMinutes,
      untrackedMinutes: Math.max(0, worked - tracked),
      utilization: worked >= 60 ? Math.min(1, tracked / worked) : null,
      workDays,
      lateDays,
      absentDays,
      punctuality: workDays + absentDays > 0 ? (workDays - lateDays) / (workDays + absentDays) : null,
      goalsCount: gs.length,
      goalProgress: progresses.length ? progresses.reduce((a, x) => a + x.p, 0) / progresses.length : null,
      goalsBehind: progresses
        .filter((x) => x.g.status === 'ACTIVE' && x.e - x.p > 0.2)
        .map((x) => ({ id: x.g.id, title: x.g.title, progress: x.p, elapsed: x.e })),
      reworkMinutes: activity.RETRABALHO,
      activity,
    });
  }

  // Volume é relativo à mediana do grupo analisado (quem entrega a mediana = 0,8)
  const med = median([...raw.values()].map((m) => m.effortDone));

  const out = new Map<string, PersonResult>();
  for (const [id, m] of raw) {
    const components: PersonResult['components'] = {};
    if (m.onTimeRate !== null) components.onTime = m.onTimeRate;
    if (med > 0 && (m.tasksDone > 0 || m.openTasks > 0)) components.throughput = Math.min(1, (m.effortDone / med) * 0.8);
    if (m.utilization !== null) components.utilization = m.utilization;
    if (m.punctuality !== null) components.punctuality = m.punctuality;
    if (m.goalProgress !== null) components.goals = m.goalProgress;

    const keys = Object.keys(components) as (keyof typeof SCORE_WEIGHTS)[];
    let score: number | null = null;
    if (keys.length) {
      const wsum = keys.reduce((a, k) => a + SCORE_WEIGHTS[k], 0);
      const base = keys.reduce((a, k) => a + SCORE_WEIGHTS[k] * components[k]!, 0) / wsum;
      const penalty = Math.min(OVERDUE_PENALTY.max, m.overdueOpen * OVERDUE_PENALTY.perTask);
      score = Math.max(0, Math.min(100, Math.round(base * 100 - penalty)));
    }
    out.set(id, { userId: id, metrics: m, score, components });
  }
  return out;
}

/** Alertas legíveis a partir das métricas (o que o gestor precisa olhar) */
export function buildFlags(m: PersonMetrics, score: number | null, prevScore: number | null): PerformanceFlag[] {
  const f: PerformanceFlag[] = [];
  if (m.workedMinutes >= 8 * 60 && m.utilization !== null && m.utilization < 0.6) {
    f.push({
      code: 'UNTRACKED_TIME',
      severity: m.utilization < 0.4 ? 'high' : 'medium',
      message: `${formatMinutes(m.untrackedMinutes)} trabalhadas sem atividade registrada (${Math.round(m.utilization * 100)}% do tempo com registro)`,
    });
  }
  if (m.overdueOpen >= 1) {
    f.push({ code: 'OVERDUE', severity: m.overdueOpen >= 3 ? 'high' : 'medium', message: `${m.overdueOpen} demanda(s) atrasada(s) em aberto` });
  }
  if (m.tasksDone === 0 && m.openTasks > 0 && m.workDays >= 3) {
    f.push({ code: 'NO_DELIVERY', severity: 'high', message: `Nenhuma entrega no período, com ${m.openTasks} demanda(s) em aberto` });
  }
  if (m.lateDays >= 2) {
    f.push({ code: 'LATE_ARRIVALS', severity: m.lateDays >= 4 ? 'high' : 'medium', message: `Chegou atrasado(a) em ${m.lateDays} dia(s)` });
  }
  if (m.absentDays >= 1) {
    f.push({ code: 'ABSENCES', severity: m.absentDays >= 2 ? 'high' : 'medium', message: `${m.absentDays} falta(s) sem registro de ponto` });
  }
  if (m.blocked >= 2) f.push({ code: 'BLOCKED', severity: 'medium', message: `${m.blocked} demandas bloqueadas` });
  if (m.loggedMinutes > 0 && m.reworkMinutes / m.loggedMinutes > 0.15) {
    f.push({ code: 'REWORK', severity: 'medium', message: `${Math.round((m.reworkMinutes / m.loggedMinutes) * 100)}% do tempo registrado foi retrabalho` });
  }
  for (const g of m.goalsBehind.slice(0, 2)) {
    f.push({
      code: 'GOAL_BEHIND',
      severity: 'medium',
      message: `Meta "${g.title}" em ${Math.round(g.progress * 100)}% com ${Math.round(g.elapsed * 100)}% do prazo decorrido`,
    });
  }
  if (score !== null && prevScore !== null) {
    if (score - prevScore <= -15) f.push({ code: 'SCORE_DROP', severity: 'high', message: `Nota caiu ${prevScore - score} pontos em relação ao período anterior` });
    if (score - prevScore >= 15) f.push({ code: 'SCORE_UP', severity: 'positive', message: `Nota subiu ${score - prevScore} pontos em relação ao período anterior` });
  }
  const order = { high: 0, medium: 1, low: 2, positive: 3 };
  return f.sort((a, b) => order[a.severity] - order[b.severity]);
}

/** Série semanal crua de uma pessoa (para gráficos) */
export async function weeklySeries(userId: string, weeks: number) {
  const now = new Date();
  const monday = dateOnly(brDateKey(now));
  const dow = monday.getUTCDay();
  monday.setUTCDate(monday.getUTCDate() - (dow === 0 ? 6 : dow - 1));
  const out = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const start = new Date(monday.getTime() - i * 7 * 86400000 + 3 * 3600000); // 00:00 BRT
    const endW = new Date(start.getTime() + 7 * 86400000);
    const r = (await computePerformance([userId], start, endW)).get(userId)!;
    out.push({
      weekStart: start.toISOString().slice(0, 10),
      done: r.metrics.tasksDone,
      onTimeRate: r.metrics.onTimeRate,
      workedHours: +(r.metrics.workedMinutes / 60).toFixed(1),
      loggedHours: +(r.metrics.loggedMinutes / 60).toFixed(1),
      meetingHours: +(r.metrics.activity.AGENDA / 60).toFixed(1),
      untrackedHours: +(r.metrics.untrackedMinutes / 60).toFixed(1),
      score: r.score,
    });
  }
  return out;
}
