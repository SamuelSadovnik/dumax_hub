/**
 * Desempenho, metas, apontamento de horas, licenças e documentos —
 * rótulos e regras compartilhadas entre API e front.
 */

// ───────────── Apontamento de horas ─────────────
export const TIMELOG_ACTIVITIES = ['EXECUCAO', 'REUNIAO', 'SUPORTE', 'RETRABALHO', 'ESTUDO', 'ADMINISTRATIVO'] as const;
export type TimeLogActivity = (typeof TIMELOG_ACTIVITIES)[number];
export const TIMELOG_ACTIVITY_LABEL: Record<TimeLogActivity, string> = {
  EXECUCAO: 'Execução',
  REUNIAO: 'Reunião',
  SUPORTE: 'Suporte',
  RETRABALHO: 'Retrabalho',
  ESTUDO: 'Estudo',
  ADMINISTRATIVO: 'Administrativo',
};
export const TIMELOG_ACTIVITY_COLOR: Record<TimeLogActivity | 'AGENDA' | 'SEM_REGISTRO', string> = {
  EXECUCAO: '#2D3FE0',
  REUNIAO: '#7C5CFF',
  SUPORTE: '#0EA5A4',
  RETRABALHO: '#E5484D',
  ESTUDO: '#3E9B4F',
  ADMINISTRATIVO: '#8E95A6',
  AGENDA: '#B3A4FF',
  SEM_REGISTRO: '#E3E6EC',
};

// ───────────── Nota de desempenho ─────────────

/**
 * Pesos da nota (0–100). Componentes sem dado no período são ignorados
 * e o peso é redistribuído entre os demais.
 */
export const SCORE_WEIGHTS = {
  onTime: 0.2, // % de demandas entregues no prazo
  throughput: 0.2, // volume entregue vs. mediana do grupo
  utilization: 0.25, // horas com atividade registrada / horas trabalhadas no ponto
  punctuality: 0.15, // dias sem atraso / dias trabalhados
  goals: 0.2, // progresso médio das metas
} as const;
/** Desconto por demanda atrasada em aberto (máx. 15 pontos) */
export const OVERDUE_PENALTY = { perTask: 3, max: 15 } as const;

export const SCORE_LEVELS = [
  { key: 'ALTO', min: 80, label: 'Alto', color: '#1F9254' },
  { key: 'ADEQUADO', min: 60, label: 'Adequado', color: '#2D3FE0' },
  { key: 'ATENCAO', min: 40, label: 'Atenção', color: '#C77700' },
  { key: 'CRITICO', min: 0, label: 'Crítico', color: '#D93036' },
] as const;
export type ScoreLevel = (typeof SCORE_LEVELS)[number]['key'];

export function scoreLevel(score: number | null) {
  if (score === null) return null;
  return SCORE_LEVELS.find((l) => score >= l.min) ?? SCORE_LEVELS[SCORE_LEVELS.length - 1];
}

export type FlagSeverity = 'high' | 'medium' | 'low' | 'positive';
export interface PerformanceFlag {
  code:
    | 'UNTRACKED_TIME'
    | 'OVERDUE'
    | 'LATE_ARRIVALS'
    | 'ABSENCES'
    | 'SCORE_DROP'
    | 'SCORE_UP'
    | 'GOAL_BEHIND'
    | 'NO_DELIVERY'
    | 'BLOCKED'
    | 'REWORK';
  severity: FlagSeverity;
  message: string;
}
export const FLAG_COLOR: Record<FlagSeverity, string> = {
  high: '#D93036',
  medium: '#C77700',
  low: '#8E95A6',
  positive: '#1F9254',
};

// ───────────── Metas ─────────────
export const GOAL_UNITS = [
  { value: 'un', label: 'Unidades' },
  { value: '%', label: 'Percentual (%)' },
  { value: 'R$', label: 'Reais (R$)' },
  { value: 'h', label: 'Horas' },
] as const;

/**
 * Progresso 0–1. Funciona para metas "quanto maior melhor" (ex.: vendas de 0 → 100)
 * e "quanto menor melhor" (ex.: retrabalho de 20 → 5), porque o sinal do intervalo
 * já indica a direção.
 */
