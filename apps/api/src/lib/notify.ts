import { prisma } from './prisma';
import { emitToUsers } from './realtime';

export interface NotificationInput {
  type: string;
  title: string;
  body?: string;
  link?: string;
}

/** Cria notificação no banco e empurra em tempo real pelo socket */
export async function notify(userIds: string[], n: NotificationInput) {
  const ids = [...new Set(userIds)].filter(Boolean);
  if (!ids.length) return;
  const created = await prisma.$transaction(
    ids.map((userId) => prisma.notification.create({ data: { userId, ...n } })),
  );
  for (const c of created) emitToUsers([c.userId], 'notification', c);
}

/** IDs de quem cuida de RH (admins + RH) */
export async function hrUserIds(): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: { active: true, role: { in: ['ADMIN', 'HR'] } },
    select: { id: true },
  });
  return users.map((u) => u.id);
}
