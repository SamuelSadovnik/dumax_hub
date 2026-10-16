import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { authenticate, checkPassword, hashPassword, signToken } from '../lib/auth';
import { HttpError, badRequest, parse, unauthorized } from '../lib/http';
import { saveAvatar } from '../lib/avatar';

const meSelect = {
  id: true,
  name: true,
  email: true,
  avatarUrl: true,
  jobTitle: true,
  role: true,
  phone: true,
  managerId: true,
  departmentId: true,
  department: { select: { id: true, name: true } },
} as const;

/** Proteção contra força bruta: 5 erros em 15 min por IP+e-mail bloqueiam por 15 min */
const attempts = new Map<string, { count: number; first: number; blockedUntil: number }>();
const WINDOW = 15 * 60_000;
function checkBlocked(key: string) {
  const a = attempts.get(key);
  if (a && a.blockedUntil > Date.now()) {
    const min = Math.ceil((a.blockedUntil - Date.now()) / 60_000);
    throw new HttpError(429, `Muitas tentativas. Tente de novo em ${min} min.`);
  }
}
function registerFailure(key: string) {
  const now = Date.now();
  const a = attempts.get(key);
  if (!a || now - a.first > WINDOW) attempts.set(key, { count: 1, first: now, blockedUntil: 0 });
  else {
    a.count++;
    if (a.count >= 5) a.blockedUntil = now + WINDOW;
  }
  if (attempts.size > 10_000) attempts.clear();
}

export async function authRoutes(app: FastifyInstance) {
  app.post('/login', async (req) => {
    const body = parse(z.object({ email: z.string().email(), password: z.string().min(1) }), req.body);
    const key = `${req.ip}|${body.email.toLowerCase().trim()}`;
    checkBlocked(key);
    const user = await prisma.user.findUnique({ where: { email: body.email.toLowerCase().trim() } });
    if (!user || !user.active || !(await checkPassword(body.password, user.passwordHash))) {
      registerFailure(key);
      throw unauthorized('E-mail ou senha incorretos');
    }
    attempts.delete(key);
    const me = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: meSelect });
    return { token: signToken(user), user: me };
  });

  app.get('/me', { preHandler: authenticate }, async (req) => {
    return prisma.user.findUniqueOrThrow({ where: { id: req.auth.id }, select: meSelect });
  });

  app.patch('/me', { preHandler: authenticate }, async (req) => {
    const body = parse(
      z.object({
        name: z.string().min(2).optional(),
        phone: z.string().max(30).nullable().optional(),
      }),
      req.body,
    );
    return prisma.user.update({ where: { id: req.auth.id }, data: body, select: meSelect });
  });

  /** Foto de perfil: envio (multipart, campo "file") e remoção */
  app.post('/me/avatar', { preHandler: authenticate }, async (req) => {
    const avatarUrl = await saveAvatar(req);
    return prisma.user.update({ where: { id: req.auth.id }, data: { avatarUrl }, select: meSelect });
  });

  app.delete('/me/avatar', { preHandler: authenticate }, async (req) => {
    return prisma.user.update({ where: { id: req.auth.id }, data: { avatarUrl: null }, select: meSelect });
  });

  app.post('/me/password', { preHandler: authenticate }, async (req) => {
    const body = parse(
      z.object({ current: z.string().min(1), next: z.string().min(8, 'A nova senha precisa de 8+ caracteres') }),
      req.body,
    );
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.auth.id } });
    if (!(await checkPassword(body.current, user.passwordHash))) throw badRequest('Senha atual incorreta');
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(body.next) } });
    return { ok: true };
  });
}
