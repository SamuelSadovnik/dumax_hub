import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { KUDOS_VALUES } from '@dumax/shared';
import { prisma, userLite } from '../lib/prisma';
import { authenticate, requireRole } from '../lib/auth';
import { badRequest, parse } from '../lib/http';
import { notify } from '../lib/notify';

/** Mural de comunicados + elogios (kudos) + notificações */
export async function feedRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  // ─── Comunicados ───
  app.get('/announcements', async () =>
    prisma.announcement.findMany({
      orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
      take: 50,
      include: { author: { select: userLite } },
    }),
  );

  app.post('/announcements', { preHandler: requireRole('ADMIN', 'HR', 'MANAGER') }, async (req) => {
    const body = parse(z.object({ title: z.string().min(3).max(150), body: z.string().min(3).max(10000), pinned: z.boolean().default(false) }), req.body);
    const a = await prisma.announcement.create({ data: { ...body, authorId: req.auth.id }, include: { author: { select: userLite } } });
    const everyone = await prisma.user.findMany({ where: { active: true, id: { not: req.auth.id } }, select: { id: true } });
    await notify(everyone.map((u) => u.id), { type: 'announcement', title: `📣 ${a.title}`, body: a.body.slice(0, 140), link: '/mural' });
    return a;
  });

  app.patch('/announcements/:id', { preHandler: requireRole('ADMIN', 'HR', 'MANAGER') }, async (req) => {
    const { id } = req.params as { id: string };
    const body = parse(z.object({ title: z.string().min(3).optional(), body: z.string().min(3).optional(), pinned: z.boolean().optional() }), req.body);
    return prisma.announcement.update({ where: { id }, data: body });
  });

  app.delete('/announcements/:id', { preHandler: requireRole('ADMIN', 'HR', 'MANAGER') }, async (req) => {
    const { id } = req.params as { id: string };
    await prisma.announcement.delete({ where: { id } });
    return { ok: true };
  });

  // ─── Elogios ───
  app.get('/kudos', async (req) => {
    const q = parse(z.object({ userId: z.string().optional() }), req.query);
    return prisma.kudos.findMany({
      where: q.userId ? { toId: q.userId } : {},
      orderBy: { createdAt: 'desc' },
      take: 60,
      include: { from: { select: userLite }, to: { select: userLite } },
    });
  });

  app.get('/kudos/ranking', async () => {
    const since = new Date(Date.now() - 30 * 86400000);
    const grouped = await prisma.kudos.groupBy({
      by: ['toId'],
      where: { createdAt: { gte: since } },
      _count: true,
      orderBy: { _count: { toId: 'desc' } },
      take: 10,
    });
    const users = await prisma.user.findMany({ where: { id: { in: grouped.map((g) => g.toId) } }, select: userLite });
    return grouped.map((g) => ({ user: users.find((u) => u.id === g.toId), count: g._count }));
  });

  app.post('/kudos', async (req) => {
    const body = parse(
      z.object({ toId: z.string(), value: z.enum(KUDOS_VALUES), message: z.string().min(3).max(500) }),
      req.body,
    );
    if (body.toId === req.auth.id) throw badRequest('Elogio pra si mesmo não vale 😄');
    const k = await prisma.kudos.create({
      data: { ...body, fromId: req.auth.id },
      include: { from: { select: userLite }, to: { select: userLite } },
    });
    await notify([body.toId], { type: 'kudos', title: `${req.auth.name} te elogiou! 🎉`, body: `${body.value}: ${body.message}`, link: '/mural' });
    return k;
  });

  // ─── Notificações ───
  app.get('/notifications', async (req) => {
    const [items, unread] = await Promise.all([
      prisma.notification.findMany({ where: { userId: req.auth.id }, orderBy: { createdAt: 'desc' }, take: 50 }),
      prisma.notification.count({ where: { userId: req.auth.id, readAt: null } }),
    ]);
    return { items, unread };
  });

  app.post('/notifications/read', async (req) => {
    const { ids } = parse(z.object({ ids: z.array(z.string()).optional() }), req.body ?? {});
    await prisma.notification.updateMany({
      where: { userId: req.auth.id, readAt: null, ...(ids ? { id: { in: ids } } : {}) },
      data: { readAt: new Date() },
    });
    return { ok: true };
  });
}
