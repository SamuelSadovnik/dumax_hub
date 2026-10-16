import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { authenticate, canSeeUser } from '../../lib/auth';
import { badRequest, forbidden, notFound, parse } from '../../lib/http';

const activityEnum = z.enum(['EXECUCAO', 'REUNIAO', 'SUPORTE', 'RETRABALHO', 'ESTUDO', 'ADMINISTRATIVO']);
const include = { task: { select: { id: true, title: true } } } as const;

/** Para o cronômetro aberto do usuário (se houver) */
export async function stopRunningTimer(userId: string, onlyTaskId?: string) {
  const running = await prisma.timeLog.findFirst({ where: { userId, endedAt: null, ...(onlyTaskId ? { taskId: onlyTaskId } : {}) } });
  if (!running) return null;
  const endedAt = new Date();
  // trava em 12h para não inflar horas se alguém esquecer o cronômetro ligado
  const minutes = Math.min(12 * 60, Math.max(1, Math.round((endedAt.getTime() - running.startedAt.getTime()) / 60000)));
  return prisma.timeLog.update({ where: { id: running.id }, data: { endedAt, minutes }, include });
}

export async function timelogRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.get('/', async (req) => {
    const q = parse(z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional(), userId: z.string().optional() }), req.query);
    const userId = q.userId ?? req.auth.id;
    if (userId !== req.auth.id && !(await canSeeUser(req.auth, userId))) throw forbidden();
    const from = q.from ?? new Date(Date.now() - 7 * 86400000);
    return prisma.timeLog.findMany({
      where: { userId, startedAt: { gte: from, ...(q.to ? { lt: q.to } : {}) } },
      orderBy: { startedAt: 'desc' },
      take: 500,
      include,
    });
  });

  app.get('/running', async (req) => prisma.timeLog.findFirst({ where: { userId: req.auth.id, endedAt: null }, include }));

  /** Inicia o cronômetro (para o anterior, se houver) */
  app.post('/start', async (req) => {
    const body = parse(
      z.object({ taskId: z.string().nullish(), activity: activityEnum.default('EXECUCAO'), description: z.string().max(300).nullish() }),
      req.body,
    );
    if (body.taskId) {
      const t = await prisma.task.findUnique({ where: { id: body.taskId }, select: { assigneeId: true, status: true } });
      if (!t) throw notFound('Demanda não encontrada');
      if (t.assigneeId !== req.auth.id) throw forbidden('Só o responsável registra horas na demanda');
      if (t.status === 'TODO') await prisma.task.update({ where: { id: body.taskId }, data: { status: 'IN_PROGRESS', startedAt: new Date() } });
    }
    await stopRunningTimer(req.auth.id);
    return prisma.timeLog.create({
      data: { userId: req.auth.id, taskId: body.taskId ?? null, activity: body.activity, description: body.description, startedAt: new Date() },
      include,
    });
  });

  app.post('/stop', async (req) => (await stopRunningTimer(req.auth.id)) ?? { stopped: false });

  /** Lançamento manual ("ontem fiquei 2h em suporte") */
  app.post('/', async (req) => {
    const body = parse(
      z.object({
        taskId: z.string().nullish(),
        activity: activityEnum.default('EXECUCAO'),
        description: z.string().max(300).nullish(),
        startedAt: z.coerce.date(),
        minutes: z.number().int().min(1).max(16 * 60),
      }),
      req.body,
    );
    if (body.startedAt > new Date()) throw badRequest('Não dá para lançar horas no futuro');
    if (body.taskId) {
      const t = await prisma.task.findUnique({ where: { id: body.taskId }, select: { assigneeId: true } });
      if (t?.assigneeId !== req.auth.id) throw forbidden('Só o responsável registra horas na demanda');
    }
    return prisma.timeLog.create({
      data: {
        userId: req.auth.id,
        taskId: body.taskId ?? null,
        activity: body.activity,
        description: body.description,
        startedAt: body.startedAt,
        endedAt: new Date(body.startedAt.getTime() + body.minutes * 60000),
        minutes: body.minutes,
      },
      include,
    });
  });

  app.delete('/:id', async (req) => {
    const { id } = req.params as { id: string };
    const log = await prisma.timeLog.findUnique({ where: { id } });
    if (!log) throw notFound();
    if (log.userId !== req.auth.id) throw forbidden();
    await prisma.timeLog.delete({ where: { id } });
    return { ok: true };
  });
}
