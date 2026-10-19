/**
 * Enums espelhados do schema Prisma — usados no front (que não importa @prisma/client)
 * e nos labels em português.
 */

export const ROLES = ['ADMIN', 'HR', 'MANAGER', 'EMPLOYEE'] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: 'Administrador',
  HR: 'RH',
  MANAGER: 'Gestor',
  EMPLOYEE: 'Colaborador',
};
/** Quem enxerga o portal administrativo */
export const ADMIN_PORTAL_ROLES: Role[] = ['ADMIN', 'HR', 'MANAGER'];
/** Quem gerencia recrutamento e clima */
export const HR_ROLES: Role[] = ['ADMIN', 'HR'];

export const JOB_STATUSES = ['DRAFT', 'OPEN', 'PAUSED', 'CLOSED'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  DRAFT: 'Rascunho',
  OPEN: 'Aberta',
  PAUSED: 'Pausada',
  CLOSED: 'Encerrada',
};

export const WORK_MODES = ['REMOTE', 'HYBRID', 'ONSITE'] as const;
export type WorkMode = (typeof WORK_MODES)[number];
export const WORK_MODE_LABEL: Record<WorkMode, string> = {
  REMOTE: 'Remoto',
  HYBRID: 'Híbrido',
  ONSITE: 'Presencial',
};

export const EMPLOYMENT_TYPES = ['CLT', 'PJ', 'ESTAGIO', 'TEMPORARIO', 'FREELANCER'] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];
export const EMPLOYMENT_TYPE_LABEL: Record<EmploymentType, string> = {
  CLT: 'CLT',
  PJ: 'PJ',
  ESTAGIO: 'Estágio',
  TEMPORARIO: 'Temporário',
  FREELANCER: 'Freelancer',
};

// Ordem do funil: o teste sai sozinho na candidatura; ao concluir, a pessoa vai para a triagem
export const STAGES = [
  'APPLIED',
  'ASSESSMENT',
  'SCREENING',
  'INTERVIEW',
  'OFFER',
  'HIRED',
  'REJECTED',
] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_LABEL: Record<Stage, string> = {
  APPLIED: 'Inscritos',
  SCREENING: 'Triagem',
  ASSESSMENT: 'Teste de perfil',
  INTERVIEW: 'Entrevista',
  OFFER: 'Proposta',
  HIRED: 'Contratado',
  REJECTED: 'Reprovado',
};
export const STAGE_COLOR: Record<Stage, string> = {
  APPLIED: '#64748b',
  SCREENING: '#0ea5e9',
  ASSESSMENT: '#8b5cf6',
  INTERVIEW: '#f59e0b',
  OFFER: '#ec4899',
  HIRED: '#10b981',
  REJECTED: '#ef4444',
};
/** Etapas "ativas" do funil (sem as finais) */
export const ACTIVE_STAGES: Stage[] = ['APPLIED', 'ASSESSMENT', 'SCREENING', 'INTERVIEW', 'OFFER'];

