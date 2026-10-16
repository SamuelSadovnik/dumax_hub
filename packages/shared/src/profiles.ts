/**
 * Perfis comportamentais (modelo inspirado no DISC, com a nomenclatura usada no
 * mercado brasileiro). As perguntas e o mapeamento resposta→perfil ficam SÓ na API,
 * para o candidato não conseguir "ler a cola" no bundle do front.
 */

export const PROFILE_KEYS = ['EXECUTOR', 'COMUNICADOR', 'PLANEJADOR', 'ANALISTA'] as const;
export type ProfileKey = (typeof PROFILE_KEYS)[number];

export interface ProfileMeta {
  key: ProfileKey;
  label: string;
  disc: 'D' | 'I' | 'S' | 'C';
  color: string;
  tagline: string;
  description: string;
  strengths: string[];
  watchOuts: string[];
  bestFit: string[];
}

export const PROFILES: Record<ProfileKey, ProfileMeta> = {
  EXECUTOR: {
    key: 'EXECUTOR',
    label: 'Executor',
    disc: 'D',
    color: '#ef4444',
    tagline: 'Foco em resultado e ação',
    description:
      'Direto, competitivo e orientado a metas. Toma decisões rápidas, gosta de desafios e de ter autonomia.',
    strengths: ['Decisão rápida', 'Senso de urgência', 'Assume riscos', 'Lidera em crises'],
    watchOuts: ['Pode atropelar processos', 'Impaciência com detalhes', 'Comunicação muito direta'],
    bestFit: ['Vendas / metas agressivas', 'Gestão de operações', 'Abertura de mercados'],
  },
  COMUNICADOR: {
    key: 'COMUNICADOR',
    label: 'Comunicador',
    disc: 'I',
    color: '#f59e0b',
    tagline: 'Foco em pessoas e influência',
    description:
      'Extrovertido, otimista e persuasivo. Cria relacionamentos com facilidade, engaja times e vende ideias.',
    strengths: ['Persuasão', 'Networking', 'Energia e entusiasmo', 'Criatividade'],
    watchOuts: ['Pode perder o foco', 'Dificuldade com rotinas', 'Promete mais do que entrega'],
    bestFit: ['Comercial / relacionamento', 'Marketing', 'Treinamento e eventos'],
  },
  PLANEJADOR: {
    key: 'PLANEJADOR',
    label: 'Planejador',
    disc: 'S',
    color: '#10b981',
    tagline: 'Foco em estabilidade e cooperação',
    description:
      'Paciente, leal e consistente. Gosta de ambientes estáveis, trabalha bem em equipe e dá suporte ao time.',
    strengths: ['Constância', 'Escuta ativa', 'Trabalho em equipe', 'Confiabilidade'],
    watchOuts: ['Resistência a mudanças bruscas', 'Evita conflitos', 'Demora para decidir'],
    bestFit: ['Atendimento / CS', 'Suporte e operações', 'Administrativo'],
  },
  ANALISTA: {
    key: 'ANALISTA',
    label: 'Analista',
    disc: 'C',
    color: '#3b82f6',
    tagline: 'Foco em qualidade e precisão',
    description:
      'Detalhista, lógico e criterioso. Valoriza dados, regras e qualidade. Prefere decidir com segurança.',
    strengths: ['Precisão', 'Pensamento analítico', 'Organização', 'Qualidade'],
    watchOuts: ['Perfeccionismo', 'Excesso de análise', 'Pode parecer distante'],
    bestFit: ['Financeiro / controladoria', 'Tecnologia / dados', 'Qualidade e compliance'],
  },
};

export interface AssessmentResult {
  /** Percentual 0-100 por perfil (soma = 100) */
  scores: Record<ProfileKey, number>;
  primary: ProfileKey;
  secondary: ProfileKey;
  answered: number;
}

// ───────────── Mapa de perfis e aderência à vaga ─────────────

export type ProfileScores = Record<ProfileKey, number>;

/**
 * Posição no mapa (−1 a 1):
 *  x: foco em tarefas (−) ↔ foco em pessoas (+)  → (Comunicador + Planejador) − (Executor + Analista)
 *  y: reservado (−) ↔ ativo/assertivo (+)        → (Executor + Comunicador) − (Planejador + Analista)
 * Quadrantes: Executor ↖ · Comunicador ↗ · Planejador ↘ · Analista ↙
 */
