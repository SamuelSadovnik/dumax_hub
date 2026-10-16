import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Prisma, TaskStatus } from '@prisma/client';
import { TASK_STATUS_LABEL } from '@dumax/shared';
import { prisma, userLite } from '../lib/prisma';
import { authenticate, isHR, visibleUserIds, type AuthUser } from '../lib/auth';
import { badRequest, forbidden, notFound, parse } from '../lib/http';
import { notify } from '../lib/notify';
import { emitToUsers } from '../lib/realtime';
import { stopRunningTimer } from './performance/timelogs';

const statusEnum = z.enum(['TODO', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW', 'DONE', 'CANCELED']);
const priorityEnum = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);
const OPEN: TaskStatus[] = ['TODO', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW'];

export const taskInclude = {
  createdBy: { select: userLite },
  assignee: { select: userLite },
  team: { select: { id: true, name: true } },
  checklist: { orderBy: { position: 'asc' } },
  _count: { select: { comments: true } },
} satisfies Prisma.TaskInclude;

const createInput = z.object({
  title: z.string().min(2).max(200),
  description: z.string().max(10000).nullish(),
  assigneeId: z.string().optional(),
  priority: priorityEnum.default('MEDIUM'),
  dueAt: z.coerce.date().nullish(),
  estimatedHours: z.number().positive().max(1000).nullish(),
  teamId: z.string().nullish(),
  tags: z.array(z.string().max(30)).max(10).default([]),
  checklist: z.array(z.string().min(1).max(200)).max(50).default([]),
});

/** Regras de acesso a uma demanda */
async function loadTaskFor(user: AuthUser, id: string) {
  const task = await prisma.task.findUnique({ where: { id }, include: taskInclude });
  if (!task) throw notFound('Demanda não encontrada');
  if (task.assigneeId === user.id || task.createdById === user.id || isHR(user)) return task;
  const scope = await visibleUserIds(user);
  if (scope && !scope.includes(task.assigneeId)) throw forbidden('Você não tem acesso a esta demanda');
  return task;
}

/** Cria demanda + atividade + notificação. Exportado para o assistente de IA. */
export async function createTask(actor: AuthUser, input: z.input<typeof createInput>) {
  const data = createInput.parse(input);
  const assigneeId = data.assigneeId ?? actor.id;
  const assignee = await prisma.user.findUnique({ where: { id: assigneeId }, select: { id: true, active: true } });
  if (!assignee?.active) throw badRequest('Responsável inválido');

  const task = await prisma.task.create({
    data: {
      title: data.title,
      description: data.description,
      priority: data.priority,
      dueAt: data.dueAt,
      estimatedHours: data.estimatedHours,
      teamId: data.teamId,
      tags: data.tags,
      createdById: actor.id,
      assigneeId,
      checklist: { create: data.checklist.map((title, position) => ({ title, position })) },
      activities: { create: { actorId: actor.id, type: 'CREATED', data: { assigneeId } } },
    },
    include: taskInclude,
  });
  if (assigneeId !== actor.id) {
    await notify([assigneeId], {
      type: 'task.assigned',
      title: `${actor.name} te enviou uma demanda`,
      body: task.title,
      link: `/demandas?task=${task.id}`,
    });
  }
  return task;
}

export async function taskRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  /**
   * Lista com escopos:
   *  mine (atribuídas a mim) · created (que eu enviei) · team (meu time) · all (RH/admin) · user (de uma pessoa)
   */
  app.get('/', async (req) => {
    const q = parse(
      z.object({
        scope: z.enum(['mine', 'created', 'team', 'all', 'user']).default('mine'),
        userId: z.string().optional(),
        status: z.string().optional(), // "TODO,IN_PROGRESS"
        overdue: z.coerce.boolean().optional(),
        search: z.string().optional(),
        includeDone: z.coerce.boolean().default(true),
      }),
      req.query,
    );
    const me = req.auth;
    const where: Prisma.TaskWhereInput = {};

    if (q.scope === 'mine') where.assigneeId = me.id;
    else if (q.scope === 'created') where.createdById = me.id;
    else {
      const scope = await visibleUserIds(me);
      if (q.scope === 'user') {
        if (!q.userId) throw badRequest('userId obrigatório');
        if (scope && !scope.includes(q.userId)) throw forbidden();
        where.assigneeId = q.userId;
      } else if (q.scope === 'team') {
        where.assigneeId = scope ? { in: scope.filter((id) => id !== me.id) } : { not: me.id };
      } else if (q.scope === 'all') {
        if (scope) where.assigneeId = { in: scope };
      }
    }

    if (q.status) where.status = { in: q.status.split(',') as TaskStatus[] };
    else if (!q.includeDone) where.status = { in: OPEN };
    if (q.overdue) {
      where.dueAt = { lt: new Date() };
      where.status = { in: OPEN };
    }
    if (q.search) where.title = { contains: q.search, mode: 'insensitive' };

    // DONE antigas (>30 dias) saem do quadro para não poluir
    const recentDone: Prisma.TaskWhereInput = {
      OR: [{ status: { notIn: ['DONE', 'CANCELED'] } }, { completedAt: { gte: new Date(Date.now() - 30 * 86400000) } }],
    };

    return prisma.task.findMany({
      where: { AND: [where, recentDone] },
      include: taskInclude,
      orderBy: [{ dueAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
      take: 500,
    });
  });

  app.get('/:id', async (req) => {
    const { id } = req.params as { id: string };
    await loadTaskFor(req.auth, id);
    return prisma.task.findUnique({
      where: { id },
      include: {
        ...taskInclude,
        comments: { orderBy: { createdAt: 'asc' }, include: { author: { select: userLite } } },
        activities: { orderBy: { createdAt: 'desc' }, include: { actor: { select: userLite } } },
        timeLogs: { orderBy: { startedAt: 'desc' }, take: 50, select: { id: true, minutes: true, startedAt: true, endedAt: true, activity: true, user: { select: userLite } } },
      },
    });
  });

  app.post('/', async (req) => createTask(req.auth, req.body as z.input<typeof createInput>));

  app.patch('/:id', async (req) => {
    const { id } = req.params as { id: string };
    const task = await loadTaskFor(req.auth, id);
    const body = parse(
      z.object({
        title: z.string().min(2).max(200).optional(),
        description: z.string().max(10000).nullish(),
        status: statusEnum.optional(),
        priority: priorityEnum.optional(),
        dueAt: z.coerce.date().nullish(),
        estimatedHours: z.number().positive().nullish(),
        tags: z.array(z.string()).optional(),
      }),
      req.body,
    );

    const activities: Prisma.TaskActivityCreateWithoutTaskInput[] = [];
    const actor = { connect: { id: req.auth.id } };
    if (body.status && body.status !== task.status) {
      activities.push({ actor, type: 'STATUS_CHANGED', data: { from: task.status, to: body.status } });
    }
    const otherChanges = Object.keys(body).filter((k) => k !== 'status');
    if (otherChanges.length) activities.push({ actor, type: 'UPDATED', data: { fields: otherChanges } });

    const updated = await prisma.task.update({
      where: { id },
      data: {
        ...body,
        startedAt: body.status === 'IN_PROGRESS' && !task.startedAt ? new Date() : undefined,
        completedAt: body.status ? (body.status === 'DONE' ? new Date() : null) : undefined,
        activities: { create: activities },
      },
      include: taskInclude,
    });

    // avisa a outra ponta (quem criou ↔ responsável)
    if (body.status && body.status !== task.status) {
      const other = req.auth.id === task.assigneeId ? task.createdById : task.assigneeId;
      if (other !== req.auth.id) {
        await notify([other], {
          type: 'task.status',
          title: `${task.title}`,
          body: `${req.auth.name} mudou para "${TASK_STATUS_LABEL[body.status]}"`,
          link: `/demandas?task=${id}`,
        });
      }
    }
    if (body.status === 'DONE' || body.status === 'CANCELED') await stopRunningTimer(task.assigneeId, id);
    emitToUsers([task.assigneeId, task.createdById], 'task:update', updated);
    return updated;
  });

  /** Delegar: transfere a demanda para outra pessoa, mantendo histórico */
  app.post('/:id/delegate', async (req) => {
    const { id } = req.params as { id: string };
    const task = await loadTaskFor(req.auth, id);
    const body = parse(z.object({ assigneeId: z.string(), note: z.string().max(1000).optional() }), req.body);
    if (body.assigneeId === task.assigneeId) throw badRequest('A demanda já está com essa pessoa');
    const canDelegate = req.auth.id === task.assigneeId || req.auth.id === task.createdById || req.auth.role !== 'EMPLOYEE';
    if (!canDelegate) throw forbidden('Só o responsável, quem criou ou um gestor podem delegar');

    const updated = await prisma.task.update({
      where: { id },
      data: {
        assigneeId: body.assigneeId,
        activities: {
          create: {
            actorId: req.auth.id,
            type: 'DELEGATED',
            data: { from: task.assigneeId, to: body.assigneeId, note: body.note ?? null },
          },
        },
        ...(body.note
          ? { comments: { create: { authorId: req.auth.id, body: `↪ Delegada: ${body.note}` } } }
          : {}),
      },
      include: taskInclude,
    });
    await notify([body.assigneeId], {
      type: 'task.delegated',
      title: `${req.auth.name} delegou uma demanda para você`,
      body: task.title,
      link: `/demandas?task=${id}`,
    });
    if (task.createdById !== req.auth.id) {
      await notify([task.createdById], {
        type: 'task.delegated',
        title: 'Sua demanda foi delegada',
        body: `${task.title} → ${updated.assignee.name}`,
        link: `/demandas?task=${id}`,
      });
    }
    return updated;
  });

  app.post('/:id/comments', async (req) => {
    const { id } = req.params as { id: string };
    const task = await loadTaskFor(req.auth, id);
    const { body } = parse(z.object({ body: z.string().min(1).max(5000) }), req.body);
    const comment = await prisma.taskComment.create({
      data: { taskId: id, authorId: req.auth.id, body },
      include: { author: { select: userLite } },
    });
    await prisma.taskActivity.create({ data: { taskId: id, actorId: req.auth.id, type: 'COMMENTED' } });
    const others = [task.assigneeId, task.createdById].filter((u) => u !== req.auth.id);
    await notify(others, {
      type: 'task.comment',
      title: `${req.auth.name} comentou em "${task.title}"`,
      body: body.slice(0, 140),
      link: `/demandas?task=${id}`,
    });
    return comment;
  });

  // Checklist
  app.post('/:id/checklist', async (req) => {
    const { id } = req.params as { id: string };
    await loadTaskFor(req.auth, id);
    const { title } = parse(z.object({ title: z.string().min(1).max(200) }), req.body);
    const count = await prisma.taskChecklistItem.count({ where: { taskId: id } });
    return prisma.taskChecklistItem.create({ data: { taskId: id, title, position: count } });
  });

  app.patch('/:id/checklist/:itemId', async (req) => {
    const { id, itemId } = req.params as { id: string; itemId: string };
    await loadTaskFor(req.auth, id);
    const body = parse(z.object({ done: z.boolean().optional(), title: z.string().min(1).optional() }), req.body);
    return prisma.taskChecklistItem.update({ where: { id: itemId, taskId: id }, data: body });
  });

  app.delete('/:id/checklist/:itemId', async (req) => {
    const { id, itemId } = req.params as { id: string; itemId: string };
    await loadTaskFor(req.auth, id);
    await prisma.taskChecklistItem.delete({ where: { id: itemId, taskId: id } });
    return { ok: true };
  });

  app.delete('/:id', async (req) => {
    const { id } = req.params as { id: string };
    const task = await loadTaskFor(req.auth, id);
    if (task.createdById !== req.auth.id && !isHR(req.auth)) throw forbidden('Só quem criou pode excluir');
    await prisma.task.delete({ where: { id } });
    return { ok: true };
  });
}
