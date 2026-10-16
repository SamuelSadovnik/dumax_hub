import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { formatGoalValue, goalElapsed, goalProgress } from '@dumax/shared';
import { prisma, userLite } from '../../lib/prisma';
import { authenticate, canSeeUser, getSubordinateIds, isHR, visibleUserIds, type AuthUser } from '../../lib/auth';
import { badRequest, forbidden, notFound, parse } from '../../lib/http';
import { notify } from '../../lib/notify';

const goalInput = z.object({
  title: z.string().min(3).max(200),
  description: z.string().max(3000).nullish(),
  ownerId: z.string(),
  teamId: z.string().nullish(),
  unit: z.enum(['un', '%', 'R$', 'h']).default('un'),
  startValue: z.number().default(0),
  targetValue: z.number(),
  currentValue: z.number().optional(),
  startDate: z.coerce.date(),
  dueDate: z.coerce.date(),
});

const include = {
  owner: { select: userLite },
  createdBy: { select: userLite },
  team: { select: { id: true, name: true } },
  checkins: { orderBy: { createdAt: 'desc' as const }, take: 20, include: { author: { select: userLite } } },
} satisfies Prisma.GoalInclude;

/** Quem pode criar/editar metas de alguém: a própria pessoa, o gestor acima ou o RH */
async function canManageGoalsOf(me: AuthUser, ownerId: string) {
  if (ownerId === me.id || isHR(me)) return true;
  return me.role === 'MANAGER' && (await getSubordinateIds(me.id)).includes(ownerId);
}

const decorate = <G extends { startValue: number; targetValue: number; currentValue: number; startDate: Date; dueDate: Date }>(g: G) => ({
  ...g,
  progress: goalProgress(g),
  elapsed: goalElapsed(g),
});

export async function goalRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.get('/', async (req) => {
    const q = parse(
      z.object({ scope: z.enum(['mine', 'team', 'all']).default('mine'), userId: z.string().optional(), status: z.enum(['ACTIVE', 'COMPLETED', 'CANCELED']).optional() }),
      req.query,
    );
    let ownerFilter: Prisma.GoalWhereInput['ownerId'];
    if (q.userId) {
      if (!(await canSeeUser(req.auth, q.userId))) throw forbidden();
      ownerFilter = q.userId;
    } else if (q.scope === 'mine') ownerFilter = req.auth.id;
    else {
      const scope = await visibleUserIds(req.auth);
      ownerFilter = scope ? { in: scope } : undefined;
    }
    const goals = await prisma.goal.findMany({
      where: { ownerId: ownerFilter, status: q.status ?? { not: 'CANCELED' } },
      orderBy: [{ status: 'asc' }, { dueDate: 'asc' }],
      include,
    });
    return goals.map(decorate);
  });

  app.post('/', async (req) => {
    const body = parse(goalInput, req.body);
    if (body.dueDate < body.startDate) throw badRequest('O prazo precisa ser depois do início');
    if (!(await canManageGoalsOf(req.auth, body.ownerId))) throw forbidden('Você só cria metas para você ou para o seu time');
    const goal = await prisma.goal.create({
      data: { ...body, currentValue: body.currentValue ?? body.startValue, higherIsBetter: body.targetValue >= body.startValue, createdById: req.auth.id },
      include,
    });
    if (body.ownerId !== req.auth.id) {
      await notify([body.ownerId], { type: 'goal.new', title: `Nova meta: ${goal.title}`, body: `Alvo: ${formatGoalValue(goal.targetValue, goal.unit)}`, link: '/metas' });
    }
    return decorate(goal);
  });

  app.patch('/:id', async (req) => {
    const { id } = req.params as { id: string };
    const goal = await prisma.goal.findUnique({ where: { id } });
    if (!goal) throw notFound('Meta não encontrada');
    if (!(await canManageGoalsOf(req.auth, goal.ownerId))) throw forbidden();
    const body = parse(goalInput.partial().extend({ status: z.enum(['ACTIVE', 'COMPLETED', 'CANCELED']).optional() }), req.body);
    const start = body.startValue ?? goal.startValue;
    const target = body.targetValue ?? goal.targetValue;
    return decorate(await prisma.goal.update({ where: { id }, data: { ...body, higherIsBetter: target >= start }, include }));
  });

  /** Atualização de progresso (check-in) */
  app.post('/:id/checkins', async (req) => {
    const { id } = req.params as { id: string };
    const body = parse(z.object({ value: z.number(), note: z.string().max(2000).optional() }), req.body);
    const goal = await prisma.goal.findUnique({ where: { id } });
    if (!goal) throw notFound('Meta não encontrada');
    if (!(await canManageGoalsOf(req.auth, goal.ownerId))) throw forbidden();
    await prisma.goalCheckin.create({ data: { goalId: id, authorId: req.auth.id, value: body.value, note: body.note } });
    const updated = await prisma.goal.update({ where: { id }, data: { currentValue: body.value }, include });
    if (goal.createdById !== req.auth.id) {
      await notify([goal.createdById], {
        type: 'goal.checkin',
        title: `${req.auth.name} atualizou "${goal.title}"`,
        body: `${formatGoalValue(body.value, goal.unit)} de ${formatGoalValue(goal.targetValue, goal.unit)}`,
        link: '/metas',
      });
    }
    return decorate(updated);
  });

  app.delete('/:id', async (req) => {
    const { id } = req.params as { id: string };
    const goal = await prisma.goal.findUnique({ where: { id } });
    if (!goal) throw notFound();
    if (goal.createdById !== req.auth.id && !isHR(req.auth)) throw forbidden('Só quem criou a meta pode excluir');
    await prisma.goal.delete({ where: { id } });
    return { ok: true };
  });
}
