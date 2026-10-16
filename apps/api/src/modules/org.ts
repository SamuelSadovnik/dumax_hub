import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma, userLite } from '../lib/prisma';
import { authenticate, requireRole } from '../lib/auth';
import { badRequest, parse } from '../lib/http';

const deptInput = z.object({
  name: z.string().min(2),
  description: z.string().nullish(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  parentId: z.string().nullish(),
  headId: z.string().nullish(),
});

const teamInput = z.object({
  name: z.string().min(2),
  description: z.string().nullish(),
  departmentId: z.string().nullish(),
  leadId: z.string().nullish(),
});

export async function orgRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);
  const admin = { preHandler: requireRole('ADMIN', 'HR') };

  /**
   * Organograma: árvore de pessoas por "quem responde a quem".
   * O front monta a árvore a partir da lista plana (managerId).
   */
  app.get('/chart', async () => {
    const [users, departments, teams] = await Promise.all([
      prisma.user.findMany({
        where: { active: true },
        select: {
          ...userLite,
          managerId: true,
          departmentId: true,
          level: true,
          teamMemberships: { select: { teamId: true } },
        },
        orderBy: { name: 'asc' },
      }),
      prisma.department.findMany({ select: { id: true, name: true, color: true, parentId: true, headId: true } }),
      prisma.team.findMany({ select: { id: true, name: true, departmentId: true, leadId: true } }),
    ]);
    return {
      users: users.map(({ teamMemberships, ...u }) => ({ ...u, teamIds: teamMemberships.map((t) => t.teamId) })),
      departments,
      teams,
    };
  });

  // ─── Departamentos ───
  app.get('/departments', async () =>
    prisma.department.findMany({
      orderBy: { name: 'asc' },
      include: {
        head: { select: userLite },
        _count: { select: { members: { where: { active: true } }, teams: true } },
      },
    }),
  );

  app.post('/departments', admin, async (req) => prisma.department.create({ data: parse(deptInput, req.body) }));

  app.patch('/departments/:id', admin, async (req) => {
    const { id } = req.params as { id: string };
    const body = parse(deptInput.partial(), req.body);
    if (body.parentId === id) throw badRequest('Departamento não pode ser pai de si mesmo');
    return prisma.department.update({ where: { id }, data: body });
  });

  app.delete('/departments/:id', admin, async (req) => {
    const { id } = req.params as { id: string };
    await prisma.department.delete({ where: { id } });
    return { ok: true };
  });

  // ─── Times ───
  app.get('/teams', async () =>
    prisma.team.findMany({
      orderBy: { name: 'asc' },
      include: {
        lead: { select: userLite },
        department: { select: { id: true, name: true, color: true } },
        members: { include: { user: { select: userLite } } },
      },
    }),
  );

  app.post('/teams', admin, async (req) => {
    const body = parse(teamInput.extend({ memberIds: z.array(z.string()).default([]) }), req.body);
    const { memberIds, ...data } = body;
    const ids = new Set(memberIds);
    if (data.leadId) ids.add(data.leadId);
    return prisma.team.create({
      data: { ...data, members: { create: [...ids].map((userId) => ({ userId })) } },
    });
  });

  app.patch('/teams/:id', admin, async (req) => {
    const { id } = req.params as { id: string };
    const body = parse(teamInput.partial().extend({ memberIds: z.array(z.string()).optional() }), req.body);
    const { memberIds, ...data } = body;
    return prisma.$transaction(async (tx) => {
      if (memberIds) {
        const ids = new Set(memberIds);
        if (data.leadId) ids.add(data.leadId);
        await tx.teamMember.deleteMany({ where: { teamId: id, userId: { notIn: [...ids] } } });
        await tx.teamMember.createMany({
          data: [...ids].map((userId) => ({ teamId: id, userId })),
          skipDuplicates: true,
        });
      }
      return tx.team.update({ where: { id }, data });
    });
  });

  app.delete('/teams/:id', admin, async (req) => {
    const { id } = req.params as { id: string };
    await prisma.team.delete({ where: { id } });
    return { ok: true };
  });
}
