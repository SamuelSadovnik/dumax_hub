import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

/** Campos padrão para devolver um usuário "leve" (sem hash de senha) */
export const userLite = {
  id: true,
  name: true,
  email: true,
  avatarUrl: true,
  jobTitle: true,
  role: true,
} as const;
