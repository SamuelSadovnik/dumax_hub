import { PROFILES, PROFILE_KEYS, type ProfileKey } from '@dumax/shared';
import { aiJson } from '../../lib/ai';

export interface AiReading {
  summary: string;
  strengths: string[];
  risks: string[];
  questions: string[];
  generatedAt: string;
}

const SYSTEM = `Você é uma psicóloga organizacional que apoia o RH de uma empresa brasileira.
Recebe o resultado de um teste de perfil comportamental (modelo inspirado no DISC, com os perfis Executor, Comunicador, Planejador e Analista, em percentuais que somam 100).
Escreva em português do Brasil, de forma objetiva e respeitosa, sem rótulos pejorativos e sem inferir nada sobre saúde, idade, gênero, origem ou vida pessoal.
O teste é só um apoio: nunca recomende aprovar ou reprovar alguém.
Responda APENAS com um JSON no formato:
{"summary": "2 a 3 frases sobre como a pessoa tende a trabalhar", "strengths": ["3 pontos fortes curtos"], "risks": ["2 ou 3 pontos de atenção curtos"], "questions": ["3 ou 4 perguntas de entrevista que ajudem a confirmar ou esclarecer o perfil"]}`;

/** Leitura do resultado pela IA (null se a IA estiver desligada) */
export async function readProfile(input: {
  firstName: string;
  scores: Record<ProfileKey, number>;
  primary: ProfileKey;
  secondary: ProfileKey;
  jobTitle?: string;
  ideal?: Record<ProfileKey, number> | null;
  teamAvg?: Record<ProfileKey, number> | null;
}): Promise<AiReading | null> {
  const fmt = (s: Record<ProfileKey, number>) => PROFILE_KEYS.map((k) => `${PROFILES[k].label} ${s[k]}%`).join(', ');
  const lines = [
    `Pessoa: ${input.firstName}`,
    `Resultado: ${fmt(input.scores)} (predominante ${PROFILES[input.primary].label}, secundário ${PROFILES[input.secondary].label})`,
    input.jobTitle ? `Vaga: ${input.jobTitle}` : null,
    input.ideal ? `Perfil ideal definido pelo RH para a vaga: ${fmt(input.ideal)}` : null,
    input.teamAvg ? `Média do time da área: ${fmt(input.teamAvg)}` : null,
  ].filter(Boolean);
  const r = await aiJson<Omit<AiReading, 'generatedAt'>>(SYSTEM, lines.join('\n'));
  if (!r || typeof r.summary !== 'string') return null;
  const list = (v: unknown, max: number) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, max) : []);
  return { summary: r.summary, strengths: list(r.strengths, 4), risks: list(r.risks, 3), questions: list(r.questions, 5), generatedAt: new Date().toISOString() };
}
