import type { PunchType } from '@prisma/client';
import { env } from '../../env';
import { addDays, brDateKey, brDateTime, dateOnly } from '../../lib/dates';
import { prisma } from '../../lib/prisma';

/**
 * Batida vinda do sistema de ponto externo.
 * `type` é opcional: se o seu sistema não informar, o Hub deduz pela ordem do dia
 * (1ª = entrada, 2ª = saída intervalo, 3ª = volta, 4ª = saída).
 */
export interface ExternalPunch {
  externalId: string;
  /** Código que liga a batida ao colaborador (campo `pontoCode` do usuário) */
  employeeCode: string;
  at: Date;
  type?: PunchType;
}

export interface PontoProvider {
  name: string;
  fetchPunches(from: Date, to: Date): Promise<ExternalPunch[]>;
}

// ─────────────────────────────────────────────────────────────
//  Adapter HTTP genérico — ajuste `mapPunch` ao formato da sua API
// ─────────────────────────────────────────────────────────────

const TYPE_ALIASES: Record<string, PunchType> = {
  IN: 'IN', ENTRADA: 'IN', E: 'IN', CHECKIN: 'IN',
  OUT: 'OUT', SAIDA: 'OUT', S: 'OUT', CHECKOUT: 'OUT',
  BREAK_START: 'BREAK_START', INTERVALO_INICIO: 'BREAK_START', SAIDA_INTERVALO: 'BREAK_START',
  BREAK_END: 'BREAK_END', INTERVALO_FIM: 'BREAK_END', RETORNO_INTERVALO: 'BREAK_END',
};

/**
 * Aceita vários nomes de campo comuns. Exemplo de payload aceito:
 *   { "id": "123", "matricula": "0042", "dataHora": "2026-10-15T08:58:00-03:00", "tipo": "ENTRADA" }
 */
export function mapPunch(raw: Record<string, unknown>): ExternalPunch | null {
  const pick = (...keys: string[]) => keys.map((k) => raw[k]).find((v) => v !== undefined && v !== null);
  const id = pick('id', 'externalId', 'punchId', 'marcacaoId', 'nsr');
  const code = pick('employeeCode', 'matricula', 'pis', 'cpf', 'employeeId', 'colaborador', 'codigo');
  const when = pick('at', 'timestamp', 'dataHora', 'datetime', 'date_time', 'horario');
  if (id === undefined || code === undefined || when === undefined) return null;
  const at = new Date(String(when));
  if (Number.isNaN(at.getTime())) return null;
  const t = pick('type', 'tipo', 'kind', 'direction');
  const type = t ? TYPE_ALIASES[String(t).toUpperCase().replace(/[\s-]/g, '_')] : undefined;
  return { externalId: String(id), employeeCode: String(code), at, type };
}

class HttpPontoProvider implements PontoProvider {
  name = 'http';
  async fetchPunches(from: Date, to: Date) {
    if (!env.PONTO_API_URL) throw new Error('PONTO_API_URL não configurada');
    const url = new URL(env.PONTO_API_URL);
    url.searchParams.set('from', from.toISOString());
    url.searchParams.set('to', to.toISOString());
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        ...(env.PONTO_API_TOKEN ? { Authorization: `Bearer ${env.PONTO_API_TOKEN}` } : {}),
      },
    });
    if (!res.ok) throw new Error(`API de ponto respondeu ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = (await res.json()) as unknown;
    // aceita array direto ou { data: [...] } / { items: [...] } / { punches: [...] }
    const list = Array.isArray(json)
      ? json
      : ((json as Record<string, unknown>).data ?? (json as Record<string, unknown>).items ?? (json as Record<string, unknown>).punches ?? []);
    return (list as Record<string, unknown>[]).map(mapPunch).filter((p): p is ExternalPunch => p !== null);
  }
}

// ─────────────────────────────────────────────────────────────
//  Mock — gera batidas realistas para demonstração
// ─────────────────────────────────────────────────────────────

function seeded(str: string) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

class MockPontoProvider implements PontoProvider {
  name = 'mock';
  async fetchPunches(from: Date, to: Date) {
    const users = await prisma.user.findMany({
      where: { active: true, pontoCode: { not: null } },
      select: { pontoCode: true, workSchedule: true },
    });
    const now = new Date();
    const out: ExternalPunch[] = [];
    for (let d = dateOnly(brDateKey(from)); d <= to; d = addDays(d, 1)) {
      const key = d.toISOString().slice(0, 10);
      const dow = d.getUTCDay();
      for (const u of users) {
        const s = u.workSchedule ?? { startTime: '09:00', endTime: '18:00', workDays: [1, 2, 3, 4, 5] };
        if (!s.workDays.includes(dow)) continue;
        const rnd = seeded(`${u.pontoCode}-${key}`);
        if (rnd() < 0.03) continue; // ~3% falta
        const [sh, sm] = s.startTime.split(':').map(Number);
        const [eh, em] = s.endTime.split(':').map(Number);
        const late = rnd() < 0.15 ? 11 + Math.floor(rnd() * 35) : -Math.floor(rnd() * 12); // ~15% atrasa
        const times = [
          sh * 60 + sm + late,
          12 * 60 + Math.floor(rnd() * 30),
          13 * 60 + Math.floor(rnd() * 30),
          eh * 60 + em + Math.floor(rnd() * 25) - 5,
        ];
        const types: PunchType[] = ['IN', 'BREAK_START', 'BREAK_END', 'OUT'];
        times.forEach((min, i) => {
          const hhmm = `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
          const at = brDateTime(key, hhmm);
          if (at > now || at < from || at > to) return;
          out.push({ externalId: `mock-${u.pontoCode}-${key}-${i}`, employeeCode: u.pontoCode!, at, type: types[i] });
        });
      }
    }
    return out;
  }
}

export function getPontoProvider(): PontoProvider {
  return env.PONTO_PROVIDER === 'http' ? new HttpPontoProvider() : new MockPontoProvider();
}
