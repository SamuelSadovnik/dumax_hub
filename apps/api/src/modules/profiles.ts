import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import {
  INTERVIEW_PROBES, PROFILES, PROFILE_KEYS, fitLabel, mapPosition, normalizeProfile, profileFit,
  type AssessmentResult, type ProfileKey, type ProfileScores,
} from '@dumax/shared';
import { prisma, userLite } from '../lib/prisma';
import { authenticate, isHR, requireRole } from '../lib/auth';
import { badRequest, parse } from '../lib/http';
import { notify } from '../lib/notify';
import { publicQuestions, scoreDisc } from './assessments/disc';

/** Último resultado de perfil de cada pessoa */
export async function latestProfiles(userIds?: string[]) {
  const rows = await prisma.profileAssessment.findMany({
    where: userIds ? { userId: { in: userIds } } : {},
    orderBy: { completedAt: 'desc' },
    select: { userId: true, result: true, primaryProfile: true, completedAt: true },
  });
  const map = new Map<string, { scores: ProfileScores; primary: ProfileKey; secondary: ProfileKey; completedAt: Date }>();
  for (const r of rows) {
    if (map.has(r.userId)) continue;
    const res = r.result as unknown as AssessmentResult;
    map.set(r.userId, { scores: res.scores, primary: res.primary, secondary: res.secondary, completedAt: r.completedAt });
  }
  return map;
}

/** Média de perfil de um conjunto de pessoas */
function averageProfile(list: ProfileScores[]): ProfileScores | null {
  if (!list.length) return null;
  return normalizeProfile(Object.fromEntries(PROFILE_KEYS.map((k) => [k, list.reduce((a, s) => a + s[k], 0) / list.length])) as ProfileScores);
}

/**
 * Análise candidato × vaga: aderência, lacunas por perfil, comparação com o time da área
 * e perguntas sugeridas para a entrevista.
 */
export async function analyzeFit(candidate: ProfileScores, job: { idealProfile: Prisma.JsonValue | null; departmentId: string | null }) {
  const ideal = job.idealProfile ? normalizeProfile(job.idealProfile as Partial<ProfileScores>) : null;
  let team: { avg: ProfileScores | null; size: number; fitWithTeam: number | null; complement: ProfileKey[] } | null = null;

  if (job.departmentId) {
    const members = await prisma.user.findMany({ where: { departmentId: job.departmentId, active: true }, select: { id: true } });
    const profiles = await latestProfiles(members.map((m) => m.id));
    const avg = averageProfile([...profiles.values()].map((p) => p.scores));
    team = {
      avg,
      size: profiles.size,
      fitWithTeam: avg ? profileFit(candidate, avg) : null,
      // perfis em que o candidato traz mais do que o time tem hoje
      complement: avg ? PROFILE_KEYS.filter((k) => candidate[k] - avg[k] >= 15) : [],
    };
  }

  if (!ideal) return { fit: null, label: null, ideal: null, gaps: [], probes: [], team };
  const fit = profileFit(candidate, ideal);
  const gaps = PROFILE_KEYS.map((k) => ({ profile: k, candidate: candidate[k], ideal: ideal[k], diff: candidate[k] - ideal[k] })).sort((a, b) => a.diff - b.diff);
  const probes = gaps
    .filter((g) => g.diff <= -10)
    .slice(0, 2)
    .flatMap((g) => INTERVIEW_PROBES[g.profile].slice(0, 2).map((q) => ({ profile: g.profile, question: q })));
  return { fit, label: fitLabel(fit), ideal, gaps, probes, team };
}

export async function profileRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  /** Perguntas do teste para o colaborador */
  app.get('/test', async () => ({ questions: publicQuestions() }));

  app.post('/test', async (req) => {
    const { answers } = parse(z.object({ answers: z.record(z.string()) }), req.body);
    const result = scoreDisc(answers);
    if (result.answered < 15) throw badRequest('Responda todas as perguntas');
    await prisma.profileAssessment.create({
      data: {
        userId: req.auth.id,
        answers,
        result: result as unknown as Prisma.InputJsonValue,
        primaryProfile: result.primary,
      },
    });
    return result;
  });

  app.get('/me', async (req) => {
    const m = await latestProfiles([req.auth.id]);
    return m.get(req.auth.id) ?? null;
  });

  /**
   * Mapa de perfis: posição de cada pessoa nos quadrantes + composição por área.
   * Visível para todos (ajuda a entender como cada colega trabalha).
   */
  app.get('/map', async (req) => {
    const q = parse(z.object({ departmentId: z.string().optional(), teamId: z.string().optional() }), req.query);
    const users = await prisma.user.findMany({
      where: {
        active: true,
        ...(q.departmentId ? { departmentId: q.departmentId } : {}),
        ...(q.teamId ? { teamMemberships: { some: { teamId: q.teamId } } } : {}),
      },
      select: { ...userLite, department: { select: { id: true, name: true, color: true } } },
      orderBy: { name: 'asc' },
    });
    const profiles = await latestProfiles(users.map((u) => u.id));
    const people = users
      .filter((u) => profiles.has(u.id))
      .map((u) => {
        const p = profiles.get(u.id)!;
        return { user: u, ...p, position: mapPosition(p.scores) };
      });
    const counts = Object.fromEntries(PROFILE_KEYS.map((k) => [k, people.filter((p) => p.primary === k).length])) as Record<ProfileKey, number>;
    return {
      people,
      pending: users.filter((u) => !profiles.has(u.id)),
      counts,
      average: averageProfile(people.map((p) => p.scores)),
    };
  });

  /** RH convida quem ainda não fez o teste */
  app.post('/request', { preHandler: requireRole('ADMIN', 'HR') }, async (req) => {
    const users = await prisma.user.findMany({ where: { active: true }, select: { id: true } });
    const done = await latestProfiles(users.map((u) => u.id));
    const pending = users.filter((u) => !done.has(u.id)).map((u) => u.id);
    await notify(pending, {
      type: 'profile.request',
      title: 'Faça seu teste de perfil (5 minutos)',
      body: `${req.auth.name} pediu para todos responderem. Ajuda a montar times mais equilibrados.`,
      link: '/perfil-comportamental',
    });
    return { invited: pending.length };
  });

  /** Perfil de uma pessoa específica (gestor/RH ou a própria) */
  app.get('/users/:id', async (req) => {
    const { id } = req.params as { id: string };
    const m = await latestProfiles([id]);
    const p = m.get(id);
    if (!p) return null;
    return { ...p, meta: PROFILES[p.primary], canSeeDetails: isHR(req.auth) || req.auth.id === id || req.auth.role === 'MANAGER' };
  });
}
