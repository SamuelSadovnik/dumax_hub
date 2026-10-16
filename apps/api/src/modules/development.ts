import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AuthUser } from '../lib/auth';
import { prisma, userLite } from '../lib/prisma';
import { authenticate, canSeeUser, isHR, visibleUserIds } from '../lib/auth';
import { forbidden, notFound, parse } from '../lib/http';
import { notify } from '../lib/notify';

const kindEnum = z.enum(['CURSO', 'PRATICA', 'MENTORIA', 'LEITURA', 'OUTRO']);
const planInclude = {
  createdBy: { select: userLite },
  actions: { orderBy: [{ done: 'asc' as const }, { dueDate: { sort: 'asc' as const, nulls: 'last' as const } }, { createdAt: 'asc' as const }] },
} as const;

/** Quem vê e edita o PDI de alguém: a própria pessoa, gestores acima dela e o RH */
async function canAccess(user: AuthUser, userId: string) {
  if (user.id === userId || isHR(user)) return true;
  return user.role !== 'EMPLOYEE' && (await canSeeUser(user, userId));
}

async function planFor(user: AuthUser, id: string) {
  const plan = await prisma.developmentPlan.findUnique({ where: { id } });
  if (!plan) throw notFound('PDI não encontrado');
  if (!(await canAccess(user, plan.userId))) throw forbidden();
  return plan;
}

/** PDI: objetivo de desenvolvimento + ações (curso, prática, mentoria, leitura) com prazo */
export async function developmentRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.get('/', async (req) => {
    const q = parse(z.object({ userId: z.string().optional() }), req.query);
    const userId = q.userId ?? req.auth.id;
    if (!(await canAccess(req.auth, userId))) throw forbidden();
    const [user, plans] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { ...userLite, managerId: true } }),
      prisma.developmentPlan.findMany({ where: { userId }, orderBy: [{ status: 'asc' }, { createdAt: 'desc' }], include: planInclude }),
    ]);
    return { user, plans, canEdit: true };
  });

  /** Visão do gestor/RH: quem tem PDI ativo e o progresso */
  app.get('/team', async (req) => {
    if (req.auth.role === 'EMPLOYEE') throw forbidden();
    const scope = await visibleUserIds(req.auth);
    const users = await prisma.user.findMany({
      where: { active: true, id: { not: req.auth.id, ...(scope ? { in: scope } : {}) } },
      select: { ...userLite, department: { select: { name: true } } },
      orderBy: { name: 'asc' },
    });
    const plans = await prisma.developmentPlan.findMany({ where: { userId: { in: users.map((u) => u.id) }, status: 'ACTIVE' }, select: { userId: true, actions: { select: { done: true } } } });
    return users.map((u) => {
      const mine = plans.filter((p) => p.userId === u.id);
      const actions = mine.flatMap((p) => p.actions);
      return { user: u, activePlans: mine.length, actions: actions.length, done: actions.filter((a) => a.done).length };
    });
  });

  app.post('/', async (req) => {
    const body = parse(
      z.object({
        userId: z.string(),
        title: z.string().trim().min(3, 'Escreva o objetivo').max(200),
        focus: z.string().trim().max(120).nullish(),
        dueDate: z.coerce.date().nullish(),
        actions: z.array(z.object({ text: z.string().trim().min(2).max(300), kind: kindEnum.default('PRATICA'), dueDate: z.coerce.date().nullish() })).max(20).default([]),
      }),
      req.body,
    );
    if (!(await canAccess(req.auth, body.userId))) throw forbidden();
    const plan = await prisma.developmentPlan.create({
      data: { userId: body.userId, createdById: req.auth.id, title: body.title, focus: body.focus, dueDate: body.dueDate, actions: { create: body.actions } },
      include: planInclude,
    });
    if (body.userId !== req.auth.id) {
      await notify([body.userId], { type: 'pdi.created', title: 'Novo plano de desenvolvimento para você', body: body.title, link: '/pdi' });
    }
    return plan;
  });

  app.patch('/:id', async (req) => {
    const { id } = req.params as { id: string };
    await planFor(req.auth, id);
    const body = parse(
      z.object({ title: z.string().trim().min(3).max(200).optional(), focus: z.string().trim().max(120).nullish(), status: z.enum(['ACTIVE', 'DONE', 'CANCELED']).optional(), dueDate: z.coerce.date().nullish() }),
      req.body,
    );
    return prisma.developmentPlan.update({ where: { id }, data: body, include: planInclude });
  });

  app.delete('/:id', async (req) => {
    const { id } = req.params as { id: string };
    await planFor(req.auth, id);
    await prisma.developmentPlan.delete({ where: { id } });
    return { ok: true };
  });

  app.post('/:id/actions', async (req) => {
    const { id } = req.params as { id: string };
    await planFor(req.auth, id);
    const body = parse(z.object({ text: z.string().trim().min(2).max(300), kind: kindEnum.default('PRATICA'), dueDate: z.coerce.date().nullish() }), req.body);
    return prisma.developmentAction.create({ data: { planId: id, ...body } });
  });

  app.patch('/actions/:actionId', async (req) => {
    const { actionId } = req.params as { actionId: string };
    const action = await prisma.developmentAction.findUnique({ where: { id: actionId } });
    if (!action) throw notFound();
    const plan = await planFor(req.auth, action.planId);
    const body = parse(z.object({ done: z.boolean().optional(), text: z.string().trim().min(2).max(300).optional(), dueDate: z.coerce.date().nullish() }), req.body);
    const updated = await prisma.developmentAction.update({
      where: { id: actionId },
      data: { ...body, ...(body.done !== undefined ? { doneAt: body.done ? new Date() : null } : {}) },
    });
    // Avisa quem criou o plano quando a pessoa conclui a última ação
    if (body.done) {
      const left = await prisma.developmentAction.count({ where: { planId: plan.id, done: false } });
      if (left === 0 && plan.createdById !== req.auth.id) {
        await notify([plan.createdById], { type: 'pdi.completed', title: `${req.auth.name.split(' ')[0]} concluiu todas as ações do PDI`, body: plan.title, link: `/pdi?pessoa=${plan.userId}` });
      }
    }
    return updated;
  });

  app.delete('/actions/:actionId', async (req) => {
    const { actionId } = req.params as { actionId: string };
    const action = await prisma.developmentAction.findUnique({ where: { id: actionId } });
    if (!action) throw notFound();
    await planFor(req.auth, action.planId);
    await prisma.developmentAction.delete({ where: { id: actionId } });
    return { ok: true };
  });
}