export function mapPosition(s: ProfileScores) {
  return {
    x: (s.COMUNICADOR + s.PLANEJADOR - s.EXECUTOR - s.ANALISTA) / 100,
    y: (s.EXECUTOR + s.COMUNICADOR - s.PLANEJADOR - s.ANALISTA) / 100,
  };
}

/** Normaliza para somar 100 */
export function normalizeProfile(p: Partial<ProfileScores>): ProfileScores {
  const total = PROFILE_KEYS.reduce((a, k) => a + Math.max(0, p[k] ?? 0), 0) || 1;
  const out = Object.fromEntries(PROFILE_KEYS.map((k) => [k, Math.round((Math.max(0, p[k] ?? 0) / total) * 100)])) as ProfileScores;
  return out;
}

/** Aderência 0–100: 100 − metade da distância absoluta entre as distribuições */
export function profileFit(candidate: ProfileScores, ideal: ProfileScores) {
  const dist = PROFILE_KEYS.reduce((a, k) => a + Math.abs(candidate[k] - ideal[k]), 0);
  return Math.max(0, Math.round(100 - dist / 2));
}

export function fitLabel(fit: number) {
  if (fit >= 80) return { label: 'Alta aderência', color: '#1F9254' };
  if (fit >= 65) return { label: 'Boa aderência', color: '#2D3FE0' };
  if (fit >= 50) return { label: 'Aderência parcial', color: '#C77700' };
  return { label: 'Baixa aderência', color: '#D93036' };
}

/** Modelos de perfil ideal para vagas comuns */
export const PROFILE_PRESETS: { label: string; profile: ProfileScores }[] = [
  { label: 'Vendas / hunter', profile: { EXECUTOR: 40, COMUNICADOR: 40, PLANEJADOR: 10, ANALISTA: 10 } },
  { label: 'Relacionamento / CS', profile: { EXECUTOR: 10, COMUNICADOR: 40, PLANEJADOR: 40, ANALISTA: 10 } },
  { label: 'Financeiro / controladoria', profile: { EXECUTOR: 10, COMUNICADOR: 5, PLANEJADOR: 30, ANALISTA: 55 } },
  { label: 'Tecnologia / dados', profile: { EXECUTOR: 15, COMUNICADOR: 10, PLANEJADOR: 25, ANALISTA: 50 } },
  { label: 'Operações / logística', profile: { EXECUTOR: 30, COMUNICADOR: 10, PLANEJADOR: 40, ANALISTA: 20 } },
  { label: 'Liderança / gestão', profile: { EXECUTOR: 40, COMUNICADOR: 30, PLANEJADOR: 15, ANALISTA: 15 } },
  { label: 'Equilibrado', profile: { EXECUTOR: 25, COMUNICADOR: 25, PLANEJADOR: 25, ANALISTA: 25 } },
];

/** Perguntas para investigar na entrevista quando o candidato está abaixo do ideal num perfil */
export const INTERVIEW_PROBES: Record<ProfileKey, string[]> = {
  EXECUTOR: [
    'Conte uma situação em que você teve que tomar uma decisão rápida sem ter todas as informações. O que fez?',
    'Qual foi a meta mais difícil que você bateu? Como se organizou para chegar lá?',
    'Como você reage quando um projeto está atrasado e depende de você destravar?',
  ],
  COMUNICADOR: [
    'Conte uma vez em que você precisou convencer alguém que discordava de você.',
    'Como você costuma criar relacionamento com clientes ou colegas novos?',
    'Já precisou apresentar uma ideia para um grupo grande? Como foi?',
  ],
  PLANEJADOR: [
    'Como você mantém a qualidade numa rotina repetitiva por muito tempo?',
    'Conte uma situação em que você apoiou um colega para o time entregar.',
    'Como você lida com mudanças de prioridade frequentes?',
  ],
  ANALISTA: [
    'Conte um erro que você encontrou antes que virasse problema. Como percebeu?',
    'Como você confere se um trabalho seu está correto antes de entregar?',
    'Quando precisa decidir algo importante, que dados você busca primeiro?',
  ],
};
