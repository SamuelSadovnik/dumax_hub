import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { env } from '../env';
import { verifyToken } from './auth';
import { prisma } from './prisma';

/**
 * Socket.io: cada usuário entra na sala `user:<id>`. A API emite eventos
 * diretamente para as salas dos destinatários (mensagens, notificações, presença).
 *
 * Eventos servidor → cliente:
 *   chat:message, chat:message:update, chat:read, chat:typing, chat:conversation,
 *   presence, notification, task:update
 * Eventos cliente → servidor:
 *   chat:typing { conversationId }
 */
let io: Server | null = null;
const online = new Map<string, number>();

export function initRealtime(server: HttpServer) {
  io = new Server(server, {
    cors: { origin: env.WEB_URL, credentials: true },
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) return next(new Error('unauthorized'));
    try {
      socket.data.userId = verifyToken(token).sub;
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.data.userId as string;
    socket.join(`user:${userId}`);

    const count = (online.get(userId) ?? 0) + 1;
    online.set(userId, count);
    if (count === 1) io!.emit('presence', { userId, online: true });

    socket.on('chat:typing', async (payload: { conversationId?: string }) => {
      if (!payload?.conversationId) return;
      const members = await prisma.conversationMember.findMany({
        where: { conversationId: payload.conversationId },
        select: { userId: true },
      });
      const ids = members.map((m) => m.userId);
      if (!ids.includes(userId)) return;
      emitToUsers(
        ids.filter((id) => id !== userId),
        'chat:typing',
        { conversationId: payload.conversationId, userId },
      );
    });

    socket.on('disconnect', async () => {
      const left = (online.get(userId) ?? 1) - 1;
      if (left > 0) {
        online.set(userId, left);
        return;
      }
      online.delete(userId);
      const lastSeenAt = new Date();
      await prisma.user.update({ where: { id: userId }, data: { lastSeenAt } }).catch(() => undefined);
      io!.emit('presence', { userId, online: false, lastSeenAt });
    });
  });

  return io;
}

export function emitToUsers(userIds: string[], event: string, payload: unknown) {
  if (!io) return;
  for (const id of new Set(userIds)) io.to(`user:${id}`).emit(event, payload);
}

export function onlineUserIds(): string[] {
  return [...online.keys()];
}
