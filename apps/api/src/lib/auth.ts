import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Role } from '@prisma/client';
import { env } from '../env';
import { prisma } from './prisma';
import { forbidden, unauthorized } from './http';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthUser;
  }
}

interface TokenPayload {
  sub: string;
  role: Role;
}

export const hashPassword = (plain: string) => bcrypt.hash(plain, 10);
export const checkPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);

export function signToken(user: { id: string; role: Role }): string {
  return jwt.sign({ sub: user.id, role: user.role } satisfies TokenPayload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
}

export function verifyToken(token: string): TokenPayload {
  return jwt.verify(token, env.JWT_SECRET) as TokenPayload;
}

/**
 * preHandler: valida o Bearer token e carrega o usuário do banco
 * (assim, desativar um usuário corta o acesso na hora).
 */
export async function authenticate(req: FastifyRequest, _reply: FastifyReply) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw unauthorized();
  let payload: TokenPayload;
  try {
    payload = verifyToken(header.slice(7));
  } catch {
    throw unauthorized('Sessão expirada. Faça login novamente.');
  }
  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, name: true, email: true, role: true, active: true },
  });
  if (!user || !user.active) throw unauthorized('Usuário inativo');
  req.auth = { id: user.id, name: user.name, email: user.email, role: user.role };
}

export function requireRole(...roles: Role[]) {
  return async (req: FastifyRequest) => {
    if (!roles.includes(req.auth.role)) throw forbidden();
  };
}

export const isHR = (u: AuthUser) => u.role === 'ADMIN' || u.role === 'HR';
export const isManagerOrAbove = (u: AuthUser) => u.role !== 'EMPLOYEE';

/**
 * Retorna todos os IDs abaixo de um gestor na hierarquia (recursivo, via CTE no Postgres).
 */
export async function getSubordinateIds(managerId: string): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE tree AS (
      SELECT id FROM users WHERE "managerId" = ${managerId}
      UNION
      SELECT u.id FROM users u JOIN tree t ON u."managerId" = t.id
    )
    SELECT id FROM tree`;
  return rows.map((r) => r.id);
}

/**
 * Escopo de pessoas que o usuário pode "enxergar" em relatórios (ponto, métricas, demandas):
 *  - ADMIN/RH: todo mundo (null = sem filtro)
 *  - Gestor: ele + toda a árvore abaixo
 *  - Colaborador: só ele
 */
export async function visibleUserIds(u: AuthUser): Promise<string[] | null> {
  if (isHR(u)) return null;
  if (u.role === 'MANAGER') return [u.id, ...(await getSubordinateIds(u.id))];
  return [u.id];
}

export async function canSeeUser(u: AuthUser, targetId: string): Promise<boolean> {
  const scope = await visibleUserIds(u);
  return scope === null || scope.includes(targetId);
}
