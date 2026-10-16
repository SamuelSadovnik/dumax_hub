import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { Prisma, type Stage } from '@prisma/client';
import { STAGE_LABEL, PROFILES, type AssessmentResult, type ProfileKey } from '@dumax/shared';
import { prisma, userLite } from '../lib/prisma';
import { authenticate, requireRole } from '../lib/auth';
import { badRequest, conflict, notFound, parse } from '../lib/http';
import { mimeOf, readPrivate, saveUpload } from '../lib/storage';
import { decryptText, encryptText } from '../lib/crypto';
import { mailLayout, sendMail } from '../lib/mailer';
import { hrUserIds, notify } from '../lib/notify';
import { env } from '../env';
import { publicQuestions, scoreDisc } from './assessments/disc';
import { analyzeFit } from './profiles';
import { profileFit, normalizeProfile, type ProfileScores } from '@dumax/shared';

const stageEnum = z.enum(['APPLIED', 'SCREENING', 'ASSESSMENT', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED']);

const jobInput = z.object({
  title: z.string().min(3, 'O título precisa de pelo menos 3 letras'),
  summary: z.string().max(300).nullish(),
  description: z.string().min(3, 'Escreva a descrição da vaga'),
  requirements: z.string().nullish(),
  benefits: z.string().nullish(),
  location: z.string().nullish(),
  workMode: z.enum(['REMOTE', 'HYBRID', 'ONSITE']).default('ONSITE'),
  employmentType: z.enum(['CLT', 'PJ', 'ESTAGIO', 'TEMPORARIO', 'FREELANCER']).default('CLT'),
  salaryMin: z.number().int().nonnegative().nullish(),
  salaryMax: z.number().int().nonnegative().nullish(),
  showSalary: z.boolean().default(false),
  openings: z.number().int().min(1).default(1),
  status: z.enum(['DRAFT', 'OPEN', 'PAUSED', 'CLOSED']).default('DRAFT'),
  autoSendAssessment: z.boolean().default(true),
  departmentId: z.string().nullish(),
  closesAt: z.coerce.date().nullish(),
  idealProfile: z
    .object({ EXECUTOR: z.number().min(0).max(100), COMUNICADOR: z.number().min(0).max(100), PLANEJADOR: z.number().min(0).max(100), ANALISTA: z.number().min(0).max(100) })
    .nullish(),
});

const slugify = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 60);

const publicJobSelect = {
  id: true,
  slug: true,
  title: true,
  summary: true,
  description: true,
  requirements: true,
  benefits: true,
  location: true,
  workMode: true,
  employmentType: true,
  salaryMin: true,
  salaryMax: true,
  showSalary: true,
  openings: true,
  publishedAt: true,
  closesAt: true,
  department: { select: { name: true, color: true } },
} as const;

function hidePrivateSalary<T extends { showSalary: boolean; salaryMin: number | null; salaryMax: number | null }>(j: T) {
  return j.showSalary ? j : { ...j, salaryMin: null, salaryMax: null };
}

/** Descriptografa os campos sensíveis do candidato antes de devolver */
const decCandidate = <C extends { phone: string }>(c: C): C => ({ ...c, phone: decryptText(c.phone) });

const assessmentUrl = (token: string) => `${env.WEB_URL}/teste/${token}`;
const whatsappLink = (phone: string, text: string) => {
  let digits = phone.replace(/\D/g, '');
  if (digits.length <= 11) digits = `55${digits}`; // assume Brasil
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
};

/** Cria convite de teste e registra no histórico */
async function createAssessmentInvite(applicationId: string, authorId: string | null) {
  const app = await prisma.application.findUniqueOrThrow({
    where: { id: applicationId },
    include: { candidate: true, job: true },
  });
  const invite = await prisma.assessmentInvite.create({
    data: {
      applicationId,
      token: randomBytes(18).toString('base64url'),
      expiresAt: new Date(Date.now() + 7 * 86400000),
    },
  });
  const url = assessmentUrl(invite.token);
  const fromStage = app.stage;
  await prisma.application.update({
    where: { id: applicationId },
    data: fromStage === 'APPLIED' || fromStage === 'SCREENING' ? { stage: 'ASSESSMENT', stageUpdatedAt: new Date() } : {},
  });
  await prisma.applicationEvent.create({
    data: {
      applicationId,
      type: 'ASSESSMENT_SENT',
      authorId,
      body: 'Teste de perfil enviado',
      meta: { url },
      ...(fromStage === 'APPLIED' || fromStage === 'SCREENING' ? { fromStage, toStage: 'ASSESSMENT' as Stage } : {}),
    },
  });
  const first = app.candidate.name.split(' ')[0];
  await sendMail(
    app.candidate.email,
    `Próxima etapa: ${app.job.title}`,
    mailLayout(
      `Olá, ${first}!`,
      [
        `Recebemos sua candidatura para ${app.job.title}. A próxima etapa é um teste rápido de perfil comportamental (cerca de 5 minutos).`,
        'Não existe resposta certa ou errada — responda com sinceridade.',
        'O link vale por 7 dias.',
      ],
      { label: 'Fazer o teste', url },
    ),
  );
  return {
    invite,
    url,
    whatsapp: whatsappLink(
      decryptText(app.candidate.phone),
      `Olá, ${first}! Aqui é da Dumax. Recebemos sua candidatura para *${app.job.title}*. A próxima etapa é um teste rápido de perfil: ${url}`,
    ),
  };
}

export async function recruitmentRoutes(app: FastifyInstance) {
  // ══════════════ Rotas PÚBLICAS (site de vagas + teste) ══════════════

  app.get('/public/jobs', async () => {
    const jobs = await prisma.job.findMany({
      where: { status: 'OPEN' },
      select: publicJobSelect,
      orderBy: { publishedAt: 'desc' },
    });
    return jobs.map(hidePrivateSalary);
  });

  app.get('/public/jobs/:slug', async (req) => {
    const { slug } = req.params as { slug: string };
    const job = await prisma.job.findFirst({ where: { slug, status: 'OPEN' }, select: publicJobSelect });
    if (!job) throw notFound('Vaga não encontrada ou encerrada');
    return hidePrivateSalary(job);
  });

  /** Candidatura: multipart com campos + arquivo "resume" */
  app.post('/public/jobs/:slug/apply', async (req) => {
    const { slug } = req.params as { slug: string };
    const job = await prisma.job.findFirst({ where: { slug, status: 'OPEN' } });
    if (!job) throw notFound('Vaga não encontrada ou encerrada');

    const fields: Record<string, string> = {};
    let resume: Awaited<ReturnType<typeof saveUpload>> | null = null;
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        if (part.fieldname !== 'resume' || resume) {
          part.file.resume();
          continue;
        }
        resume = await saveUpload(part, {
          folder: 'resumes',
          allowedExt: ['.pdf', '.doc', '.docx'],
        });
      } else {
        fields[part.fieldname] = String(part.value ?? '');
      }
    }

    const data = parse(
      z.object({
        name: z.string().min(3, 'Informe seu nome completo'),
        email: z.string().email('E-mail inválido'),
        phone: z.string().min(10, 'Telefone inválido').max(20),
        linkedinUrl: z.string().url().optional().or(z.literal('')),
        city: z.string().optional(),
        coverLetter: z.string().max(3000).optional(),
        source: z.string().max(60).optional(),
        consent: z.literal('true', { errorMap: () => ({ message: 'É preciso aceitar o uso dos dados (LGPD)' }) }),
      }),
      fields,
    );
    if (!resume) throw badRequest('Anexe seu currículo (PDF ou Word)');

    const email = data.email.toLowerCase().trim();
    const candidate = await prisma.candidate.upsert({
      where: { email },
      create: { name: data.name, email, phone: encryptText(data.phone), linkedinUrl: data.linkedinUrl || null, city: data.city },
      update: { name: data.name, phone: encryptText(data.phone), linkedinUrl: data.linkedinUrl || undefined, city: data.city },
    });

    const existing = await prisma.application.findUnique({
      where: { jobId_candidateId: { jobId: job.id, candidateId: candidate.id } },
    });
    if (existing) throw conflict('Você já se candidatou a esta vaga. Em breve entraremos em contato!');

    const application = await prisma.application.create({
      data: {
        jobId: job.id,
        candidateId: candidate.id,
        resumePath: resume.key,
        resumeName: resume.name,
        coverLetter: encryptText(data.coverLetter),
        source: data.source || 'site',
        events: { create: { type: 'CREATED', body: 'Candidatura recebida pelo site', toStage: 'APPLIED' } },
      },
    });

    await notify(await hrUserIds(), {
      type: 'application.new',
      title: `Nova candidatura: ${candidate.name}`,
      body: job.title,
      link: `/admin/recrutamento/candidaturas/${application.id}`,
    });

    let assessmentLink: string | null = null;
    if (job.autoSendAssessment) {
      const { url } = await createAssessmentInvite(application.id, null);
      assessmentLink = url;
    }
    return { ok: true, applicationId: application.id, assessmentUrl: assessmentLink };
  });

  /** Teste público por token */
  app.get('/public/assessments/:token', async (req) => {
    const { token } = req.params as { token: string };
    const invite = await prisma.assessmentInvite.findUnique({
      where: { token },
      include: { application: { include: { candidate: true, job: true } } },
    });
    if (!invite) throw notFound('Link de teste inválido');
    const expired = invite.status === 'PENDING' && invite.expiresAt < new Date();
    if (expired) await prisma.assessmentInvite.update({ where: { id: invite.id }, data: { status: 'EXPIRED' } });
    if (invite.status === 'PENDING' && !expired && !invite.startedAt) {
      await prisma.assessmentInvite.update({ where: { id: invite.id }, data: { startedAt: new Date() } });
    }
    const result = invite.result as AssessmentResult | null;
    return {
      status: expired ? 'EXPIRED' : invite.status,
      candidateName: invite.application.candidate.name.split(' ')[0],
      jobTitle: invite.application.job.title,
      questions: invite.status === 'PENDING' && !expired ? publicQuestions() : [],
      result: result ? { primary: result.primary, secondary: result.secondary } : null,
    };
  });

  app.post('/public/assessments/:token', async (req) => {
    const { token } = req.params as { token: string };
    const body = parse(z.object({ answers: z.record(z.string()) }), req.body);
    const invite = await prisma.assessmentInvite.findUnique({
      where: { token },
      include: { application: { include: { candidate: true, job: true } } },
    });
    if (!invite) throw notFound('Link de teste inválido');
    if (invite.status !== 'PENDING') throw badRequest('Este teste já foi respondido');
    if (invite.expiresAt < new Date()) throw badRequest('Este link expirou. Fale com o RH.');

    const result = scoreDisc(body.answers);
    if (result.answered < 15) throw badRequest('Responda todas as perguntas, por favor');

    await prisma.$transaction([
      prisma.assessmentInvite.update({
        where: { id: invite.id },
        data: {
          status: 'COMPLETED',
          answers: body.answers,
          result: result as unknown as Prisma.InputJsonValue,
          primaryProfile: result.primary,
          completedAt: new Date(),
        },
      }),
      prisma.applicationEvent.create({
        data: {
          applicationId: invite.applicationId,
          type: 'ASSESSMENT_COMPLETED',
          body: `Teste concluído — perfil ${PROFILES[result.primary].label} / ${PROFILES[result.secondary].label}`,
          meta: result as unknown as Prisma.InputJsonValue,
        },
      }),
    ]);

    await notify(await hrUserIds(), {
      type: 'assessment.completed',
      title: `${invite.application.candidate.name} concluiu o teste`,
      body: `Perfil ${PROFILES[result.primary].label} · ${invite.application.job.title}`,
      link: `/admin/recrutamento/candidaturas/${invite.applicationId}`,
    });
    return { primary: result.primary, secondary: result.secondary };
  });

  // ══════════════ Rotas do RH (autenticadas) ══════════════

  app.register(async (hr) => {
    hr.addHook('preHandler', authenticate);
    hr.addHook('preHandler', requireRole('ADMIN', 'HR', 'MANAGER'));
    const hrOnly = { preHandler: requireRole('ADMIN', 'HR') };

    hr.get('/jobs', async () => {
      const jobs = await prisma.job.findMany({
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        include: {
          department: { select: { id: true, name: true, color: true } },
          createdBy: { select: userLite },
        },
      });
      const counts = await prisma.application.groupBy({ by: ['jobId', 'stage'], _count: true });
      const sources = await prisma.application.groupBy({ by: ['jobId', 'source'], _count: true });
      const weekAgo = new Date(Date.now() - 7 * 86400000);
      const recent = await prisma.application.groupBy({ by: ['jobId'], where: { createdAt: { gte: weekAgo } }, _count: true });
      return jobs.map((j) => {
        const byStage: Partial<Record<Stage, number>> = {};
        let total = 0;
        for (const c of counts.filter((c) => c.jobId === j.id)) {
          byStage[c.stage] = c._count;
          total += c._count;
        }
        const bySource: Record<string, number> = {};
        for (const c of sources.filter((c) => c.jobId === j.id)) bySource[c.source ?? 'site'] = (bySource[c.source ?? 'site'] ?? 0) + c._count;
        return { ...j, applicationsTotal: total, byStage, bySource, lastWeek: recent.find((r) => r.jobId === j.id)?._count ?? 0 };
      });
    });

    hr.get('/jobs/:id', async (req) => {
      const { id } = req.params as { id: string };
      const job = await prisma.job.findUnique({
        where: { id },
        include: { department: { select: { id: true, name: true, color: true } } },
      });
      if (!job) throw notFound('Vaga não encontrada');
      return job;
    });

    hr.post('/jobs', hrOnly, async (req) => {
      const body = parse(jobInput, req.body);
      const slug = `${slugify(body.title)}-${randomBytes(3).toString('hex')}`;
      const { idealProfile, ...rest } = body;
      return prisma.job.create({
        data: {
          ...rest,
          idealProfile: idealProfile ? normalizeProfile(idealProfile) : undefined,
          slug,
          createdById: req.auth.id,
          publishedAt: body.status === 'OPEN' ? new Date() : null,
        },
      });
    });

    hr.patch('/jobs/:id', hrOnly, async (req) => {
      const { id } = req.params as { id: string };
      const body = parse(jobInput.partial(), req.body);
      const current = await prisma.job.findUniqueOrThrow({ where: { id } });
      const { idealProfile, ...rest } = body;
      return prisma.job.update({
        where: { id },
        data: {
          ...rest,
          ...(idealProfile !== undefined ? { idealProfile: idealProfile ? normalizeProfile(idealProfile) : Prisma.DbNull } : {}),
          publishedAt: body.status === 'OPEN' && !current.publishedAt ? new Date() : undefined,
        },
      });
    });

    hr.delete('/jobs/:id', hrOnly, async (req) => {
      const { id } = req.params as { id: string };
      await prisma.job.delete({ where: { id } });
      return { ok: true };
    });

    /** Pipeline (kanban) da vaga */
    hr.get('/jobs/:id/applications', async (req) => {
      const { id } = req.params as { id: string };
      const job = await prisma.job.findUniqueOrThrow({ where: { id }, select: { idealProfile: true } });
      const ideal = job.idealProfile ? normalizeProfile(job.idealProfile as Partial<ProfileScores>) : null;
      const apps = await prisma.application.findMany({
        where: { jobId: id },
        orderBy: { createdAt: 'desc' },
        include: {
          candidate: true,
          assessments: {
            where: { status: 'COMPLETED' },
            orderBy: { completedAt: 'desc' },
            take: 1,
            select: { primaryProfile: true, result: true },
          },
        },
      });
      return apps.map(({ assessments, resumePath: _r, ...a }) => {
        const result = assessments[0]?.result as unknown as AssessmentResult | undefined;
        return {
          ...a,
          candidate: decCandidate(a.candidate),
          coverLetter: null,
          hasResume: Boolean(_r),
          profile: (assessments[0]?.primaryProfile as ProfileKey | undefined) ?? null,
          fit: result && ideal ? profileFit(result.scores, ideal) : null,
        };
      });
    });

    /** Banco de talentos: todas as candidaturas com filtro */
    hr.get('/applications', async (req) => {
      const q = parse(
        z.object({ stage: stageEnum.optional(), search: z.string().optional(), profile: z.string().optional() }),
        req.query,
      );
      return prisma.application.findMany({
        where: {
          stage: q.stage,
          ...(q.search
            ? { candidate: { OR: [{ name: { contains: q.search, mode: 'insensitive' } }, { email: { contains: q.search, mode: 'insensitive' } }] } }
            : {}),
          ...(q.profile ? { assessments: { some: { primaryProfile: q.profile } } } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
        include: {
          candidate: true,
          job: { select: { id: true, title: true } },
          assessments: { where: { status: 'COMPLETED' }, select: { primaryProfile: true }, take: 1 },
        },
      });
    });

    hr.get('/applications/:id', async (req) => {
      const { id } = req.params as { id: string };
      const a = await prisma.application.findUnique({
        where: { id },
        include: {
          candidate: { include: { applications: { select: { id: true, stage: true, createdAt: true, job: { select: { title: true } } } } } },
          job: { select: { id: true, title: true, slug: true, idealProfile: true, departmentId: true, department: { select: { name: true } } } },
          events: { orderBy: { createdAt: 'desc' }, include: { author: { select: userLite } } },
          assessments: { orderBy: { createdAt: 'desc' } },
        },
      });
      if (!a) throw notFound('Candidatura não encontrada');
      const done = a.assessments.find((x) => x.status === 'COMPLETED' && x.result);
      const analysis = done ? await analyzeFit((done.result as unknown as AssessmentResult).scores, a.job) : null;
      return {
        analysis,
        ...a,
        candidate: decCandidate(a.candidate),
        coverLetter: decryptText(a.coverLetter),
        rejectionReason: decryptText(a.rejectionReason),
        assessments: a.assessments.map(({ answers: _a, ...rest }) => ({ ...rest, url: assessmentUrl(rest.token) })),
        whatsappUrl: whatsappLink(decryptText(a.candidate.phone), `Olá, ${a.candidate.name.split(' ')[0]}! Aqui é do RH da Dumax, sobre a vaga ${a.job.title}.`),
      };
    });

    hr.get('/applications/:id/resume', async (req, reply) => {
      const { id } = req.params as { id: string };
      const a = await prisma.application.findUnique({ where: { id }, select: { resumePath: true, resumeName: true } });
      if (!a?.resumePath) throw notFound('Currículo não encontrado');
      reply.header('Content-Disposition', `inline; filename="${encodeURIComponent(a.resumeName ?? 'curriculo')}"`);
      reply.type(mimeOf(a.resumePath));
      return reply.send(await readPrivate(a.resumePath));
    });

    /** Move de etapa (drag no kanban) */
    hr.patch('/applications/:id/stage', hrOnly, async (req) => {
      const { id } = req.params as { id: string };
      const body = parse(
        z.object({ stage: stageEnum, note: z.string().max(2000).optional(), rejectionReason: z.string().max(500).optional(), notifyCandidate: z.boolean().default(false) }),
        req.body,
      );
      const current = await prisma.application.findUniqueOrThrow({ where: { id }, include: { candidate: true, job: true } });
      if (current.stage === body.stage) return current;

      const updated = await prisma.application.update({
        where: { id },
        data: {
          stage: body.stage,
          stageUpdatedAt: new Date(),
          hiredAt: body.stage === 'HIRED' ? new Date() : undefined,
          rejectionReason: body.stage === 'REJECTED' ? encryptText(body.rejectionReason ?? null) : undefined,
          events: {
            create: {
              type: 'STAGE_CHANGED',
              fromStage: current.stage,
              toStage: body.stage,
              authorId: req.auth.id,
              body: body.note ?? `${STAGE_LABEL[current.stage]} → ${STAGE_LABEL[body.stage]}`,
            },
          },
        },
      });

      if (body.notifyCandidate) {
        const first = current.candidate.name.split(' ')[0];
        const msgs: Partial<Record<Stage, string[]>> = {
          INTERVIEW: [`Boa notícia: você avançou para a etapa de entrevista da vaga ${current.job.title}! Em breve nosso time entra em contato para agendar.`],
          OFFER: [`Parabéns! Gostaríamos de fazer uma proposta para a vaga ${current.job.title}. Entraremos em contato com os detalhes.`],
          HIRED: [`Seja muito bem-vindo(a) à Dumax! 🎉`],
          REJECTED: [
            `Agradecemos muito seu interesse na vaga ${current.job.title}. Neste momento seguiremos com outros perfis.`,
            'Seu currículo continuará no nosso banco de talentos para próximas oportunidades.',
          ],
        };
        const paragraphs = msgs[body.stage];
        if (paragraphs) {
          await sendMail(current.candidate.email, `Atualização da sua candidatura — ${current.job.title}`, mailLayout(`Olá, ${first}`, paragraphs));
          await prisma.applicationEvent.create({
            data: { applicationId: id, type: 'CONTACTED', authorId: req.auth.id, body: 'E-mail automático de mudança de etapa enviado', meta: { channel: 'EMAIL' } },
          });
        }
      }
      return updated;
    });

    hr.patch('/applications/:id/rating', hrOnly, async (req) => {
      const { id } = req.params as { id: string };
      const { rating } = parse(z.object({ rating: z.number().int().min(1).max(5) }), req.body);
      return prisma.application.update({
        where: { id },
        data: { rating, events: { create: { type: 'RATED', authorId: req.auth.id, body: `Avaliação: ${'★'.repeat(rating)}` } } },
      });
    });

    hr.post('/applications/:id/notes', async (req) => {
      const { id } = req.params as { id: string };
      const { body } = parse(z.object({ body: z.string().min(1).max(5000) }), req.body);
      return prisma.applicationEvent.create({
        data: { applicationId: id, type: 'NOTE', authorId: req.auth.id, body },
        include: { author: { select: userLite } },
      });
    });

    hr.post('/applications/:id/assessment', hrOnly, async (req) => {
      const { id } = req.params as { id: string };
      const { url, whatsapp } = await createAssessmentInvite(id, req.auth.id);
      return { url, whatsapp };
    });

    /** Contato com o candidato (e-mail enviado pela plataforma ou link de WhatsApp) */
    hr.post('/applications/:id/contact', hrOnly, async (req) => {
      const { id } = req.params as { id: string };
      const body = parse(
        z.object({ channel: z.enum(['EMAIL', 'WHATSAPP']), subject: z.string().max(200).optional(), message: z.string().min(1).max(5000) }),
        req.body,
      );
      const a = await prisma.application.findUniqueOrThrow({ where: { id }, include: { candidate: true, job: true } });
      let whatsappUrl: string | undefined;
      if (body.channel === 'EMAIL') {
        await sendMail(
          a.candidate.email,
          body.subject || `Sobre sua candidatura — ${a.job.title}`,
          mailLayout(`Olá, ${a.candidate.name.split(' ')[0]}`, body.message.split(/\n{2,}/)),
        );
      } else {
        whatsappUrl = whatsappLink(decryptText(a.candidate.phone), body.message);
      }
      await prisma.applicationEvent.create({
        data: {
          applicationId: id,
          type: 'CONTACTED',
          authorId: req.auth.id,
          body: body.message,
          meta: { channel: body.channel, subject: body.subject ?? null },
        },
      });
      return { ok: true, whatsappUrl };
    });
  });
}
