import { PROFILE_KEYS, type AssessmentResult, type ProfileKey } from '@dumax/shared';

/**
 * Teste de perfil comportamental (escolha forçada, inspirado no DISC).
 * Cada pergunta tem 4 opções, uma por perfil. O candidato escolhe a que MAIS combina com ele.
 *
 * ⚠️ É um instrumento de triagem, não um teste psicológico validado. Use como apoio
 * à conversa na entrevista — nunca como critério único de eliminação.
 */
interface Option {
  id: string;
  text: string;
  profile: ProfileKey;
}
interface Question {
  id: string;
  prompt: string;
  options: Option[];
}

const E = 'EXECUTOR', C = 'COMUNICADOR', P = 'PLANEJADOR', A = 'ANALISTA';

const raw: [string, [string, ProfileKey][]][] = [
  ['Num projeto novo, qual papel você assume naturalmente?', [
    ['Organizo as etapas e garanto que nada fique pra trás', P],
    ['Defino a meta e puxo o time para entregar rápido', E],
    ['Levanto dados e analiso riscos antes de começar', A],
    ['Engajo as pessoas e vendo a ideia para todo mundo', C],
  ]],
  ['Quando surge um problema urgente, você…', [
    ['Decide na hora e resolve, depois ajusta', E],
    ['Investiga a causa antes de agir', A],
    ['Chama as pessoas certas e alinha todo mundo', C],
    ['Mantém a calma e segue o procedimento combinado', P],
  ]],
  ['Como você prefere receber uma tarefa?', [
    ['Com todos os detalhes e critérios de qualidade', A],
    ['Com o objetivo final e liberdade pra fazer do meu jeito', E],
    ['Com um passo a passo claro e prazo realista', P],
    ['Numa conversa, entendendo o porquê e quem vai ser impactado', C],
  ]],
  ['Seus colegas provavelmente diriam que você é…', [
    ['Animado(a) e bom de papo', C],
    ['Confiável e paciente', P],
    ['Determinado(a) e direto(a)', E],
    ['Criterioso(a) e organizado(a)', A],
  ]],
  ['O que mais te incomoda no trabalho?', [
    ['Lentidão e gente que enrola', E],
    ['Erros por falta de cuidado', A],
    ['Ambiente frio, sem troca entre as pessoas', C],
    ['Mudanças bruscas sem explicação', P],
  ]],
  ['Numa reunião, você costuma…', [
    ['Falar bastante e trazer ideias novas', C],
    ['Ir direto ao ponto e cobrar decisões', E],
    ['Ouvir mais do que falar e apoiar o grupo', P],
    ['Questionar números e premissas', A],
  ]],
  ['Qual destas frases mais combina com você?', [
    ['"Feito é melhor que perfeito."', E],
    ['"Se é pra fazer, que seja bem feito."', A],
    ['"Juntos vamos mais longe."', P],
    ['"Gente feliz entrega mais."', C],
  ]],
  ['Quando você discorda do chefe, você…', [
    ['Prepara argumentos com dados e apresenta com calma', A],
    ['Fala na hora, sem rodeios', E],
    ['Procura um momento leve pra convencer na conversa', C],
    ['Pondera, e normalmente segue o que foi decidido', P],
  ]],
  ['Qual ambiente de trabalho é o seu ideal?', [
    ['Estável, com time unido e rotina bem definida', P],
    ['Dinâmico, com muita gente e interação', C],
    ['Desafiador, com metas e reconhecimento por resultado', E],
    ['Estruturado, com processos claros e tempo para concentração', A],
  ]],
  ['Diante de uma meta muito difícil, você sente…', [
    ['Empolgação: adoro competir', E],
    ['Vontade de mobilizar as pessoas', C],
    ['Necessidade de planejar bem cada passo', P],
    ['Vontade de entender se a meta é realista', A],
  ]],
  ['Como você toma decisões importantes?', [
    ['Comparo opções, prós e contras, com calma', A],
    ['Rápido, confiando na minha leitura', E],
    ['Converso com pessoas de confiança antes', P],
    ['Pelo feeling e pelo impacto nas pessoas', C],
  ]],
  ['No fim de um dia produtivo, você…', [
    ['Bateu as metas e já pensa na próxima', E],
    ['Ajudou várias pessoas e manteve tudo em ordem', P],
    ['Teve boas conversas e fechou parcerias', C],
    ['Entregou algo sem nenhum erro', A],
  ]],
  ['O que mais te motiva?', [
    ['Reconhecimento e contato com pessoas', C],
    ['Segurança e um bom clima de equipe', P],
    ['Autonomia e desafios', E],
    ['Fazer um trabalho tecnicamente impecável', A],
  ]],
  ['Quando precisa aprender algo novo, você…', [
    ['Lê a documentação inteira antes', A],
    ['Aprende fazendo, errando e acertando', E],
    ['Pede pra alguém mostrar e pratica junto', P],
    ['Troca ideia com várias pessoas sobre o assunto', C],
  ]],
  ['Sob pressão, você pode acabar…', [
    ['Ficando impaciente ou autoritário(a)', E],
    ['Falando demais e perdendo o foco', C],
    ['Evitando o conflito e guardando pra si', P],
    ['Ficando crítico(a) e perfeccionista', A],
  ]],
  ['Num time, sua maior contribuição é…', [
    ['Energia e motivação', C],
    ['Qualidade e atenção aos detalhes', A],
    ['Velocidade e foco no resultado', E],
    ['Harmonia e consistência', P],
  ]],
  ['Seu jeito de se comunicar é mais…', [
    ['Objetivo e firme', E],
    ['Preciso e formal', A],
    ['Expressivo e entusiasmado', C],
    ['Calmo e acolhedor', P],
  ]],
  ['Se o plano mudou de última hora, você…', [
    ['Adapta rápido e segue', E],
    ['Quer entender o motivo e os impactos', A],
    ['Fica um pouco desconfortável, mas se reorganiza', P],
    ['Vê oportunidade e anima o time', C],
  ]],
];

export const DISC_QUESTIONS: Question[] = raw.map(([prompt, opts], qi) => ({
  id: `q${qi + 1}`,
  prompt,
  options: opts.map(([text, profile], oi) => ({ id: `q${qi + 1}o${oi + 1}`, text, profile })),
}));

/** Versão "pública" (sem o mapeamento de perfil) */
export function publicQuestions() {
  return DISC_QUESTIONS.map((q) => ({
    id: q.id,
    prompt: q.prompt,
    options: q.options.map((o) => ({ id: o.id, text: o.text })),
  }));
}

/** Calcula o resultado a partir de { questionId: optionId } */
export function scoreDisc(answers: Record<string, string>): AssessmentResult {
  const counts = Object.fromEntries(PROFILE_KEYS.map((k) => [k, 0])) as Record<ProfileKey, number>;
  let answered = 0;
  for (const q of DISC_QUESTIONS) {
    const opt = q.options.find((o) => o.id === answers[q.id]);
    if (!opt) continue;
    counts[opt.profile]++;
    answered++;
  }
  if (answered === 0) throw new Error('Nenhuma resposta válida');

  const scores = Object.fromEntries(
    PROFILE_KEYS.map((k) => [k, Math.round((counts[k] / answered) * 100)]),
  ) as Record<ProfileKey, number>;
  const ranked = [...PROFILE_KEYS].sort((a, b) => counts[b] - counts[a]);
  return { scores, primary: ranked[0], secondary: ranked[1], answered };
}
