import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { prisma, userLite } from '../lib/prisma';
import { authenticate, getSubordinateIds, hashPassword, requireRole } from '../lib/auth';
import { badRequest, notFound, parse, queryBool } from '../lib/http';
import { onlineUserIds } from '../lib/realtime';
import { sendMail, mailLayout } from '../lib/mailer';
import { env } from '../env';
import { saveAvatar } from '../lib/avatar';
import { notify } from '../lib/notify';

import { LEVELS, inferLevel } from '@dumax/shared';

const roleEnum = z.enum(['ADMIN', 'HR', 'MANAGER', 'EMPLOYEE']);

const userInput = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  role: roleEnum.default('EMPLOYEE'),
  jobTitle: z.string().max(80).nullish(),
  level: z.enum(LEVELS).nullish(),
  phone: z.string().max(30).nullish(),
  managerId: z.string().nullish(),
  departmentId: z.string().nullish(),
  hiredAt: z.coerce.date().nullish(),
  birthday: z.coerce.date().nullish(),
  pontoCode: z.string().max(60).nullish(),
});

const fullSelect = {
  ...userLite,
  phone: true,
  active: true,
  hiredAt: true,
  birthday: true,
  lastSeenAt: true,
  level: true,
  pontoCode: true,
  managerId: true,
  manager: { select: userLite },
  departmentId: true,
  department: { select: { id: true, name: true, color: true } },
  teamMemberships: { select: { team: { select: { id: true, name: true } } } },
  workSchedule: true,
} as const;

export async function userRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  /** Diretório — todo mundo pode listar (usado no chat, atribuição de demandas, organograma) */
  app.get('/', async (req) => {
    const q = parse(
      z.object({ search: z.string().optional(), includeInactive: queryBool().optional() }),
      req.query,
    );
    const users = await prisma.user.findMany({
      where: {
        ...(q.includeInactive ? {} : { active: true }),
        ...(q.search
          ? {
              OR: [
                { name: { contains: q.search, mode: 'insensitive' } },
                { email: { contains: q.search, mode: 'insensitive' } },
                { jobTitle: { contains: q.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      select: {
        ...userLite,
        phone: true,
        active: true,
        lastSeenAt: true,
        managerId: true,
        departmentId: true,
        department: { select: { id: true, name: true, color: true } },
      },
      orderBy: { name: 'asc' },
    });
    const online = new Set(onlineUserIds());
    return users.map((u) => ({ ...u, online: online.has(u.id) }));
  });

  app.get('/presence', async () => ({ online: onlineUserIds() }));

  app.get('/:id', async (req) => {
    const { id } = req.params as { id: string };
    const user = await prisma.user.findUnique({
      where: { id },
      select: { ...fullSelect, reports: { select: userLite, where: { active: true } } },
    });
    if (!user) throw notFound('Usuário não encontrado');
    return user;
  });

  /** Subordinados (diretos e indiretos) do usuário logado */
  app.get('/me/team', async (req) => {
    const ids = await getSubordinateIds(req.auth.id);
    return prisma.user.findMany({ where: { id: { in: ids }, active: true }, select: userLite, orderBy: { name: 'asc' } });
  });

  // ─── Gestão de pessoas (ADMIN / RH) ───

  app.post('/', { preHandler: requireRole('ADMIN', 'HR') }, async (req) => {
    const body = parse(userInput.extend({ password: z.string().min(8).optional() }), req.body);
    if (body.role === 'ADMIN' && req.auth.role !== 'ADMIN') throw badRequest('Só administradores criam administradores');
    const password = body.password ?? randomBytes(6).toString('base64url');
    const { password: _p, ...data } = body;
    const user = await prisma.user.create({
      data: {
        ...data,
        level: data.level ?? inferLevel(data.jobTitle),
        email: data.email.toLowerCase().trim(),
        passwordHash: await hashPassword(password),
        workSchedule: { create: {} },
      },
      select: fullSelect,
    });
    await sendMail(
      user.email,
      'Seu acesso ao Dumax Hub',
      mailLayout(
        `Bem-vindo(a), ${user.name.split(' ')[0]}!`,
        [`Seu acesso ao Dumax Hub foi criado.`, `E-mail: ${user.email}\nSenha provisória: ${password}`, 'Troque a senha no primeiro acesso.'],
        { label: 'Acessar o Hub', url: `${env.WEB_URL}/login` },
      ),
    );
    // Teste de perfil automático para quem chega
    await notify([user.id], {
      type: 'profile.request',
      title: 'Boas-vindas! Faça seu teste de perfil (5 minutos)',
      body: 'Ajuda o time a entender como você gosta de trabalhar.',
      link: '/perfil-comportamental',
    });
    return { user, temporaryPassword: body.password ? undefined : password };
  });

  /** RH/admin trocam ou removem a foto de alguém */
  app.post('/:id/avatar', { preHandler: requireRole('ADMIN', 'HR') }, async (req) => {
    const { id } = req.params as { id: string };
    const avatarUrl = await saveAvatar(req);
    return prisma.user.update({ where: { id }, data: { avatarUrl }, select: fullSelect });
  });

  app.delete('/:id/avatar', { preHandler: requireRole('ADMIN', 'HR') }, async (req) => {
    const { id } = req.params as { id: string };
    return prisma.user.update({ where: { id }, data: { avatarUrl: null }, select: fullSelect });
  });

  app.patch('/:id', { preHandler: requireRole('ADMIN', 'HR') }, async (req) => {
    const { id } = req.params as { id: string };
    const body = parse(userInput.partial().extend({ active: z.boolean().optional() }), req.body);
    if (body.managerId === id) throw badRequest('Uma pessoa não pode ser gestora de si mesma');
    if (body.managerId) {
      // evita ciclo: o novo gestor não pode estar abaixo da pessoa
      const subs = await getSubordinateIds(id);
      if (subs.includes(body.managerId)) throw badRequest('Isso criaria um ciclo na hierarquia');
    }
    if (body.role === 'ADMIN' && req.auth.role !== 'ADMIN') throw badRequest('Só administradores promovem a administrador');
    return prisma.user.update({
      where: { id },
      data: { ...body, email: body.email?.toLowerCase().trim() },
      select: fullSelect,
    });
  });

  app.post('/:id/reset-password', { preHandler: requireRole('ADMIN', 'HR') }, async (req) => {
    const { id } = req.params as { id: string };
    const password = randomBytes(6).toString('base64url');
    await prisma.user.update({ where: { id }, data: { passwordHash: await hashPassword(password) } });
    return { temporaryPassword: password };
  });

  app.put('/:id/schedule', { preHandler: requireRole('ADMIN', 'HR') }, async (req) => {
    const { id } = req.params as { id: string };
    const hhmm = z.string().regex(/^\d{2}:\d{2}$/);
    const body = parse(
      z.object({
        startTime: hhmm,
        endTime: hhmm,
        breakMinutes: z.number().int().min(0).max(240),
        toleranceMinutes: z.number().int().min(0).max(60),
        workDays: z.array(z.number().int().min(0).max(6)),
      }),
      req.body,
    );
    return prisma.workSchedule.upsert({ where: { userId: id }, create: { userId: id, ...body }, update: body });
  });
}
