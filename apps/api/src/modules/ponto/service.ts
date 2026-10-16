import type { DayStatus, PunchType, TimeEntry } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { addDays, brDateKey, brDateTime, dateOnly, hhmmToMinutes } from '../../lib/dates';
import { getPontoProvider, type ExternalPunch } from './providers';

const DEFAULT_SCHEDULE = { startTime: '09:00', endTime: '18:00', breakMinutes: 60, toleranceMinutes: 10, workDays: [1, 2, 3, 4, 5] };
const ORDER: PunchType[] = ['IN', 'BREAK_START', 'BREAK_END', 'OUT'];

/** Intervalo [início, fim) do dia no fuso BR */
export function dayBounds(dateKey: string) {
  const start = brDateTime(dateKey, '00:00');
  return { start, end: new Date(start.getTime() + 86400000) };
}

/** Soma pares entrada→saída (0-1, 2-3…). Se o último par estiver aberto, conta até `openUntil`. */
function workedMinutes(entries: TimeEntry[], openUntil: Date | null) {
  let total = 0;
  for (let i = 0; i < entries.length; i += 2) {
    const a = entries[i].at;
    const b = entries[i + 1]?.at ?? openUntil;
    if (b) total += Math.max(0, (b.getTime() - a.getTime()) / 60000);
  }
  return Math.round(total);
}

/**
 * Consolida um dia de um colaborador: horas trabalhadas, atraso, saldo e status.
 * As batidas vêm da API do sistema de ponto; aqui só calculamos, nunca editamos o horário.
 */
export async function computeDay(userId: string, dateKey: string) {
  const date = dateOnly(dateKey);
  const existing = await prisma.timeDay.findUnique({ where: { userId_date: { userId, date } } });

  const schedule = (await prisma.workSchedule.findUnique({ where: { userId } })) ?? DEFAULT_SCHEDULE;
  const { start, end } = dayBounds(dateKey);
  const entries = await prisma.timeEntry.findMany({ where: { userId, at: { gte: start, lt: end } }, orderBy: { at: 'asc' } });

  const now = new Date();
  const todayKey = brDateKey(now);
  const isToday = dateKey === todayKey;
  if (dateKey > todayKey) return null;

  const isWorkDay = schedule.workDays.includes(date.getUTCDay());
  const expected = isWorkDay ? hhmmToMinutes(schedule.endTime) - hhmmToMinutes(schedule.startTime) - schedule.breakMinutes : 0;
  const shiftStart = brDateTime(dateKey, schedule.startTime);

  let status: DayStatus;
  let late = 0;
  let worked = 0;
  const firstIn = entries[0]?.at ?? null;
  const lastOut = entries.length >= 2 ? entries[entries.length - 1].at : null;

  if (!entries.length) {
    if (!isWorkDay) status = 'OFF';
    else if (isToday && now.getTime() < shiftStart.getTime() + schedule.toleranceMinutes * 60000) {
      return existing; // ainda dentro do horário: nada a registrar
    } else status = 'ABSENT';
  } else {
    worked = workedMinutes(entries, isToday ? now : null);
    const diff = Math.round((firstIn!.getTime() - shiftStart.getTime()) / 60000);
    late = isWorkDay && diff > schedule.toleranceMinutes ? diff : 0;
    const incomplete = entries.length % 2 === 1 && !isToday;
    status = incomplete ? 'INCOMPLETE' : late > 0 ? 'LATE' : isWorkDay ? 'OK' : 'OFF';
  }

  const balance = isToday ? 0 : worked - expected;
  const values = {
    firstIn,
    lastOut,
    workedMinutes: worked,
    expectedMinutes: expected,
    lateMinutes: late,
    balanceMinutes: balance,
    status,
  };

  return prisma.timeDay.upsert({
    where: { userId_date: { userId, date } },
    create: { userId, date, ...values },
    update: values,
  });
}

/** Grava batidas (idempotente por externalId) e recalcula os dias afetados */
export async function ingestPunches(punches: ExternalPunch[], source: 'api' | 'webhook') {
  const codes = [...new Set(punches.map((p) => p.employeeCode))];
  const users = await prisma.user.findMany({ where: { pontoCode: { in: codes } }, select: { id: true, pontoCode: true } });
  const byCode = new Map(users.map((u) => [u.pontoCode!, u.id]));

  let imported = 0;
  let skipped = 0;
  const touched = new Set<string>(); // "userId|YYYY-MM-DD"

  for (const p of punches) {
    const userId = byCode.get(p.employeeCode);
    if (!userId) {
      skipped++;
      continue;
    }
    const exists = await prisma.timeEntry.findUnique({ where: { externalId: p.externalId }, select: { id: true } });
    if (exists) continue; // já importada
    await prisma.timeEntry.create({
      data: { userId, at: p.at, type: p.type ?? 'IN', source, externalId: p.externalId, note: p.type ? null : 'tipo inferido' },
    });
    imported++;
    touched.add(`${userId}|${brDateKey(p.at)}`);
  }

  for (const key of touched) {
    const [userId, dateKey] = key.split('|');
    await inferTypes(userId, dateKey);
    await computeDay(userId, dateKey);
  }
  return { imported, skipped, touchedDays: touched.size };
}

/** Para batidas sem tipo, define pela ordem do dia */
async function inferTypes(userId: string, dateKey: string) {
  const { start, end } = dayBounds(dateKey);
  const entries = await prisma.timeEntry.findMany({ where: { userId, at: { gte: start, lt: end } }, orderBy: { at: 'asc' } });
  for (const [i, e] of entries.entries()) {
    if (e.note !== 'tipo inferido') continue;
    const type = entries.length === 2 ? (i === 0 ? 'IN' : 'OUT') : ORDER[i % 4];
    if (e.type !== type) await prisma.timeEntry.update({ where: { id: e.id }, data: { type } });
  }
}

/** Sincroniza com o sistema de ponto e consolida todos os dias do intervalo */
export async function syncPonto(from: Date, to: Date = new Date()) {
  const log = await prisma.pontoSyncLog.create({ data: {} });
  try {
    const provider = getPontoProvider();
    const punches = await provider.fetchPunches(from, to);
    const result = await ingestPunches(punches, 'api');

    // recalcula todo mundo (para marcar faltas de quem não bateu ponto)
    const users = await prisma.user.findMany({ where: { active: true }, select: { id: true } });
    for (let d = dateOnly(brDateKey(from)); d <= dateOnly(brDateKey(to)); d = addDays(d, 1)) {
      const key = d.toISOString().slice(0, 10);
      for (const u of users) await computeDay(u.id, key);
    }

    await prisma.pontoSyncLog.update({
      where: { id: log.id },
      data: { ok: true, finishedAt: new Date(), imported: result.imported, skipped: result.skipped, message: `provider=${provider.name}` },
    });
    return result;
  } catch (err) {
    await prisma.pontoSyncLog.update({
      where: { id: log.id },
      data: { ok: false, finishedAt: new Date(), message: (err as Error).message.slice(0, 500) },
    });
    throw err;
  }
}
