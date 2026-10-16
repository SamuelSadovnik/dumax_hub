import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma, userLite } from '../lib/prisma';
import { authenticate } from '../lib/auth';
import { badRequest, forbidden, notFound, parse } from '../lib/http';
import { emitToUsers } from '../lib/realtime';
import { saveUpload } from '../lib/storage';
import { signedFileUrl } from '../lib/crypto';

const messageInclude = {
  sender: { select: userLite },
  replyTo: { select: { id: true, body: true, type: true, attachmentName: true, deletedAt: true, sender: { select: { id: true, name: true } } } },
  reactions: { select: { emoji: true, userId: true, user: { select: { name: true } } } },
} satisfies Prisma.MessageInclude;

type MessageWithIncludes = Prisma.MessageGetPayload<{ include: typeof messageInclude }>;

/** Mensagem apagada não expõe conteúdo; anexos saem como link assinado temporário */
function present(m: MessageWithIncludes) {
  if (!m.deletedAt) return { ...m, attachmentUrl: m.attachmentUrl ? signedFileUrl(m.attachmentUrl) : null };
  return { ...m, body: null, attachmentUrl: null, attachmentName: null, reactions: [] };
}

async function membership(conversationId: string, userId: string) {
  const m = await prisma.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
  });
  if (!m) throw forbidden('Você não participa desta conversa');
  return m;
}

async function memberIds(conversationId: string) {
  const ms = await prisma.conversationMember.findMany({ where: { conversationId }, select: { userId: true } });
  return ms.map((m) => m.userId);
}

/** Monta o item de lista de conversa (nome, última msg, não lidas) para um usuário */
async function conversationSummary(conversationId: string, userId: string) {
  const c = await prisma.conversation.findUniqueOrThrow({
    where: { id: conversationId },
    include: {
      members: { include: { user: { select: { ...userLite, lastSeenAt: true } } } },
      messages: { orderBy: { createdAt: 'desc' }, take: 1, include: { sender: { select: { id: true, name: true } } } },
    },
  });
  const me = c.members.find((m) => m.userId === userId);
  const unread = me
    ? await prisma.message.count({
        where: { conversationId, createdAt: { gt: me.lastReadAt }, senderId: { not: userId }, deletedAt: null },
      })
    : 0;
  const last = c.messages[0];
  const other = c.type === 'DIRECT' ? c.members.find((m) => m.userId !== userId)?.user : null;
  return {
    id: c.id,
    type: c.type,
    name: c.type === 'DIRECT' ? other?.name ?? 'Conversa' : c.name,
    description: c.description,
    avatarUrl: other?.avatarUrl ?? null,
    otherUserId: other?.id ?? null,
    lastMessageAt: c.lastMessageAt,
    pinned: me?.pinned ?? false,
    muted: me?.muted ?? false,
    archived: me?.archived ?? false,
    markedUnread: me?.markedUnread ?? false,
    unread,
    members: c.members.map((m) => ({ ...m.user, isAdmin: m.isAdmin, lastReadAt: m.lastReadAt })),
    lastMessage: last
      ? {
          id: last.id,
          type: last.type,
          body: last.deletedAt ? null : last.body,
          attachmentName: last.deletedAt ? null : last.attachmentName,
          deleted: Boolean(last.deletedAt),
          senderId: last.senderId,
          senderName: last.sender?.name ?? null,
          createdAt: last.createdAt,
        }
      : null,
  };
}

async function postMessage(
  conversationId: string,
  senderId: string | null,
  data: Omit<Prisma.MessageUncheckedCreateInput, 'conversationId' | 'senderId'>,
) {
  const message = await prisma.message.create({
    data: { ...data, conversationId, senderId },
    include: messageInclude,
  });
  await prisma.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: message.createdAt } });
  if (senderId) {
    await prisma.conversationMember.update({
      where: { conversationId_userId: { conversationId, userId: senderId } },
      data: { lastReadAt: message.createdAt },
    });
  }
  emitToUsers(await memberIds(conversationId), 'chat:message', present(message));
  return present(message);
}

