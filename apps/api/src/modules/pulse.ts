import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { PULSE_DEFAULT_QUESTION, PULSE_MIN_GROUP } from '@dumax/shared';
import { prisma } from '../lib/prisma';
import { authenticate, requireRole } from '../lib/auth';
import { badRequest, notFound, parse } from '../lib/http';
import { notify } from '../lib/notify';
import { mailLayout, mailEnabled, sendMail } from '../lib/mailer';
import { addDays, weekStart } from '../lib/dates';
import { env } from '../env';
import { decryptText, encryptText } from '../lib/crypto';

/**
 * Abre o pulse da semana (idempotente) e avisa todo mundo.
 * Chamado pelo cron de sexta-feira e pelo botão "Disparar agora".
 */
export async function openWeeklyPulse(question = PULSE_DEFAULT_QUESTION) {
  const ws = weekStart();
  const existing = await prisma.pulseSurvey.findUnique({ where: { weekStart: ws } });
  if (existing) return { survey: existing, created: false };

  // fecha pulses antigos que ficaram abertos
  await prisma.pulseSurvey.updateMany({ where: { status: 'OPEN' }, data: { status: 'CLOSED' } });

  const survey = await prisma.pulseSurvey.create({
    data: { weekStart: ws, question, closesAt: addDays(ws, 10) }, // até a quinta seguinte
  });
  const users = await prisma.user.findMany({ where: { active: true }, select: { id: true, email: true, name: true } });
  await notify(
    users.map((u) => u.id),
    { type: 'pulse.open', title: 'Como foi sua semana? 💬', body: 'Responda o pulse de 1 a 5 — leva 10 segundos.', link: '/clima' },
  );
  if (mailEnabled()) {
    for (const u of users) {
      await sendMail(
        u.email,
        'Como foi sua semana?',
        mailLayout(`Oi, ${u.name.split(' ')[0]}!`, [question, 'Sua resposta é anônima nos relatórios.'], {
          label: 'Responder agora',
          url: `${env.WEB_URL}/clima`,
        }),
      ).catch(() => undefined);
    }
  }
  return { survey, created: true };
}

export async function pulseRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  /** Pulse aberto + minha resposta */
  app.get('/current', async (req) => {
    const survey = await prisma.pulseSurvey.findFirst({ where: { status: 'OPEN' }, orderBy: { weekStart: 'desc' } });
    if (!survey) return { survey: null, myResponse: null };
    const myResponse = await prisma.pulseResponse.findUnique({
      where: { surveyId_userId: { surveyId: survey.id, userId: req.auth.id } },
    });
    return { survey, myResponse: myResponse ? { ...myResponse, comment: decryptText(myResponse.comment) } : null };
  });

  /** Meu histórico (só eu vejo minhas notas) */
  app.get('/mine', async (req) => {
    const list = await prisma.pulseResponse.findMany({
      where: { userId: req.auth.id },
      orderBy: { createdAt: 'desc' },
      take: 26,
      include: { survey: { select: { weekStart: true } } },
    });
    return list.map((r) => ({ ...r, comment: decryptText(r.comment) }));
  });

  app.post('/:id/respond', async (req) => {
    const { id } = req.params as { id: string };
    const body = parse(
      z.object({ score: z.number().int().min(1).max(5), comment: z.string().max(1000).optional(), anonymous: z.boolean().default(true) }),
      req.body,
    );
    const survey = await prisma.pulseSurvey.findUnique({ where: { id } });
    if (!survey) throw notFound('Pesquisa não encontrada');
    if (survey.status !== 'OPEN') throw badRequest('Esta pesquisa já foi encerrada');
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.auth.id }, select: { departmentId: true } });
    return prisma.pulseResponse.upsert({
      where: { surveyId_userId: { surveyId: id, userId: req.auth.id } },
      create: { surveyId: id, userId: req.auth.id, departmentId: user.departmentId, ...body, comment: encryptText(body.comment) },
      update: { ...body, comment: encryptText(body.comment) },
    });
  });

  // ─── RH ───
  const hr = { preHandler: requireRole('ADMIN', 'HR') };

  app.post('/open-now', hr, async (req) => {
    const { question } = parse(z.object({ question: z.string().min(5).max(300).optional() }), req.body ?? {});
    return openWeeklyPulse(question);
  });

  app.post('/:id/close', hr, async (req) => {
    const { id } = req.params as { id: string };
    return prisma.pulseSurvey.update({ where: { id }, data: { status: 'CLOSED' } });
  });

  /**
   * Relatório: série semanal (média, participação, distribuição),
   * recorte por departamento (só grupos com N >= PULSE_MIN_GROUP) e comentários.
   * Comentários anônimos NUNCA trazem o autor.
   */
  app.get('/report', hr, async (req) => {
    const { weeks } = parse(z.object({ weeks: z.coerce.number().min(1).max(52).default(12) }), req.query);
    const surveys = await prisma.pulseSurvey.findMany({
      orderBy: { weekStart: 'desc' },
      take: weeks,
      include: { responses: { include: { user: { select: { name: true } } } } },
    });
    const headcount = await prisma.user.count({ where: { active: true } });
    const departments = await prisma.department.findMany({ select: { id: true, name: true, color: true } });

    const series = surveys
      .map((s) => {
        const n = s.responses.length;
        const avg = n ? s.responses.reduce((a, r) => a + r.score, 0) / n : null;
        const dist = [1, 2, 3, 4, 5].map((score) => s.responses.filter((r) => r.score === score).length);
        const promoters = s.responses.filter((r) => r.score >= 4).length;
        const detractors = s.responses.filter((r) => r.score <= 2).length;
        return {
          id: s.id,
          weekStart: s.weekStart,
          status: s.status,
          question: s.question,
          responses: n,
          participation: headcount ? n / headcount : 0,
          average: avg,
          distribution: dist,
          /** "Índice de felicidade": % satisfeitos − % insatisfeitos (−100 a 100) */
          happinessIndex: n ? Math.round(((promoters - detractors) / n) * 100) : null,
        };
      })
      .reverse();

    const latest = surveys[0];
    const byDepartment = latest
      ? departments
          .map((d) => {
            const rs = latest.responses.filter((r) => r.departmentId === d.id);
            if (rs.length < PULSE_MIN_GROUP) return { ...d, responses: rs.length, average: null, hidden: true };
            return { ...d, responses: rs.length, average: rs.reduce((a, r) => a + r.score, 0) / rs.length, hidden: false };
          })
          .filter((d) => d.responses > 0)
      : [];

    const comments = surveys
      .flatMap((s) =>
        s.responses
          .filter((r) => r.comment)
          .map((r) => ({
            id: r.id,
            weekStart: s.weekStart,
            score: r.score,
            comment: decryptText(r.comment),
            author: r.anonymous ? null : r.user.name,
            createdAt: r.createdAt,
          })),
      )
      .slice(0, 50);

    return { headcount, series, byDepartment, comments, minGroup: PULSE_MIN_GROUP };
  });
}
