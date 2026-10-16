import type { Role } from './enums';

/** Formato "leve" de usuário que a API devolve em listas, chat, tarefas etc. */
export interface UserLite {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  jobTitle: string | null;
  role: Role;
}

export interface Me extends UserLite {
  phone: string | null;
  managerId: string | null;
  departmentId: string | null;
  department?: { id: string; name: string } | null;
}

export interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
}

/** Iniciais para avatar */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

/** "2026-10-15" no fuso de São Paulo */
export function isoDateBR(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/** minutos → "7h 45min" */
export function formatMinutes(min: number): string {
  const sign = min < 0 ? '-' : '';
  const m = Math.abs(Math.round(min));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${sign}${r}min`;
  return r === 0 ? `${sign}${h}h` : `${sign}${h}h ${r}min`;
}