export async function chatRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.get('/conversations', async (req) => {
    const ms = await prisma.conversationMember.findMany({
      where: { userId: req.auth.id },
      select: { conversationId: true },
    });
    const list = await Promise.all(ms.map((m) => conversationSummary(m.conversationId, req.auth.id)));
    return list.sort((a, b) => Number(b.pinned) - Number(a.pinned) || +new Date(b.lastMessageAt) - +new Date(a.lastMessageAt));
  });

  app.get('/conversations/:id', async (req) => {
    const { id } = req.params as { id: string };
    await membership(id, req.auth.id);
    return conversationSummary(id, req.auth.id);
  });

  /** Abre (ou cria) conversa direta com alguém */
  app.post('/direct', async (req) => {
    const { userId } = parse(z.object({ userId: z.string() }), req.body);
    if (userId === req.auth.id) throw badRequest('Não dá para conversar consigo mesmo 🙂');
    const directKey = [req.auth.id, userId].sort().join(':');
    let conv = await prisma.conversation.findUnique({ where: { directKey } });
    if (!conv) {
      conv = await prisma.conversation.create({
        data: {
          type: 'DIRECT',
          directKey,
          createdById: req.auth.id,
          members: { create: [{ userId: req.auth.id }, { userId }] },
        },
      });
    }
    return conversationSummary(conv.id, req.auth.id);
  });

  app.post('/groups', async (req) => {
    const body = parse(
      z.object({ name: z.string().min(2).max(80), description: z.string().max(300).optional(), memberIds: z.array(z.string()).min(1) }),
      req.body,
    );
    const ids = [...new Set([req.auth.id, ...body.memberIds])];
    const conv = await prisma.conversation.create({
      data: {
        type: 'GROUP',
        name: body.name,
        description: body.description,
        createdById: req.auth.id,
        members: { create: ids.map((userId) => ({ userId, isAdmin: userId === req.auth.id })) },
      },
    });
    await postMessage(conv.id, null, { type: 'SYSTEM', body: `${req.auth.name} criou o grupo "${body.name}"` });
    for (const uid of ids) emitToUsers([uid], 'chat:conversation', await conversationSummary(conv.id, uid));
    return conversationSummary(conv.id, req.auth.id);
  });

  app.patch('/groups/:id', async (req) => {
    const { id } = req.params as { id: string };
    const me = await membership(id, req.auth.id);
    if (!me.isAdmin) throw forbidden('Só admins do grupo podem editar');
    const body = parse(
      z.object({
        name: z.string().min(2).max(80).optional(),
        description: z.string().max(300).nullish(),
        addMemberIds: z.array(z.string()).default([]),
        removeMemberIds: z.array(z.string()).default([]),
      }),
      req.body,
    );
    await prisma.conversation.update({ where: { id }, data: { name: body.name, description: body.description } });
    if (body.addMemberIds.length) {
      await prisma.conversationMember.createMany({
        data: body.addMemberIds.map((userId) => ({ conversationId: id, userId })),
        skipDuplicates: true,
      });
      const names = await prisma.user.findMany({ where: { id: { in: body.addMemberIds } }, select: { name: true } });
      await postMessage(id, null, { type: 'SYSTEM', body: `${req.auth.name} adicionou ${names.map((n) => n.name).join(', ')}` });
    }
    if (body.removeMemberIds.length) {
      await prisma.conversationMember.deleteMany({ where: { conversationId: id, userId: { in: body.removeMemberIds } } });
      emitToUsers(body.removeMemberIds, 'chat:removed', { conversationId: id });
    }
    const ids = await memberIds(id);
    for (const uid of ids) emitToUsers([uid], 'chat:conversation', await conversationSummary(id, uid));
    return conversationSummary(id, req.auth.id);
  });

  app.post('/conversations/:id/leave', async (req) => {
    const { id } = req.params as { id: string };
    await membership(id, req.auth.id);
    await prisma.conversationMember.delete({ where: { conversationId_userId: { conversationId: id, userId: req.auth.id } } });
    await postMessage(id, null, { type: 'SYSTEM', body: `${req.auth.name} saiu do grupo` });
    return { ok: true };
  });

  app.patch('/conversations/:id/prefs', async (req) => {
    const { id } = req.params as { id: string };
    await membership(id, req.auth.id);
    const body = parse(
      z.object({ pinned: z.boolean().optional(), muted: z.boolean().optional(), archived: z.boolean().optional(), markedUnread: z.boolean().optional() }),
      req.body,
    );
    await prisma.conversationMember.update({ where: { conversationId_userId: { conversationId: id, userId: req.auth.id } }, data: body });
    return { ok: true };
  });

  /** Ações em lote (seleção de várias conversas) */
  app.post('/conversations/bulk', async (req) => {
    const body = parse(
      z.object({
        ids: z.array(z.string()).min(1).max(200),
        action: z.enum(['archive', 'unarchive', 'read', 'unread', 'mute', 'unmute', 'pin', 'unpin']),
      }),
      req.body,
    );
    const data: Prisma.ConversationMemberUpdateManyMutationInput =
      body.action === 'archive' ? { archived: true, pinned: false }
      : body.action === 'unarchive' ? { archived: false }
      : body.action === 'read' ? { lastReadAt: new Date(), markedUnread: false }
      : body.action === 'unread' ? { markedUnread: true }
      : body.action === 'mute' ? { muted: true }
      : body.action === 'unmute' ? { muted: false }
      : body.action === 'pin' ? { pinned: true, archived: false }
      : { pinned: false };
    const res = await prisma.conversationMember.updateMany({
      where: { userId: req.auth.id, conversationId: { in: body.ids } },
      data,
    });
    return { updated: res.count };
  });

  /** Histórico paginado (cursor = id da mensagem mais antiga carregada) */
  app.get('/conversations/:id/messages', async (req) => {
    const { id } = req.params as { id: string };
    await membership(id, req.auth.id);
    const q = parse(z.object({ before: z.string().optional(), limit: z.coerce.number().min(1).max(100).default(40), search: z.string().optional() }), req.query);
    const messages = await prisma.message.findMany({
      where: {
        conversationId: id,
        ...(q.search ? { body: { contains: q.search, mode: 'insensitive' }, deletedAt: null } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: q.limit + 1,
      ...(q.before ? { cursor: { id: q.before }, skip: 1 } : {}),
      include: messageInclude,
    });
    const hasMore = messages.length > q.limit;
    const items = messages.slice(0, q.limit).reverse().map(present);
    return { items, nextCursor: hasMore ? items[0]?.id ?? null : null };
  });

  app.post('/conversations/:id/messages', async (req) => {
    const { id } = req.params as { id: string };
    await membership(id, req.auth.id);

    // aceita JSON (texto) ou multipart (arquivo + legenda)
    if (req.isMultipart()) {
      let saved: Awaited<ReturnType<typeof saveUpload>> | null = null;
      const fields: Record<string, string> = {};
      for await (const part of req.parts()) {
        if (part.type === 'file') {
          if (saved) {
            part.file.resume();
            continue;
          }
          saved = await saveUpload(part, { folder: `chat/${id}` });
        } else fields[part.fieldname] = String(part.value ?? '');
      }
      if (!saved) throw badRequest('Arquivo não enviado');
      return postMessage(id, req.auth.id, {
        type: 'FILE',
        body: fields.body?.trim() || null,
        attachmentUrl: saved.key,
        attachmentName: saved.name,
        attachmentMime: saved.mime,
        attachmentSize: saved.size,
        replyToId: fields.replyToId || null,
      });
    }

    const body = parse(z.object({ body: z.string().trim().min(1).max(10000), replyToId: z.string().nullish() }), req.body);
    return postMessage(id, req.auth.id, { type: 'TEXT', body: body.body, replyToId: body.replyToId });
  });

  app.patch('/messages/:id', async (req) => {
    const { id } = req.params as { id: string };
    const { body } = parse(z.object({ body: z.string().trim().min(1).max(10000) }), req.body);
    const msg = await prisma.message.findUnique({ where: { id } });
    if (!msg || msg.deletedAt) throw notFound('Mensagem não encontrada');
    if (msg.senderId !== req.auth.id) throw forbidden('Só dá para editar suas mensagens');
    if (Date.now() - msg.createdAt.getTime() > 15 * 60000) throw badRequest('Só é possível editar em até 15 minutos');
    const updated = await prisma.message.update({ where: { id }, data: { body, editedAt: new Date() }, include: messageInclude });
    emitToUsers(await memberIds(msg.conversationId), 'chat:message:update', present(updated));
    return present(updated);
  });

  app.delete('/messages/:id', async (req) => {
    const { id } = req.params as { id: string };
    const msg = await prisma.message.findUnique({ where: { id } });
    if (!msg) throw notFound('Mensagem não encontrada');
    if (msg.senderId !== req.auth.id) throw forbidden('Só dá para apagar suas mensagens');
    const updated = await prisma.message.update({ where: { id }, data: { deletedAt: new Date() }, include: messageInclude });
    emitToUsers(await memberIds(msg.conversationId), 'chat:message:update', present(updated));
    return { ok: true };
  });

  /** Reação (toggle) */
  app.post('/messages/:id/reactions', async (req) => {
    const { id } = req.params as { id: string };
    const { emoji } = parse(z.object({ emoji: z.string().min(1).max(16) }), req.body);
    const msg = await prisma.message.findUniqueOrThrow({ where: { id } });
    await membership(msg.conversationId, req.auth.id);
    // como no WhatsApp: 1 reação por pessoa; repetir o mesmo emoji remove
    const mine = await prisma.messageReaction.findMany({ where: { messageId: id, userId: req.auth.id } });
    await prisma.messageReaction.deleteMany({ where: { messageId: id, userId: req.auth.id } });
    if (!mine.some((r) => r.emoji === emoji)) {
      await prisma.messageReaction.create({ data: { messageId: id, userId: req.auth.id, emoji } });
    }
    const updated = await prisma.message.findUniqueOrThrow({ where: { id }, include: messageInclude });
    emitToUsers(await memberIds(msg.conversationId), 'chat:message:update', present(updated));
    return present(updated);
  });

  /** Marca como lida (✓✓ azul para os outros) */
  app.post('/conversations/:id/read', async (req) => {
    const { id } = req.params as { id: string };
    await membership(id, req.auth.id);
    const lastReadAt = new Date();
    await prisma.conversationMember.update({
      where: { conversationId_userId: { conversationId: id, userId: req.auth.id } },
      data: { lastReadAt, markedUnread: false },
    });
    emitToUsers(await memberIds(id), 'chat:read', { conversationId: id, userId: req.auth.id, lastReadAt });
    return { ok: true };
  });

  app.get('/unread-count', async (req) => {
    const ms = await prisma.conversationMember.findMany({ where: { userId: req.auth.id, muted: false, archived: false } });
    let total = 0;
    for (const m of ms) {
      if (m.markedUnread) {
        total += 1;
        continue;
      }
      total += await prisma.message.count({
        where: { conversationId: m.conversationId, createdAt: { gt: m.lastReadAt }, senderId: { not: req.auth.id }, deletedAt: null },
      });
    }
    return { total };
  });
}
