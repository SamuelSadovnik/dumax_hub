/**
 * Utilitários de data no fuso de São Paulo.
 * Datas "de calendário" (@db.Date) são guardadas como meia-noite UTC do dia.
 */
export const TZ = 'America/Sao_Paulo';

/** "YYYY-MM-DD" do instante no fuso BR */
export function brDateKey(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** Converte "YYYY-MM-DD" em Date (meia-noite UTC) para colunas @db.Date */
export function dateOnly(key: string): Date {
  return new Date(`${key}T00:00:00.000Z`);
}

export function todayDateOnly(): Date {
  return dateOnly(brDateKey());
}

export function addDays(d: Date, days: number): Date {
  const n = new Date(d);
  n.setUTCDate(n.getUTCDate() + days);
  return n;
}

/** Segunda-feira da semana (date-only) */
export function weekStart(d: Date = new Date()): Date {
  const day = dateOnly(brDateKey(d));
  const dow = day.getUTCDay(); // 0 = domingo
  const diff = dow === 0 ? -6 : 1 - dow;
  return addDays(day, diff);
}

/** Offset em minutos do fuso BR para um instante (ex.: -180) */
function tzOffsetMinutes(at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - at.getTime()) / 60000);
}

/** Instante correspondente a "YYYY-MM-DD" + "HH:mm" no horário de Brasília */
export function brDateTime(dateKey: string, hhmm: string): Date {
  const naive = new Date(`${dateKey}T${hhmm.padStart(5, '0')}:00.000Z`);
  return new Date(naive.getTime() - tzOffsetMinutes(naive) * 60000);
}

/** "HH:mm" no fuso BR */
export function brTime(d: Date): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
}

export function brDateTimeLabel(d: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: TZ,
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(d);
}

export function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + (m || 0);
}

export const daysAgo = (n: number) => new Date(Date.now() - n * 86400000);
