import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma, userLite } from '../lib/prisma';
import { authenticate, canSeeUser, type AuthUser } from '../lib/auth';
import { badRequest, forbidden, notFound, parse } from '../lib/http';
import { notify } from '../lib/notify';
import { brDateTimeLabel } from '../lib/dates';

export const meetingInclude = {
  organizer: { select: userLite },
  participants: { include: { user: { select: userLite } } },
} satisfies Prisma.MeetingInclude;

const createInput = z.object({
  title: z.string().min(2).max(150),
  description: z.string().max(5000).nullish(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date().optional(),
  durationMinutes: z.number().int().min(5).max(600).optional(),
  location: z.string().max(200).nullish(),
  videoUrl: z.string().url().nullish(),
  participantIds: z.array(z.string()).default([]),
});

/** Conflitos de agenda das pessoas no intervalo */
export async function findConflicts(userIds: string[], startsAt: Date, endsAt: Date, ignoreMeetingId?: string) {
  return prisma.meeting.findMany({
    where: {
      id: ignoreMeetingId ? { not: ignoreMeetingId } : undefined,
      canceledAt: null,
      startsAt: { lt: endsAt },
      endsAt: { gt: startsAt },
      OR: [{ organizerId: { in: userIds } }, { participants: { some: { userId: { in: userIds } } } }],
    },
    include: meetingInclude,
  });
}

/** Cria reunião + convites. Exportado para o assistente de IA. */
export async function createMeeting(actor: AuthUser, input: z.input<typeof createInput>, via: 'APP' | 'AI' = 'APP') {
  const data = createInput.parse(input);
  const endsAt = data.endsAt ?? new Date(data.startsAt.getTime() + (data.durationMinutes ?? 30) * 60000);
  if (endsAt <= data.startsAt) throw badRequest('O fim precisa ser depois do início');
  const participantIds = Array.from(new Set<string>(data.participantIds.filter((id: string) => id !== actor.id)));

  const meeting = await prisma.meeting.create({
    data: {
      title: data.title,
      description: data.description,
      startsAt: data.startsAt,
      endsAt,
      location: data.location,
      videoUrl: data.videoUrl,
      organizerId: actor.id,
      createdVia: via,
      participants: {
        create: [{ userId: actor.id, rsvp: 'ACCEPTED' }, ...participantIds.map((userId) => ({ userId }))],
      },
    },
    include: meetingInclude,
  });
  await notify(participantIds, {
    type: 'meeting.invite',
    title: `📅 ${actor.name} te convidou: ${meeting.title}`,
    body: brDateTimeLabel(meeting.startsAt),
    link: `/agenda?meeting=${meeting.id}`,
  });
  return meeting;
}

export async function meetingRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  /** Minha agenda no intervalo (padrão: semana atual em diante) */
  app.get('/', async (req) => {
    const q = parse(
      z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional(), userId: z.string().optional() }),
      req.query,
    );
    const userId = q.userId ?? req.auth.id;
    if (userId !== req.auth.id && !(await canSeeUser(req.auth, userId))) throw forbidden();
    const from = q.from ?? new Date(Date.now() - 7 * 86400000);
    const to = q.to ?? new Date(Date.now() + 60 * 86400000);
    return prisma.meeting.findMany({
      where: {
        canceledAt: null,
        startsAt: { lt: to },
        endsAt: { gt: from },
        participants: { some: { userId } },
      },
      include: meetingInclude,
      orderBy: { startsAt: 'asc' },
    });
  });

  app.post('/', async (req) => createMeeting(req.auth, req.body as z.input<typeof createInput>));

  app.post('/conflicts', async (req) => {
    const body = parse(z.object({ userIds: z.array(z.string()), startsAt: z.coerce.date(), endsAt: z.coerce.date() }), req.body);
    return findConflicts(body.userIds, body.startsAt, body.endsAt);
  });

  app.patch('/:id', async (req) => {
    const { id } = req.params as { id: string };
    const m = await prisma.meeting.findUnique({ where: { id }, include: meetingInclude });
    if (!m) throw notFound('Reunião não encontrada');
    if (m.organizerId !== req.auth.id) throw forbidden('Só o organizador pode editar');
    const body = parse(createInput.partial(), req.body);
    const { participantIds, durationMinutes, ...data } = body;
    const updated = await prisma.meeting.update({
      where: { id },
      data: {
        ...data,
        endsAt: data.endsAt ?? (durationMinutes && data.startsAt ? new Date(data.startsAt.getTime() + durationMinutes * 60000) : undefined),
      },
      include: meetingInclude,
    });
    if (participantIds) {
      const keep = new Set([req.auth.id, ...participantIds]);
      await prisma.meetingParticipant.deleteMany({ where: { meetingId: id, userId: { notIn: [...keep] } } });
      await prisma.meetingParticipant.createMany({ data: [...keep].map((userId) => ({ meetingId: id, userId })), skipDuplicates: true });
    }
    const all = await prisma.meetingParticipant.findMany({ where: { meetingId: id }, select: { userId: true } });
    await notify(all.map((p) => p.userId).filter((u) => u !== req.auth.id), {
      type: 'meeting.updated',
      title: `Reunião atualizada: ${updated.title}`,
      body: brDateTimeLabel(updated.startsAt),
      link: `/agenda?meeting=${id}`,
    });
    return prisma.meeting.findUniqueOrThrow({ where: { id }, include: meetingInclude });
  });

  app.post('/:id/cancel', async (req) => {
    const { id } = req.params as { id: string };
    const m = await prisma.meeting.findUnique({ where: { id }, include: meetingInclude });
    if (!m) throw notFound('Reunião não encontrada');
    if (m.organizerId !== req.auth.id) throw forbidden('Só o organizador pode cancelar');
    await prisma.meeting.update({ where: { id }, data: { canceledAt: new Date() } });
    await notify(m.participants.map((p) => p.userId).filter((u) => u !== req.auth.id), {
      type: 'meeting.canceled',
      title: `Reunião cancelada: ${m.title}`,
      body: brDateTimeLabel(m.startsAt),
      link: '/agenda',
    });
    return { ok: true };
  });

  app.post('/:id/rsvp', async (req) => {
    const { id } = req.params as { id: string };
    const { rsvp } = parse(z.object({ rsvp: z.enum(['ACCEPTED', 'DECLINED', 'TENTATIVE']) }), req.body);
    const m = await prisma.meeting.findUnique({ where: { id } });
    if (!m) throw notFound('Reunião não encontrada');
    await prisma.meetingParticipant.update({ where: { meetingId_userId: { meetingId: id, userId: req.auth.id } }, data: { rsvp } });
    if (m.organizerId !== req.auth.id) {
      const label = { ACCEPTED: 'confirmou', DECLINED: 'recusou', TENTATIVE: 'marcou talvez' }[rsvp];
      await notify([m.organizerId], { type: 'meeting.rsvp', title: `${req.auth.name} ${label}`, body: m.title, link: `/agenda?meeting=${id}` });
    }
    return prisma.meeting.findUniqueOrThrow({ where: { id }, include: meetingInclude });
  });
}