export function goalProgress(g: { startValue: number; targetValue: number; currentValue: number }) {
  const span = g.targetValue - g.startValue;
  if (span === 0) return g.currentValue === g.targetValue ? 1 : 0;
  return Math.max(0, Math.min(1, (g.currentValue - g.startValue) / span));
}

/** Quanto do prazo já passou (0–1) */
export function goalElapsed(g: { startDate: string | Date; dueDate: string | Date }, now = new Date()) {
  const s = new Date(g.startDate).getTime();
  const e = new Date(g.dueDate).getTime() + 86400000;
  if (e <= s) return 1;
  return Math.max(0, Math.min(1, (now.getTime() - s) / (e - s)));
}

export function formatGoalValue(v: number, unit: string) {
  if (unit === 'R$') return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
  if (unit === '%') return `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
  if (unit === 'h') return `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}h`;
  return v.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
}

// ───────────── Feedback / 1:1 ─────────────
export const FEEDBACK_TYPES = ['ONE_ON_ONE', 'POSITIVO', 'MELHORIA', 'ALINHAMENTO'] as const;
export type FeedbackType = (typeof FEEDBACK_TYPES)[number];
export const FEEDBACK_TYPE_LABEL: Record<FeedbackType, string> = {
  ONE_ON_ONE: '1:1',
  POSITIVO: 'Reconhecimento',
  MELHORIA: 'Ponto de melhoria',
  ALINHAMENTO: 'Alinhamento',
};

// ───────────── Licenças ─────────────
export const LICENSE_CATEGORIES = ['ALVARA', 'AVCB', 'AMBIENTAL', 'SANITARIA', 'CERTIFICADO_DIGITAL', 'SOFTWARE', 'CONTRATO', 'SEGURO', 'OUTRO'] as const;
export type LicenseCategory = (typeof LICENSE_CATEGORIES)[number];
export const LICENSE_CATEGORY_LABEL: Record<LicenseCategory, string> = {
  ALVARA: 'Alvará',
  AVCB: 'AVCB / Bombeiros',
  AMBIENTAL: 'Licença ambiental',
  SANITARIA: 'Vigilância sanitária',
  CERTIFICADO_DIGITAL: 'Certificado digital',
  SOFTWARE: 'Software',
  CONTRATO: 'Contrato',
  SEGURO: 'Seguro',
  OUTRO: 'Outro',
};
export const LICENSE_DEFAULT_ALERTS = [60, 30, 15, 7, 1];

export type LicenseState = 'VALID' | 'EXPIRING' | 'EXPIRED';
export const LICENSE_STATE_LABEL: Record<LicenseState, string> = { VALID: 'Em dia', EXPIRING: 'Vencendo', EXPIRED: 'Vencida' };
export const LICENSE_STATE_COLOR: Record<LicenseState, string> = { VALID: '#1F9254', EXPIRING: '#C77700', EXPIRED: '#D93036' };

/** Dias até vencer (negativo = vencida). Datas @db.Date em UTC. */
export function daysUntil(expiresAt: string | Date, today: string) {
  const e = new Date(typeof expiresAt === 'string' ? expiresAt.slice(0, 10) + 'T00:00:00Z' : expiresAt).getTime();
  const t = new Date(today + 'T00:00:00Z').getTime();
  return Math.round((e - t) / 86400000);
}
export function licenseState(daysLeft: number, alertDays: number[]): LicenseState {
  if (daysLeft < 0) return 'EXPIRED';
  const maxAlert = alertDays.length ? Math.max(...alertDays) : 30;
  return daysLeft <= maxAlert ? 'EXPIRING' : 'VALID';
}

// ───────────── Documentos ─────────────
export const DOCUMENT_CATEGORIES = ['Contrato de trabalho', 'Aditivo', 'Política interna', 'Termo de responsabilidade', 'Advertência', 'Recibo', 'Contrato comercial', 'Outro'] as const;
export const DOCUMENT_STATUS_LABEL = { PENDING: 'Aguardando assinaturas', COMPLETED: 'Assinado', CANCELED: 'Cancelado', EXPIRED: 'Expirado' } as const;
export const DOCUMENT_STATUS_COLOR = { PENDING: '#C77700', COMPLETED: '#1F9254', CANCELED: '#8E95A6', EXPIRED: '#D93036' } as const;
export const SIGNER_STATUS_LABEL = { PENDING: 'Pendente', SIGNED: 'Assinou', DECLINED: 'Recusou' } as const;