export const TASK_STATUSES = ['TODO', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW', 'DONE', 'CANCELED'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  TODO: 'A fazer',
  IN_PROGRESS: 'Em andamento',
  BLOCKED: 'Bloqueada',
  IN_REVIEW: 'Aguardando aprovação',
  DONE: 'Concluída',
  CANCELED: 'Cancelada',
};
export const TASK_STATUS_COLOR: Record<TaskStatus, string> = {
  TODO: '#64748b',
  IN_PROGRESS: '#0ea5e9',
  BLOCKED: '#ef4444',
  IN_REVIEW: '#8b5cf6',
  DONE: '#10b981',
  CANCELED: '#94a3b8',
};
/** Status que contam como "pendente" */
export const OPEN_TASK_STATUSES: TaskStatus[] = ['TODO', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW'];
/** Colunas do quadro kanban */
export const BOARD_STATUSES: TaskStatus[] = ['TODO', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW', 'DONE'];

export const TASK_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export const TASK_PRIORITY_LABEL: Record<TaskPriority, string> = {
  LOW: 'Baixa',
  MEDIUM: 'Média',
  HIGH: 'Alta',
  URGENT: 'Urgente',
};
export const TASK_PRIORITY_COLOR: Record<TaskPriority, string> = {
  LOW: '#94a3b8',
  MEDIUM: '#0ea5e9',
  HIGH: '#f59e0b',
  URGENT: '#ef4444',
};

export const KUDOS_VALUES = [
  'Dono do resultado',
  'Colaboração',
  'Cliente no centro',
  'Inovação',
  'Excelência',
  'Garra',
] as const;
export type KudosValue = (typeof KUDOS_VALUES)[number];

export const PULSE_DEFAULT_QUESTION = 'De 1 a 5, quão feliz você está trabalhando aqui nesta semana?';
export const PULSE_SCALE = [
  { score: 1, emoji: '😞', label: 'Muito insatisfeito' },
  { score: 2, emoji: '🙁', label: 'Insatisfeito' },
  { score: 3, emoji: '😐', label: 'Neutro' },
  { score: 4, emoji: '🙂', label: 'Satisfeito' },
  { score: 5, emoji: '😄', label: 'Muito feliz' },
] as const;
/** Grupos menores que isso não aparecem no recorte por área (protege o anonimato) */
export const PULSE_MIN_GROUP = 3;

// ───────────── Ponto eletrônico ─────────────
export const PUNCH_TYPES = ['IN', 'BREAK_START', 'BREAK_END', 'OUT'] as const;
export type PunchType = (typeof PUNCH_TYPES)[number];
export const PUNCH_TYPE_LABEL: Record<PunchType, string> = {
  IN: 'Entrada',
  BREAK_START: 'Saída intervalo',
  BREAK_END: 'Volta intervalo',
  OUT: 'Saída',
};

export const DAY_STATUSES = ['OK', 'LATE', 'INCOMPLETE', 'ABSENT', 'OFF'] as const;
export type DayStatus = (typeof DAY_STATUSES)[number];
export const DAY_STATUS_LABEL: Record<DayStatus, string> = {
  OK: 'Regular',
  LATE: 'Atraso',
  INCOMPLETE: 'Incompleto',
  ABSENT: 'Falta',
  OFF: 'Folga',
};
export const DAY_STATUS_COLOR: Record<DayStatus, string> = {
  OK: '#10b981',
  LATE: '#f59e0b',
  INCOMPLETE: '#8b5cf6',
  ABSENT: '#ef4444',
  OFF: '#94a3b8',
};

// ───────────── Agenda ─────────────
export const RSVP_STATUSES = ['PENDING', 'ACCEPTED', 'DECLINED', 'TENTATIVE'] as const;
export type RsvpStatus = (typeof RSVP_STATUSES)[number];
export const RSVP_LABEL: Record<RsvpStatus, string> = {
  PENDING: 'Sem resposta',
  ACCEPTED: 'Confirmado',
  DECLINED: 'Recusou',
  TENTATIVE: 'Talvez',
};

// ───────────── Níveis de cargo ─────────────
export const LEVELS = ['ESTAGIO', 'JUNIOR', 'PLENO', 'SENIOR', 'ESPECIALISTA', 'COORDENACAO', 'GERENCIA', 'DIRETORIA'] as const;
export type Level = (typeof LEVELS)[number];
export const LEVEL_LABEL: Record<Level, string> = {
  ESTAGIO: 'Estágio',
  JUNIOR: 'Júnior',
  PLENO: 'Pleno',
  SENIOR: 'Sênior',
  ESPECIALISTA: 'Especialista',
  COORDENACAO: 'Coordenação',
  GERENCIA: 'Gerência',
  DIRETORIA: 'Diretoria',
};
/** Degraus preenchidos no indicador de senioridade (1 a 8) */
export const levelRank = (l: string | null | undefined) => (l ? LEVELS.indexOf(l as Level) + 1 : 0);

/** Sugere o nível pelo nome do cargo (mesma regra da migração) */
export function inferLevel(title: string | null | undefined): Level {
  const t = (title ?? '').toLowerCase();
  if (t.includes('estagi')) return 'ESTAGIO';
  if (/(^|\s)(ceo|cfo|cto|coo)(\s|$)/.test(t) || t.startsWith('diretor')) return 'DIRETORIA';
  if (t.startsWith('gerente') || t.startsWith('head ') || t.startsWith('controller')) return 'GERENCIA';
  if (t.startsWith('coordenador') || t.startsWith('tech lead') || t.startsWith('supervisor')) return 'COORDENACAO';
  if (t.includes('especialista') || t.startsWith('key account')) return 'ESPECIALISTA';
  if (/(sênior|senior|\bsr\b)/.test(t)) return 'SENIOR';
  if (/(júnior|junior|\bjr\b)/.test(t) || /^(assistente|auxiliar|atendente|recepcionista)/.test(t)) return 'JUNIOR';
  return 'PLENO';
}

// ───────────── Perguntas eliminatórias da vaga ─────────────
export type ScreeningAnswerValue = 'YES' | 'NO';
/** YES_NO: Sim/Não · CHOICE: múltipla escolha · NUMBER: número (ex.: pretensão salarial, anos de experiência) */
export type ScreeningType = 'YES_NO' | 'CHOICE' | 'NUMBER';
export const SCREENING_TYPE_LABEL: Record<ScreeningType, string> = { YES_NO: 'Sim ou não', CHOICE: 'Múltipla escolha', NUMBER: 'Número' };
export interface ScreeningQuestion {
  id: string;
  text: string;
  type?: ScreeningType;
  /** YES_NO: resposta exigida */
  expected?: ScreeningAnswerValue;
  /** CHOICE: opções mostradas e quais passam */
  options?: string[];
  accepted?: string[];
  /** NUMBER: faixa aceita (vazio = sem limite) e unidade mostrada ao candidato */
  min?: number | null;
  max?: number | null;
  unit?: string | null;
  /** ELIMINATE: descarta na hora · FLAG: só sinaliza para o RH */
  mode: 'ELIMINATE' | 'FLAG';
}
export interface ScreeningAnswer extends ScreeningQuestion {
  answer: string;
  passed: boolean;
}

/** A resposta atende ao que a vaga exige? */
export function screeningPasses(q: ScreeningQuestion, answer: string): boolean {
  const type = q.type ?? 'YES_NO';
  if (type === 'YES_NO') return answer === (q.expected ?? 'YES');
  if (type === 'CHOICE') return (q.accepted ?? []).includes(answer);
  const n = Number(String(answer).trim().replace(',', '.'));
  if (!Number.isFinite(n)) return false;
  return (q.min == null || n >= q.min) && (q.max == null || n <= q.max);
}

/** Texto curto do que a vaga exige (para o RH) */
export function screeningRule(q: ScreeningQuestion): string {
  const type = q.type ?? 'YES_NO';
  if (type === 'YES_NO') return `Exige “${(q.expected ?? 'YES') === 'YES' ? 'Sim' : 'Não'}”`;
  if (type === 'CHOICE') return `Aceita: ${(q.accepted ?? []).join(', ') || 'nenhuma opção'}`;
  const u = q.unit ? ` ${q.unit}` : '';
  if (q.min != null && q.max != null) return `Entre ${q.min} e ${q.max}${u}`;
  if (q.min != null) return `No mínimo ${q.min}${u}`;
  if (q.max != null) return `No máximo ${q.max}${u}`;
  return 'Qualquer valor';
}

/** Resposta formatada para leitura */
export function screeningAnswerText(q: ScreeningQuestion, answer: string): string {
  const type = q.type ?? 'YES_NO';
  if (type === 'YES_NO') return answer === 'YES' ? 'Sim' : 'Não';
  if (type === 'NUMBER') return `${answer}${q.unit ? ` ${q.unit}` : ''}`;
  return answer;
}

// ───────────── Avaliação de entrevista ─────────────
export const RECOMMENDATIONS = ['STRONG_NO', 'NO', 'YES', 'STRONG_YES'] as const;
export type Recommendation = (typeof RECOMMENDATIONS)[number];
export const RECOMMENDATION_LABEL: Record<Recommendation, string> = { STRONG_NO: 'Definitivamente não', NO: 'Não', YES: 'Sim', STRONG_YES: 'Com certeza' };
export const RECOMMENDATION_COLOR: Record<Recommendation, string> = { STRONG_NO: '#D93036', NO: '#C77700', YES: '#2D3FE0', STRONG_YES: '#1F9254' };
export const RATING_LABEL: Record<number, string> = { 1: 'Fraco', 2: 'Abaixo do esperado', 3: 'Bom', 4: 'Excelente' };
export const DEFAULT_SCORECARD_CRITERIA = ['Comunicação', 'Experiência na função', 'Resolução de problemas', 'Alinhamento com a cultura', 'Motivação para a vaga'];

