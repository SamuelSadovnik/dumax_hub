import { format, formatDistanceToNowStrict, isToday, isYesterday, isThisYear, differenceInCalendarDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const d = (v: string | Date) => (typeof v === 'string' ? new Date(v) : v);

export const fmtDate = (v: string | Date) => format(d(v), 'dd/MM/yyyy');
export const fmtDateShort = (v: string | Date) => format(d(v), "dd 'de' MMM", { locale: ptBR });
export const fmtTime = (v: string | Date) => format(d(v), 'HH:mm');
export const fmtDateTime = (v: string | Date) => format(d(v), "dd/MM 'às' HH:mm");
export const fmtWeekday = (v: string | Date) => format(d(v), "EEEE, dd 'de' MMMM", { locale: ptBR });
export const fromNow = (v: string | Date) => formatDistanceToNowStrict(d(v), { locale: ptBR, addSuffix: true });

/** Datas @db.Date vêm como "2026-10-15T00:00:00.000Z" — formata sem conversão de fuso */
export const fmtDayKey = (iso: string, pattern = 'EEE, dd/MM') => {
  const [y, m, day] = iso.slice(0, 10).split('-').map(Number);
  return format(new Date(y, m - 1, day), pattern, { locale: ptBR });
};

/** Rótulo de lista de chat: "14:32", "Ontem", "seg", "12/09" */
export function chatStamp(v: string | Date) {
  const date = d(v);
  if (isToday(date)) return fmtTime(date);
  if (isYesterday(date)) return 'Ontem';
  if (differenceInCalendarDays(new Date(), date) < 7) return format(date, 'EEE', { locale: ptBR });
  return format(date, isThisYear(date) ? 'dd/MM' : 'dd/MM/yy');
}

export function dayDivider(v: string | Date) {
  const date = d(v);
  if (isToday(date)) return 'Hoje';
  if (isYesterday(date)) return 'Ontem';
  return format(date, "EEEE, dd 'de' MMMM", { locale: ptBR });
}

export function dueLabel(dueAt: string | null) {
  if (!dueAt) return null;
  const date = d(dueAt);
  const days = differenceInCalendarDays(date, new Date());
  if (days < 0) return { text: `Atrasada ${fromNow(date).replace('há ', '')}`, tone: 'danger' as const };
  if (days === 0) return { text: `Hoje ${fmtTime(date)}`, tone: 'warn' as const };
  if (days === 1) return { text: `Amanhã ${fmtTime(date)}`, tone: 'warn' as const };
  return { text: fmtDateShort(date), tone: 'muted' as const };
}

export const fmtMoney = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
export const fmtBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);
export const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${Math.round(v * 100)}%`);

/** "2026-10-15" local */
export const todayKey = () => format(new Date(), 'yyyy-MM-dd');
/** Para inputs datetime-local → ISO com fuso */
export const localInputToIso = (v: string) => new Date(v).toISOString();
export const isoToLocalInput = (v: string | null) => (v ? format(new Date(v), "yyyy-MM-dd'T'HH:mm") : '');
