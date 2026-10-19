/**
 * Dados de demonstração do Dumax Hub (v2) — empresa fictícia em Cascavel/PR.
 *
 *   npm run db:seed      (só roda com o banco vazio)
 *   npm run db:reset     (apaga tudo e recria)
 *
 * Senha de todos os usuários: dumax123
 * Campos sensíveis (telefone de candidato, comentários do pulse, feedbacks,
 * assinaturas, CPF) são gravados criptografados, como a aplicação faz.
 */
import {
  PrismaClient,
  type GoalStatus,
  type LicenseCategory,
  type Prisma,
  type Stage,
  type TaskPriority,
  type TaskStatus,
  type TimeLogActivity,
} from '@prisma/client';
import bcrypt from 'bcryptjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { KUDOS_VALUES, PROFILE_KEYS, PULSE_DEFAULT_QUESTION, normalizeProfile, type ProfileKey, type ProfileScores, inferLevel, DEFAULT_SCORECARD_CRITERIA } from '@dumax/shared';
import { DISC_QUESTIONS, scoreDisc } from '../src/modules/assessments/disc';
import { computeDay, syncPonto } from '../src/modules/ponto/service';
import { addDays, brDateKey, brDateTime, dateOnly, todayDateOnly, weekStart } from '../src/lib/dates';
import { encryptBuffer, encryptText } from '../src/lib/crypto';
import { PRIVATE_DIR, ensureUploadDirs } from '../src/lib/storage';

const prisma = new PrismaClient();

// ───────────── utilidades determinísticas ─────────────
const rnd = (() => {
  let s = 20261015;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
})();
const pick = <T,>(arr: readonly T[]) => arr[Math.floor(rnd() * arr.length)];
const between = (a: number, b: number) => a + rnd() * (b - a);
const int = (a: number, b: number) => Math.floor(between(a, b + 1));
const chance = (p: number) => rnd() < p;
const NOW = new Date();
const hoursFromNow = (h: number) => new Date(NOW.getTime() + h * 3600000);
/** desloca um instante em dias (aceita frações) */
const at = (d: Date, days: number) => new Date(d.getTime() + days * 86400000);
/** "YYYY-MM-DD" de uma data de calendário (meia-noite UTC) */
const dk = (d: Date) => d.toISOString().slice(0, 10);
const TODAY = todayDateOnly();
const TODAY_KEY = brDateKey();
const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
function weighted<T extends string>(w: Record<T, number>): T {
  const entries = Object.entries(w) as [T, number][];
  let r = rnd() * entries.reduce((a, [, v]) => a + v, 0);
  for (const [k, v] of entries) if ((r -= v) <= 0) return k;
  return entries[0][0];
}

/** PDF mínimo válido com título e linhas de texto */
function makePdf(title: string, lines: string[]) {
  const esc = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[()\\]/g, '\\$&');
  const body = [`BT /F1 18 Tf 60 780 Td (${esc(title)}) Tj ET`, ...lines.map((l, i) => `BT /F1 11 Tf 60 ${740 - i * 18} Td (${esc(l)}) Tj ET`)].join('\n');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(body)} >>\nstream\n${body}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out);
}

/** Grava um arquivo criptografado como a aplicação faz e devolve chave + hash */
async function storeFile(folder: string, name: string, buf: Buffer) {
  const key = `${folder}/${randomUUID()}${path.extname(name)}`;
  const full = path.join(PRIVATE_DIR, key);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, encryptBuffer(buf), { mode: 0o600 });
  return { key, name, size: buf.length, sha256: createHash('sha256').update(buf).digest('hex') };
}

/** Assinatura "manuscrita" em SVG (data URL) */
function signatureSvg(name: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="110"><text x="10" y="70" font-family="Brush Script MT, Segoe Script, cursive" font-style="italic" font-size="48" fill="#0D1330">${name}</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

/** Respostas do teste de perfil puxadas para uma combinação de perfis */
function profileAnswers(mix: Partial<Record<ProfileKey, number>>) {
  const answers: Record<string, string> = {};
  for (const q of DISC_QUESTIONS) {
    const weights = Object.fromEntries(PROFILE_KEYS.map((k) => [k, mix[k] ?? 0.08])) as Record<ProfileKey, number>;
    const want = weighted(weights);
    answers[q.id] = (q.options.find((o) => o.profile === want) ?? pick(q.options)).id;
  }
  return { answers, result: scoreDisc(answers) };
}

// ───────────── dados base ─────────────
type Archetype = 'star' | 'solid' | 'avg' | 'struggling' | 'overloaded';
const ARCH: Record<Archetype, { onTime: number; coverage: number; done: number; open: number; overdue: number; blocked: number; goal: number; pulse: number; rework: number; late: number }> = {
  star: { onTime: 0.93, coverage: 0.88, done: 24, open: 4, overdue: 0, blocked: 0, goal: 1.15, pulse: 0.5, rework: 0.02, late: 0 },
  solid: { onTime: 0.84, coverage: 0.8, done: 17, open: 4, overdue: 1, blocked: 0, goal: 1.0, pulse: 0.2, rework: 0.04, late: 0 },
  avg: { onTime: 0.7, coverage: 0.66, done: 12, open: 5, overdue: 1, blocked: 0, goal: 0.82, pulse: 0, rework: 0.07, late: 0.05 },
  struggling: { onTime: 0.45, coverage: 0.42, done: 7, open: 6, overdue: 4, blocked: 1, goal: 0.45, pulse: -0.6, rework: 0.16, late: 0.35 },
  overloaded: { onTime: 0.58, coverage: 0.95, done: 16, open: 11, overdue: 3, blocked: 2, goal: 0.75, pulse: -0.8, rework: 0.08, late: 0.08 },
};

type P = { key: string; name: string; email?: string; role: 'ADMIN' | 'HR' | 'MANAGER' | 'EMPLOYEE'; title: string; dept: string; mgr?: string; start?: string; arch: Archetype; profile: Partial<Record<ProfileKey, number>> | null };
const E = (k: string) => `${k}@dumax.com.br`;
const PEOPLE: P[] = [
  { key: 'ceo', name: 'Ricardo Almeida', email: 'admin@dumax.com.br', role: 'ADMIN', title: 'CEO', dept: 'Diretoria', arch: 'solid', profile: { EXECUTOR: 0.55, COMUNICADOR: 0.3 } },
  { key: 'helena', name: 'Helena Prado', role: 'MANAGER', title: 'Diretora Administrativa', dept: 'Diretoria', mgr: 'ceo', arch: 'star', profile: { PLANEJADOR: 0.4, ANALISTA: 0.4 } },
  { key: 'rh', name: 'Fernanda Costa', email: 'rh@dumax.com.br', role: 'HR', title: 'Head de Pessoas', dept: 'Pessoas & Cultura', mgr: 'ceo', arch: 'solid', profile: { COMUNICADOR: 0.5, PLANEJADOR: 0.35 } },
  { key: 'bruna', name: 'Bruna Lima', role: 'HR', title: 'Analista de RH Pleno', dept: 'Pessoas & Cultura', mgr: 'rh', arch: 'star', profile: { PLANEJADOR: 0.5, COMUNICADOR: 0.3 } },
  { key: 'natalia', name: 'Natália Ribas', role: 'EMPLOYEE', title: 'Assistente de DP', dept: 'Pessoas & Cultura', mgr: 'rh', arch: 'avg', profile: { ANALISTA: 0.5, PLANEJADOR: 0.35 } },
  { key: 'yasmin', name: 'Yasmin Duarte', role: 'EMPLOYEE', title: 'Estagiária de RH', dept: 'Pessoas & Cultura', mgr: 'bruna', arch: 'avg', profile: { COMUNICADOR: 0.45, PLANEJADOR: 0.3 } },
  { key: 'monica', name: 'Mônica Freitas', role: 'EMPLOYEE', title: 'Recepcionista', dept: 'Pessoas & Cultura', mgr: 'rh', arch: 'solid', profile: null },
  { key: 'gestor', name: 'Marcos Oliveira', email: 'gestor@dumax.com.br', role: 'MANAGER', title: 'Gerente Comercial', dept: 'Comercial', mgr: 'ceo', arch: 'solid', profile: { EXECUTOR: 0.45, COMUNICADOR: 0.4 } },
  { key: 'coordvendas', name: 'Fábio Mattos', role: 'MANAGER', title: 'Coordenador de Vendas Internas', dept: 'Comercial', mgr: 'gestor', arch: 'solid', profile: { EXECUTOR: 0.45, PLANEJADOR: 0.3 } },
  { key: 'luiza', name: 'Luiza Martins', email: 'luiza@dumax.com.br', role: 'EMPLOYEE', title: 'Executiva de Contas Sênior', dept: 'Comercial', mgr: 'gestor', arch: 'star', profile: { COMUNICADOR: 0.55, EXECUTOR: 0.3 } },
  { key: 'pedro', name: 'Pedro Santos', role: 'EMPLOYEE', title: 'SDR Pleno', dept: 'Comercial', mgr: 'coordvendas', arch: 'struggling', profile: { PLANEJADOR: 0.45, ANALISTA: 0.3 } },
  { key: 'camila', name: 'Camila Rocha', role: 'EMPLOYEE', title: 'SDR Pleno', dept: 'Comercial', mgr: 'coordvendas', arch: 'overloaded', profile: { COMUNICADOR: 0.5, EXECUTOR: 0.3 } },
  { key: 'rodrigo', name: 'Rodrigo Farias', role: 'EMPLOYEE', title: 'Executivo de Contas Pleno', dept: 'Comercial', mgr: 'gestor', arch: 'avg', profile: { EXECUTOR: 0.5, ANALISTA: 0.25 } },
  { key: 'aline', name: 'Aline Kowalski', role: 'EMPLOYEE', title: 'SDR Júnior', dept: 'Comercial', mgr: 'coordvendas', arch: 'solid', profile: { COMUNICADOR: 0.45, PLANEJADOR: 0.3 } },
  { key: 'eduardo', name: 'Eduardo Schmitt', role: 'EMPLOYEE', title: 'Key Account', dept: 'Comercial', mgr: 'gestor', arch: 'star', profile: { EXECUTOR: 0.4, COMUNICADOR: 0.4 } },
  { key: 'gabriel', name: 'Gabriel Rossi', role: 'EMPLOYEE', title: 'SDR Jr', dept: 'Comercial', mgr: 'coordvendas', arch: 'avg', profile: null },
  { key: 'caio', name: 'Caio Henrique', role: 'EMPLOYEE', title: 'Estagiário Comercial', dept: 'Comercial', mgr: 'coordvendas', arch: 'avg', profile: { COMUNICADOR: 0.5, EXECUTOR: 0.25 } },
  { key: 'tatiane', name: 'Tatiane Moraes', role: 'MANAGER', title: 'Coordenadora de Marketing', dept: 'Marketing', mgr: 'ceo', arch: 'solid', profile: { COMUNICADOR: 0.5, EXECUTOR: 0.25 } },
  { key: 'igor', name: 'Igor Batista', role: 'EMPLOYEE', title: 'Designer Sênior', dept: 'Marketing', mgr: 'tatiane', arch: 'star', profile: { ANALISTA: 0.35, COMUNICADOR: 0.35 } },
  { key: 'larissa', name: 'Larissa Becker', role: 'EMPLOYEE', title: 'Analista de Conteúdo Júnior', dept: 'Marketing', mgr: 'tatiane', arch: 'avg', profile: { COMUNICADOR: 0.45, PLANEJADOR: 0.35 } },
  { key: 'vitor', name: 'Vitor Hugo Lemos', role: 'EMPLOYEE', title: 'Analista de Mídia Paga Pleno', dept: 'Marketing', mgr: 'tatiane', arch: 'struggling', profile: { ANALISTA: 0.5, EXECUTOR: 0.25 } },
  { key: 'kelly', name: 'Kelly Ortiz', role: 'EMPLOYEE', title: 'Social Media Pleno', dept: 'Marketing', mgr: 'tatiane', arch: 'solid', profile: { COMUNICADOR: 0.6, PLANEJADOR: 0.2 } },
  { key: 'livia', name: 'Lívia Araújo', role: 'EMPLOYEE', title: 'Estagiária de Marketing', dept: 'Marketing', mgr: 'tatiane', arch: 'solid', profile: { COMUNICADOR: 0.45, ANALISTA: 0.3 } },
  { key: 'juliana', name: 'Juliana Ferreira', role: 'MANAGER', title: 'Gerente de Operações', dept: 'Operações', mgr: 'helena', start: '07:30', arch: 'overloaded', profile: { EXECUTOR: 0.45, PLANEJADOR: 0.35 } },
  { key: 'coordlog', name: 'Sérgio Kuhn', role: 'MANAGER', title: 'Supervisor de Logística', dept: 'Operações', mgr: 'juliana', start: '07:30', arch: 'solid', profile: { PLANEJADOR: 0.45, EXECUTOR: 0.35 } },
  { key: 'rafael', name: 'Rafael Souza', role: 'EMPLOYEE', title: 'Analista de Operações Sênior', dept: 'Operações', mgr: 'juliana', start: '07:30', arch: 'solid', profile: { ANALISTA: 0.45, PLANEJADOR: 0.35 } },
  { key: 'thiago', name: 'Thiago Pereira', role: 'EMPLOYEE', title: 'Assistente de Expedição', dept: 'Operações', mgr: 'coordlog', start: '07:30', arch: 'struggling', profile: { PLANEJADOR: 0.55, EXECUTOR: 0.2 } },
  { key: 'jessica', name: 'Jéssica Zanella', role: 'EMPLOYEE', title: 'Analista de Atendimento Pleno', dept: 'Operações', mgr: 'juliana', start: '08:00', arch: 'star', profile: { PLANEJADOR: 0.45, COMUNICADOR: 0.35 } },
  { key: 'leandro', name: 'Leandro Wolff', role: 'EMPLOYEE', title: 'Conferente', dept: 'Operações', mgr: 'coordlog', start: '07:30', arch: 'avg', profile: { ANALISTA: 0.4, PLANEJADOR: 0.4 } },
  { key: 'mateus', name: 'Mateus Dalla Costa', role: 'EMPLOYEE', title: 'Auxiliar de Expedição', dept: 'Operações', mgr: 'coordlog', start: '07:30', arch: 'avg', profile: { EXECUTOR: 0.4, PLANEJADOR: 0.35 } },
  { key: 'priscila', name: 'Priscila Andrade', role: 'EMPLOYEE', title: 'Atendente', dept: 'Operações', mgr: 'juliana', start: '08:00', arch: 'solid', profile: { COMUNICADOR: 0.4, PLANEJADOR: 0.45 } },
  { key: 'cristiane', name: 'Cristiane Lopes', role: 'EMPLOYEE', title: 'Atendente', dept: 'Operações', mgr: 'juliana', start: '08:00', arch: 'overloaded', profile: { PLANEJADOR: 0.5, COMUNICADOR: 0.3 } },
  { key: 'anderson', name: 'Anderson Vieira', role: 'EMPLOYEE', title: 'Motorista', dept: 'Operações', mgr: 'coordlog', start: '07:30', arch: 'avg', profile: null },
  { key: 'tech', name: 'Gustavo Ribeiro', role: 'MANAGER', title: 'Tech Lead', dept: 'Tecnologia', mgr: 'ceo', arch: 'solid', profile: { ANALISTA: 0.45, EXECUTOR: 0.35 } },
  { key: 'ana', name: 'Ana Carvalho', role: 'EMPLOYEE', title: 'Dev Full Stack Sênior', dept: 'Tecnologia', mgr: 'tech', arch: 'star', profile: { ANALISTA: 0.5, EXECUTOR: 0.3 } },
  { key: 'lucas', name: 'Lucas Mendes', role: 'EMPLOYEE', title: 'Dev Front-end Júnior', dept: 'Tecnologia', mgr: 'tech', arch: 'avg', profile: { ANALISTA: 0.4, COMUNICADOR: 0.3 } },
  { key: 'renan', name: 'Renan Toledo', role: 'EMPLOYEE', title: 'Dev Back-end Pleno', dept: 'Tecnologia', mgr: 'tech', arch: 'solid', profile: { ANALISTA: 0.6, PLANEJADOR: 0.25 } },
  { key: 'bianca', name: 'Bianca Sartori', role: 'EMPLOYEE', title: 'Analista de Suporte Pleno', dept: 'Tecnologia', mgr: 'tech', arch: 'overloaded', profile: { PLANEJADOR: 0.5, ANALISTA: 0.3 } },
  { key: 'felipe', name: 'Felipe Nogueira', role: 'EMPLOYEE', title: 'Analista de Dados Júnior', dept: 'Tecnologia', mgr: 'tech', arch: 'struggling', profile: { ANALISTA: 0.55, PLANEJADOR: 0.3 } },
  { key: 'paula', name: 'Paula Menezes', role: 'EMPLOYEE', title: 'QA Pleno', dept: 'Tecnologia', mgr: 'tech', arch: 'solid', profile: null },
  { key: 'brunol', name: 'Bruno Lacerda', role: 'EMPLOYEE', title: 'Estagiário de Desenvolvimento', dept: 'Tecnologia', mgr: 'tech', arch: 'avg', profile: { ANALISTA: 0.5, COMUNICADOR: 0.25 } },
  { key: 'fin', name: 'Patrícia Gomes', role: 'MANAGER', title: 'Controller', dept: 'Financeiro', mgr: 'helena', arch: 'star', profile: { ANALISTA: 0.55, EXECUTOR: 0.25 } },
  { key: 'diego', name: 'Diego Barbosa', role: 'EMPLOYEE', title: 'Analista Financeiro Sênior', dept: 'Financeiro', mgr: 'fin', arch: 'solid', profile: { ANALISTA: 0.5, PLANEJADOR: 0.35 } },
  { key: 'simone', name: 'Simone Klein', role: 'EMPLOYEE', title: 'Analista de Contas a Pagar Pleno', dept: 'Financeiro', mgr: 'fin', arch: 'avg', profile: { PLANEJADOR: 0.5, ANALISTA: 0.35 } },
  { key: 'otavio', name: 'Otávio Ramos', role: 'EMPLOYEE', title: 'Assistente Financeiro', dept: 'Financeiro', mgr: 'fin', arch: 'struggling', profile: { COMUNICADOR: 0.4, PLANEJADOR: 0.35 } },
  { key: 'rosana', name: 'Rosana Pires', role: 'EMPLOYEE', title: 'Analista de Faturamento Pleno', dept: 'Financeiro', mgr: 'fin', arch: 'solid', profile: { ANALISTA: 0.45, PLANEJADOR: 0.4 } },
];

const DEPTS: [string, string, string][] = [
  ['Diretoria', '#0D1330', 'Direção geral e administrativa'],
  ['Comercial', '#2D3FE0', 'Prospecção, vendas e contas estratégicas'],
  ['Marketing', '#DB2777', 'Marca, conteúdo e mídia paga'],
  ['Operações', '#1F9254', 'Expedição, logística e atendimento'],
  ['Tecnologia', '#7C3AED', 'Sistemas internos, dados e suporte'],
  ['Financeiro', '#C77700', 'Controladoria, contas e faturamento'],
  ['Pessoas & Cultura', '#0E8C9C', 'Recrutamento, DP e cultura'],
];

const TASK_POOL: Record<string, string[]> = {
  Comercial: [
    'Enviar proposta revisada para {cliente}', 'Follow-up com leads do evento da ACIC', 'Atualizar pipeline no CRM', 'Preparar apresentação para {cliente}', 'Qualificar lista de prospecção do agro',
    'Agendar reuniões para os closers', 'Revisar script de cold call', 'Mapear contas-alvo no oeste do PR', 'Negociar renovação de contrato com {cliente}', 'Relatório semanal de oportunidades',
    'Visita técnica em {cliente}', 'Cadastrar novos leads da feira Show Rural', 'Ajustar tabela de preços regional', 'Reunião de kick-off com {cliente}',
  ],
  Marketing: [
    'Calendário de posts de {mes}', 'Campanha de Google Ads para a linha nova', 'Landing page da Show Rural', 'Peças para o evento de clientes', 'Relatório de mídia paga',
    'Roteiro do vídeo institucional', 'Atualizar apresentação comercial', 'Newsletter mensal para clientes', 'Fotos da equipe para o site', 'Briefing para agência de branding',
  ],
  Operações: [
    'Inventário do CD Cascavel', 'Fechar indicadores de SLA de {mes}', 'Treinar novo auxiliar na expedição', 'Roteirizar entregas de Toledo e Medianeira', 'Revisar processo de devolução',
    'Conferir notas de entrada da semana', 'Atender reclamação de {cliente}', 'Manutenção preventiva da empilhadeira', 'Organizar mutirão de 5S no depósito', 'Atualizar FAQ do atendimento',
    'Auditoria de estoque do lote 42', 'Agendar coletas com a transportadora',
  ],
  Tecnologia: [
    'Corrigir bug no login com SSO', 'Implementar filtros na tela de relatórios', 'Code review do módulo de pagamentos', 'Migrar banco para Postgres 16', 'Painel de vendas no Metabase',
    'Integração do ERP com o e-commerce', 'Atualizar dependências do backend', 'Backup automatizado dos servidores', 'Chamados de suporte da semana', 'Configurar novos notebooks',
    'Testes automatizados do checkout', 'Documentar API de pedidos',
  ],
  Financeiro: [
    'Conciliação bancária de {mes}', 'Fluxo de caixa projetado Q4', 'Fechamento contábil de {mes}', 'Revisar contas a pagar da semana', 'Emitir notas fiscais pendentes',
    'Relatório de inadimplência', 'Negociar prazo com fornecedor de embalagens', 'Orçamento 2027 por área', 'Conferir comissões do comercial', 'Renovar seguro patrimonial',
  ],
  'Pessoas & Cultura': [
    'Planejar onboarding dos novos contratados', 'Divulgar vagas nas comunidades', 'Organizar happy hour de {mes}', 'Revisar política de home office', 'Folha de pagamento de {mes}',
    'Pesquisa de benefícios', 'Treinamento de NR-11 para operações', 'Entrevistas da vaga de vendas', 'Atualizar organograma', 'Calendário de 1:1 dos gestores',
  ],
  Diretoria: ['Aprovar orçamento de marketing 2027', 'Revisar plano estratégico', 'Reunião com o conselho', 'Avaliar proposta de expansão para Toledo', 'Feedback semestral dos gestores', 'Análise de resultados do trimestre'],
};
const CLIENTES = ['Cooperativa Coopavel', 'Construtora Horizonte', 'Grupo Vértice', 'Agro Oeste', 'Frigorífico Vale Verde', 'Rede Super Center', 'Transportes Iguaçu', 'Moinho Paraná'];
const MESES = ['agosto', 'setembro', 'outubro'];
const fillTitle = (t: string) => t.replace('{cliente}', pick(CLIENTES)).replace('{mes}', pick(MESES));

async function main() {
  if ((await prisma.user.count()) > 0) {
    console.log('O banco já tem dados. Para recriar do zero: npm run db:reset');
    return;
  }
  console.log('Criando dados de demonstração (leva cerca de 1 minuto)…');
  await ensureUploadDirs();
  const passwordHash = await bcrypt.hash('dumax123', 10);

  // ═════════ Estrutura ═════════
  const dept: Record<string, string> = {};
  for (const [name, color, description] of DEPTS) dept[name] = (await prisma.department.create({ data: { name, color, description } })).id;

  const u: Record<string, string> = {};
  const byKey = new Map(PEOPLE.map((p) => [p.key, p]));
  for (const [i, p] of PEOPLE.entries()) {
    const start = p.start ?? '08:00';
    const [h, m] = start.split(':').map(Number);
    const end = `${String(h + 9).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    const created = await prisma.user.create({
      data: {
        name: p.name,
        email: p.email ?? E(slug(p.name.split(' ')[0])),
        passwordHash,
        role: p.role,
        jobTitle: p.title,
        level: inferLevel(p.title),
        departmentId: dept[p.dept],
        managerId: p.mgr ? u[p.mgr] : null,
        phone: `(45) 9${String(9100 + i * 23).slice(0, 4)}-${String(1000 + i * 97).slice(0, 4)}`,
        hiredAt: addDays(TODAY, -int(90, 2400)),
        birthday: dateOnly(`19${int(78, 99)}-${String(int(1, 12)).padStart(2, '0')}-${String(int(1, 28)).padStart(2, '0')}`),
        pontoCode: String(1000 + i),
        lastSeenAt: hoursFromNow(-between(0.1, 30)),
        workSchedule: { create: { startTime: start, endTime: end, breakMinutes: 60, toleranceMinutes: 10 } },
      },
    });
    u[p.key] = created.id;
  }
  const heads: [string, string][] = [['Diretoria', 'ceo'], ['Comercial', 'gestor'], ['Marketing', 'tatiane'], ['Operações', 'juliana'], ['Tecnologia', 'tech'], ['Financeiro', 'fin'], ['Pessoas & Cultura', 'rh']];
  for (const [d, k] of heads) await prisma.department.update({ where: { id: dept[d] }, data: { headId: u[k] } });

  const TEAMS = [
    { name: 'Inside Sales', d: 'Comercial', lead: 'gestor', members: ['pedro', 'camila', 'aline', 'gabriel'] },
    { name: 'Contas Estratégicas', d: 'Comercial', lead: 'eduardo', members: ['luiza', 'rodrigo', 'eduardo'] },
    { name: 'Expedição', d: 'Operações', lead: 'rafael', members: ['rafael', 'thiago', 'leandro', 'mateus', 'anderson'] },
    { name: 'Atendimento', d: 'Operações', lead: 'jessica', members: ['jessica', 'priscila', 'cristiane'] },
    { name: 'Squad Plataforma', d: 'Tecnologia', lead: 'tech', members: ['ana', 'lucas', 'renan', 'paula'] },
    { name: 'Dados & Suporte', d: 'Tecnologia', lead: 'tech', members: ['bianca', 'felipe'] },
    { name: 'Controladoria', d: 'Financeiro', lead: 'fin', members: ['diego', 'simone', 'otavio', 'rosana'] },
    { name: 'Comitê de Cultura', d: 'Pessoas & Cultura', lead: 'rh', members: ['bruna', 'luiza', 'ana', 'jessica', 'kelly'] },
  ];
  const teamOf: Record<string, string> = {};
  for (const t of TEAMS) {
    const ids = [...new Set([t.lead, ...t.members])].map((k) => u[k]);
    const team = await prisma.team.create({ data: { name: t.name, departmentId: dept[t.d], leadId: u[t.lead], members: { create: ids.map((userId) => ({ userId })) } } });
    for (const k of t.members) teamOf[k] ??= team.id;
  }

  // ═════════ Perfis comportamentais dos colaboradores ═════════
  for (const p of PEOPLE) {
    if (!p.profile) continue;
    const { answers, result } = profileAnswers(p.profile);
    await prisma.profileAssessment.create({
      data: { userId: u[p.key], answers, result: result as unknown as Prisma.InputJsonValue, primaryProfile: result.primary, completedAt: at(NOW, -int(5, 120)) },
    });
  }

  // ═════════ Ponto: 60 dias (provedor de demonstração) ═════════
  console.log('  ponto: 60 dias de batidas…');
  await syncPonto(addDays(TODAY, -60));
  // quem tem tendência a atrasar
  for (const p of PEOPLE.filter((x) => ARCH[x.arch].late > 0)) {
    const ins = await prisma.timeEntry.findMany({ where: { userId: u[p.key], type: 'IN' } });
    const touched = new Set<string>();
    for (const e of ins) {
      if (!chance(ARCH[p.arch].late)) continue;
      await prisma.timeEntry.update({ where: { id: e.id }, data: { at: new Date(e.at.getTime() + int(18, 55) * 60000) } });
      touched.add(brDateKey(e.at));
    }
    for (const k of touched) await computeDay(u[p.key], k);
  }

  // ═════════ Demandas (centenas) ═════════
  console.log('  demandas e apontamentos…');
  type TaskRow = Prisma.TaskCreateManyInput;
  const tasks: TaskRow[] = [];
  const activities: Prisma.TaskActivityCreateManyInput[] = [];
  const comments: Prisma.TaskCommentCreateManyInput[] = [];
  const checklist: Prisma.TaskChecklistItemCreateManyInput[] = [];
  const tasksByUser: Record<string, { id: string; createdAt: Date; completedAt: Date | null }[]> = {};
  const peersOf = (p: P) => PEOPLE.filter((x) => x.dept === p.dept && x.key !== p.key);

  for (const p of PEOPLE) {
    const a = ARCH[p.arch];
    const scale = p.key === 'ceo' ? 0.3 : p.role === 'MANAGER' || p.role === 'HR' ? 0.65 : 1;
    const pool = TASK_POOL[p.dept];
    const creatorFor = () => (p.mgr && chance(0.75) ? u[p.mgr] : u[pick(peersOf(p).length ? peersOf(p) : [p]).key]);
    const add = (status: TaskStatus, dueAt: Date | null, createdAt: Date, completedAt: Date | null, priority: TaskPriority) => {
      const id = randomUUID();
      const createdById = creatorFor();
      const startedAt = status === 'TODO' ? null : new Date(createdAt.getTime() + between(2, 30) * 3600000);
      tasks.push({
        id,
        title: fillTitle(pick(pool)),
        description: pick([
          'Detalhes combinados na reunião de alinhamento. Qualquer dúvida, me chama no chat.',
          'Prioridade alta para o cliente. Atualize o status quando avançar.',
          'Segue o mesmo padrão do mês passado.',
          null,
        ]),
        status,
        priority,
        dueAt,
        estimatedHours: pick([1, 2, 2, 3, 4, 4, 6, 8]),
        createdById,
        assigneeId: u[p.key],
        teamId: teamOf[p.key] ?? null,
        tags: chance(0.3) ? [pick(['cliente', 'interno', 'urgente', 'melhoria', 'rotina'])] : [],
        createdAt,
        startedAt: startedAt && startedAt < NOW ? startedAt : status === 'TODO' ? null : createdAt,
        completedAt,
      });
      activities.push({ taskId: id, actorId: createdById, type: 'CREATED', createdAt });
      if (status !== 'TODO') activities.push({ taskId: id, actorId: u[p.key], type: 'STATUS_CHANGED', data: { from: 'TODO', to: status === 'DONE' ? 'IN_PROGRESS' : status }, createdAt: startedAt ?? createdAt });
      if (status === 'DONE') activities.push({ taskId: id, actorId: u[p.key], type: 'STATUS_CHANGED', data: { from: 'IN_PROGRESS', to: 'DONE' }, createdAt: completedAt! });
      if (status === 'BLOCKED') comments.push({ taskId: id, authorId: u[p.key], body: pick(['Aguardando retorno do financeiro para seguir.', 'Travado: o cliente não enviou os dados.', 'Dependo do acesso ao sistema que a TI está liberando.']), createdAt: new Date(createdAt.getTime() + 86400000) });
      if (chance(0.15)) comments.push({ taskId: id, authorId: createdById, body: pick(['Como está esse aqui?', 'Boa! Obrigado pela agilidade.', 'Consegue priorizar essa semana?', 'Me avisa se precisar de ajuda.']), createdAt: new Date(createdAt.getTime() + 2 * 86400000) });
      if (chance(0.2)) ['Levantar informações', 'Executar', 'Revisar com o gestor'].forEach((t, i) => checklist.push({ taskId: id, title: t, position: i, done: status === 'DONE' || (status !== 'TODO' && i === 0) }));
      (tasksByUser[p.key] ??= []).push({ id, createdAt, completedAt });
    };

    // concluídas nos últimos 60 dias
    const nDone = Math.round(a.done * scale * between(0.85, 1.15));
    for (let i = 0; i < nDone; i++) {
      const completedAt = new Date(NOW.getTime() - between(2, 60 * 24) * 3600000);
      const onTime = chance(a.onTime);
      const dueAt = onTime ? new Date(completedAt.getTime() + between(2, 96) * 3600000) : new Date(completedAt.getTime() - between(6, 120) * 3600000);
      const createdAt = new Date(Math.min(completedAt.getTime(), dueAt.getTime()) - between(1, 9) * 86400000);
      add('DONE', dueAt, createdAt, completedAt, weighted({ LOW: 2, MEDIUM: 5, HIGH: 3, URGENT: 1 }));
    }
    // em aberto
    const nOpen = Math.max(1, Math.round(a.open * scale));
    for (let i = 0; i < nOpen; i++) {
      const overdue = i < Math.round(a.overdue * scale);
      const blocked = !overdue && i < Math.round((a.overdue + a.blocked) * scale);
      const dueAt = overdue ? hoursFromNow(-between(8, 240)) : chance(0.12) ? null : hoursFromNow(between(6, 320));
      const createdAt = new Date(Math.min(NOW.getTime(), (dueAt ?? NOW).getTime()) - between(1, 12) * 86400000);
      const status: TaskStatus = blocked ? 'BLOCKED' : weighted({ TODO: 4, IN_PROGRESS: 4, IN_REVIEW: 1 });
      add(status, dueAt, createdAt, null, overdue ? weighted({ MEDIUM: 2, HIGH: 3, URGENT: 2 }) : weighted({ LOW: 2, MEDIUM: 5, HIGH: 2, URGENT: 1 }));
    }
    // canceladas ocasionais
    if (chance(0.3)) add('CANCELED', null, at(NOW, -int(10, 40)), null, 'LOW');
  }
  // algumas demandas fixas para o roteiro de demonstração
  const demoTask = (title: string, from: string, to: string, status: TaskStatus, priority: TaskPriority, dueH: number | null) => {
    const id = randomUUID();
    const createdAt = at(NOW, -int(2, 6));
    tasks.push({ id, title, description: 'Combinado na reunião de segunda. Me atualiza por aqui.', status, priority, dueAt: dueH === null ? null : hoursFromNow(dueH), createdById: u[from], assigneeId: u[to], estimatedHours: 3, createdAt, startedAt: status === 'TODO' ? null : at(createdAt, 1) });
    activities.push({ taskId: id, actorId: u[from], type: 'CREATED', createdAt });
    (tasksByUser[to] ??= []).push({ id, createdAt, completedAt: null });
    return id;
  };
  const horizonte = demoTask('Enviar proposta revisada para a Construtora Horizonte', 'gestor', 'luiza', 'IN_PROGRESS', 'HIGH', 20);
  ['Revisar escopo', 'Validar preço com o financeiro', 'Enviar e agendar call'].forEach((t, i) => checklist.push({ taskId: horizonte, title: t, position: i, done: i === 0 }));
  demoTask('Preparar apresentação para o Grupo Vértice', 'gestor', 'luiza', 'BLOCKED', 'URGENT', -5);
  demoTask('Follow-up com os 15 leads da Show Rural', 'gestor', 'pedro', 'TODO', 'HIGH', -30);
  demoTask('Fluxo de caixa projetado do 4º trimestre', 'ceo', 'fin', 'IN_PROGRESS', 'URGENT', 40);
  demoTask('Aprovar orçamento de marketing 2027', 'tatiane', 'ceo', 'TODO', 'HIGH', 70);
  demoTask('Revisar política de home office', 'ceo', 'rh', 'IN_PROGRESS', 'MEDIUM', 50);
  demoTask('Feedback semestral do time comercial', 'ceo', 'gestor', 'TODO', 'MEDIUM', -20);

  await prisma.task.createMany({ data: tasks });
  await prisma.taskActivity.createMany({ data: activities });
  await prisma.taskComment.createMany({ data: comments });
  await prisma.taskChecklistItem.createMany({ data: checklist });

  // ═════════ Agenda (reuniões contam como tempo ocupado) ═════════
  const createMeeting = async (title: string, organizer: string, who: string[], startsAt: Date, minutes: number, extra: Partial<Prisma.MeetingCreateInput> = {}) => {
    await prisma.meeting.create({
      data: {
        title,
        startsAt,
        endsAt: new Date(startsAt.getTime() + minutes * 60000),
        organizer: { connect: { id: u[organizer] } },
        videoUrl: chance(0.6) ? 'https://meet.google.com/dmx-hub-demo' : null,
        location: chance(0.4) ? pick(['Sala Iguaçu', 'Sala Paraná', 'Auditório', 'Depósito — mezanino']) : null,
        participants: {
          create: [...new Set([organizer, ...who])].map((k) => ({ userId: u[k], rsvp: k === organizer ? ('ACCEPTED' as const) : weighted({ ACCEPTED: 8, PENDING: 1, TENTATIVE: 1, DECLINED: 0.4 }) })),
        },
        ...extra,
      },
    });
  };
  for (let w = -9; w <= 1; w++) {
    const monday = addDays(weekStart(), w * 7);
    const key = (offset: number) => dk(addDays(monday, offset));
    for (const [d, head] of heads) {
      const members = PEOPLE.filter((p) => p.dept === d).map((p) => p.key);
      await createMeeting(`Reunião semanal ${d}`, head, members, brDateTime(key(0), d === 'Operações' ? '07:45' : '09:00'), d === 'Diretoria' ? 90 : 60);
    }
    await createMeeting('Comitê de gestores', 'ceo', heads.map(([, k]) => k).concat('helena'), brDateTime(key(2), '14:00'), 90);
    // 1:1 quinzenal com cada liderado
    if (w % 2 === 0)
      for (const p of PEOPLE.filter((x) => x.mgr && x.mgr !== 'ceo')) await createMeeting(`1:1 ${byKey.get(p.mgr!)!.name.split(' ')[0]} & ${p.name.split(' ')[0]}`, p.mgr!, [p.key], brDateTime(key(int(1, 4)), pick(['10:00', '11:00', '15:00', '16:00'])), 30);
  }
  // daily do comercial (todo dia útil)
  for (let i = -42; i <= 7; i++) {
    const d = addDays(TODAY, i);
    if ([0, 6].includes(d.getUTCDay())) continue;
    await createMeeting('Daily Comercial', 'gestor', ['luiza', 'pedro', 'camila', 'rodrigo', 'aline', 'eduardo', 'gabriel'], brDateTime(dk(d), '08:15'), 15);
  }
  const tomorrow = brDateKey(at(NOW, 1));
  await createMeeting('Apresentação Grupo Vértice', 'luiza', ['gestor', 'eduardo'], brDateTime(TODAY_KEY, '15:00'), 60, { description: 'Proposta comercial e cronograma de implantação.' });
  await createMeeting('Review da Sprint', 'tech', ['ana', 'lucas', 'renan', 'paula', 'ceo'], brDateTime(tomorrow, '16:00'), 60);
  await createMeeting('Entrevista — vaga Executivo(a) de Vendas', 'rh', ['gestor'], brDateTime(tomorrow, '10:00'), 45);
  await createMeeting('Alinhamento licenças e alvarás', 'helena', ['rh', 'fin'], brDateTime(brDateKey(at(NOW, 2)), '09:30'), 30);

  // ═════════ Apontamento de horas (cruza com o ponto) ═════════
  const days = await prisma.timeDay.findMany({ where: { date: { lt: TODAY }, status: { notIn: ['OFF', 'ABSENT'] }, workedMinutes: { gt: 60 } } });
  const logs: Prisma.TimeLogCreateManyInput[] = [];
  const keyOf = new Map(Object.entries(u).map(([k, id]) => [id, k]));
  for (const d of days) {
    const k = keyOf.get(d.userId)!;
    const p = byKey.get(k)!;
    const a = ARCH[p.arch];
    if (p.key === 'ceo' && chance(0.6)) continue;
    let budget = Math.round(d.workedMinutes * a.coverage * between(0.8, 1.1) * (p.role === 'MANAGER' ? 0.7 : 1));
    let cursor = d.firstIn ? new Date(d.firstIn.getTime() + int(5, 25) * 60000) : brDateTime(dk(d.date), '08:30');
    const userTasks = (tasksByUser[k] ?? []).filter((t) => t.createdAt <= cursor && (!t.completedAt || t.completedAt >= at(cursor, -1)));
    while (budget > 20) {
      const minutes = Math.min(budget, int(35, 150));
      const activity: TimeLogActivity = chance(a.rework)
        ? 'RETRABALHO'
        : weighted({ EXECUCAO: 10, REUNIAO: 1, SUPORTE: p.dept === 'Tecnologia' || p.dept === 'Operações' ? 2.5 : 1, ESTUDO: 0.4, ADMINISTRATIVO: p.arch === 'struggling' ? 3 : 1.2 });
      const task = activity === 'EXECUCAO' || activity === 'RETRABALHO' ? (userTasks.length ? pick(userTasks) : null) : null;
      logs.push({
        userId: d.userId,
        taskId: task?.id ?? null,
        activity,
        description: task ? null : pick(['Rotina do dia', 'Ajuda a colega', 'E-mails e retornos', 'Planejamento da semana', 'Chamados', null]),
        startedAt: cursor,
        endedAt: new Date(cursor.getTime() + minutes * 60000),
        minutes,
      });
      cursor = new Date(cursor.getTime() + (minutes + int(5, 40)) * 60000);
      if (cursor.getUTCHours() === 15 && chance(0.5)) cursor = new Date(cursor.getTime() + 60 * 60000); // almoço (12h BRT)
      budget -= minutes;
    }
  }
  await prisma.timeLog.createMany({ data: logs });
  // cronômetro rodando agora para a Luiza (se for dia útil)
  if (![0, 6].includes(NOW.getUTCDay())) {
    await prisma.timeLog.create({ data: { userId: u.luiza, taskId: horizonte, activity: 'EXECUCAO', startedAt: new Date(NOW.getTime() - 38 * 60000) } });
  }

  // ═════════ Metas ═════════
  console.log('  metas, feedbacks e perfis…');
  const GOALS: Record<string, [string, string, number, number, boolean][]> = {
    Comercial: [['Faturamento novo no trimestre', 'R$', 0, 450000, true], ['Reuniões qualificadas agendadas', 'un', 0, 120, true], ['Taxa de conversão de propostas', '%', 18, 30, true]],
    Marketing: [['Leads gerados pelo site', 'un', 0, 600, true], ['Custo por lead', 'R$', 85, 55, false], ['Posts publicados', 'un', 0, 72, true]],
    Operações: [['Entregas no prazo (OTIF)', '%', 88, 97, true], ['Tempo médio de separação', 'min', 42, 30, false], ['Chamados resolvidos no 1º contato', '%', 61, 80, true]],
    Tecnologia: [['Chamados de suporte resolvidos', 'un', 0, 240, true], ['Cobertura de testes', '%', 35, 70, true], ['Tempo de resposta da API', 'ms', 480, 250, false]],
    Financeiro: [['Inadimplência', '%', 6.5, 3.5, false], ['Fechamento contábil até o dia', 'dia', 12, 5, false], ['Economia em fornecedores', 'R$', 0, 80000, true]],
    'Pessoas & Cultura': [['Vagas fechadas no prazo', 'un', 0, 12, true], ['Participação no pulse', '%', 55, 85, true], ['Treinamentos realizados', 'h', 0, 160, true]],
    Diretoria: [['EBITDA do trimestre', '%', 9, 14, true], ['Projetos estratégicos concluídos', 'un', 0, 6, true]],
  };
  const gStart = addDays(TODAY, -45);
  const gDue = addDays(TODAY, 45);
  for (const p of PEOPLE) {
    const pool = GOALS[p.dept];
    const n = p.key === 'ceo' ? 1 : p.role === 'MANAGER' ? 2 : int(1, 2);
    for (let i = 0; i < n; i++) {
      const [title, unit, start, target, higher] = pool[(i + PEOPLE.indexOf(p)) % pool.length];
      const progress = Math.min(1.1, 0.5 * ARCH[p.arch].goal * between(0.85, 1.15));
      const current = Math.round((start + (target - start) * progress) * 10) / 10;
      const status: GoalStatus = progress >= 1 && chance(0.5) ? 'COMPLETED' : 'ACTIVE';
      const g = await prisma.goal.create({
        data: { title, unit, startValue: start, targetValue: target, currentValue: current, higherIsBetter: higher, startDate: gStart, dueDate: gDue, status, ownerId: u[p.key], createdById: u[p.mgr ?? p.key], teamId: teamOf[p.key] ?? null, description: 'Meta do 4º trimestre.' },
      });
      const steps = int(4, 6);
      for (let s = 1; s <= steps; s++) {
        const v = Math.round((start + (current - start) * (s / steps)) * 10) / 10;
        await prisma.goalCheckin.create({ data: { goalId: g.id, authorId: u[p.key], value: v, note: s === steps ? pick(['Atualizado com os números da semana.', 'Ritmo bom, mantendo.', 'Abaixo do esperado, ajustando plano.', null]) : null, createdAt: addDays(gStart, Math.round((45 * s) / steps)) } });
      }
    }
  }

  // ═════════ Feedbacks e 1:1 (criptografados) ═════════
  const FB: Record<Archetype, [string, string, string[]][]> = {
    star: [['POSITIVO', 'Entrega consistente e muito acima do esperado. Virou referência para o time.', ['Mentorar um colega novo', 'Liderar o projeto do próximo trimestre']], ['ONE_ON_ONE', 'Conversamos sobre carreira e próximos desafios. Quer assumir mais contas estratégicas.', ['Montar plano de desenvolvimento']]],
    solid: [['ONE_ON_ONE', 'Bom ritmo. Combinamos priorizar as demandas com prazo e reduzir interrupções.', ['Bloquear 2h de foco por dia']], ['POSITIVO', 'Ótima colaboração com outras áreas no último mês.', []]],
    avg: [['ALINHAMENTO', 'Algumas entregas saíram depois do prazo. Combinamos revisar a estimativa antes de aceitar novas demandas.', ['Atualizar status das demandas diariamente', 'Apontar horas no fim do dia']]],
    struggling: [['MELHORIA', 'Muitas horas sem atividade registrada e demandas atrasadas. Precisamos entender o que está travando.', ['Apontar horas todos os dias', 'Check-in de 15 min às segundas e quartas', 'Revisar prioridades com o gestor']], ['ONE_ON_ONE', 'Relatou dificuldade com a ferramenta nova e excesso de retrabalho. Vamos fazer um treinamento.', ['Agendar treinamento', 'Reduzir demandas em paralelo para 3']]],
    overloaded: [['ALINHAMENTO', 'Está com demandas demais em paralelo e começou a atrasar. Vamos redistribuir parte do volume.', ['Redistribuir 3 demandas', 'Avisar quando passar de 6 em aberto']], ['ONE_ON_ONE', 'Disse que está cansada(o) com o volume. Combinamos folga compensatória.', ['Agendar folga']]],
  };
  for (const p of PEOPLE.filter((x) => x.mgr)) {
    for (const [i, [type, body, items]] of FB[p.arch].entries()) {
      await prisma.feedback.create({
        data: { subjectId: u[p.key], authorId: u[p.mgr!], type: type as Prisma.FeedbackCreateInput['type'], body: encryptText(body), actionItems: items.map((x) => encryptText(x)), private: type === 'MELHORIA', createdAt: at(NOW, -(i * 14 + int(2, 10))) },
      });
    }
  }

  // ═════════ Vagas e candidatos ═════════
  console.log('  vagas e candidatos…');
  const preset = (e: number, c: number, pl: number, a: number): ProfileScores => normalizeProfile({ EXECUTOR: e, COMUNICADOR: c, PLANEJADOR: pl, ANALISTA: a });
  const JOBS = [
    { title: 'Executivo(a) de Vendas B2B', d: 'Comercial', status: 'OPEN', mode: 'HYBRID', type: 'CLT', min: 4500, max: 7500, show: true, openings: 2, ideal: preset(40, 40, 10, 10), n: 14,
      summary: 'Venda consultiva para indústrias e cooperativas do oeste do Paraná.',
      description: 'Você vai conduzir o ciclo completo de vendas B2B: prospecção, diagnóstico, proposta e fechamento, atendendo indústrias e cooperativas da região de Cascavel.\n\nTrabalha junto com o time de Inside Sales, com metas claras e comissão sem teto.',
      req: '- 2 anos ou mais com vendas B2B\n- Experiência com CRM\n- CNH B e disponibilidade para visitas na região\n- Desejável: vivência com agronegócio', ben: '- Vale-alimentação R$ 900\n- Plano de saúde Unimed\n- Comissão sem teto\n- Carro da empresa para visitas' },
    { title: 'Desenvolvedor(a) Full Stack Pleno', d: 'Tecnologia', status: 'OPEN', mode: 'REMOTE', type: 'CLT', min: 8000, max: 12000, show: false, openings: 1, ideal: preset(15, 10, 25, 50), n: 11,
      summary: 'TypeScript, React e Node.js nos sistemas internos e no e-commerce.',
      description: 'Você vai fazer parte do Squad Plataforma construindo nossos sistemas com TypeScript de ponta a ponta. Code review de verdade, autonomia e foco em qualidade.',
      req: '- TypeScript, React e Node.js\n- PostgreSQL\n- Testes automatizados', ben: '- 100% remoto\n- Auxílio home office\n- Plano de saúde\n- Verba para cursos' },
    { title: 'Analista de Operações Jr', d: 'Operações', status: 'OPEN', mode: 'ONSITE', type: 'CLT', min: 2800, max: 3500, show: true, openings: 1, ideal: preset(30, 10, 40, 20), n: 9,
      summary: 'Indicadores, processos e apoio à expedição.',
      description: 'Apoie o time de Operações no acompanhamento de pedidos, indicadores de nível de serviço e melhoria contínua.',
      req: '- Excel intermediário\n- Organização e atenção a detalhes\n- Cursando ou formado em Administração, Logística ou Engenharia', ben: '- Vale-transporte\n- Refeição no local\n- Plano de saúde\n- PLR' },
    { title: 'Auxiliar de Expedição', d: 'Operações', status: 'OPEN', mode: 'ONSITE', type: 'CLT', min: 1900, max: 2200, show: true, openings: 3, ideal: preset(35, 10, 45, 10), n: 12,
      summary: 'Separação, conferência e carregamento de pedidos.', description: 'Separação e conferência de pedidos, carregamento dos caminhões e organização do depósito.', req: '- Ensino médio completo\n- Disponibilidade das 7h30 às 16h30', ben: '- Refeição no local\n- Vale-transporte\n- Cesta básica' },
    { title: 'Analista Financeiro Pleno', d: 'Financeiro', status: 'OPEN', mode: 'HYBRID', type: 'CLT', min: 5000, max: 6500, show: false, openings: 1, ideal: preset(10, 5, 30, 55), n: 8,
      summary: 'Conciliações, fluxo de caixa e fechamento.', description: 'Responsável por conciliações bancárias, fluxo de caixa e apoio ao fechamento contábil mensal.', req: '- Ciências Contábeis ou Administração\n- Excel avançado\n- Experiência com ERP', ben: '- Plano de saúde\n- Vale-alimentação\n- Híbrido 3x2' },
    { title: 'Social Media', d: 'Marketing', status: 'PAUSED', mode: 'HYBRID', type: 'PJ', min: 3000, max: 4000, show: true, openings: 1, ideal: preset(15, 55, 20, 10), n: 6,
      summary: 'Conteúdo e comunidade nas redes da Dumax.', description: 'Planejamento e produção de conteúdo para Instagram e LinkedIn, relacionamento com a comunidade e relatórios.', req: '- Portfólio\n- Experiência com Meta Business', ben: '- Contrato PJ\n- Horário flexível' },
    { title: 'Estágio em Recursos Humanos', d: 'Pessoas & Cultura', status: 'DRAFT', mode: 'HYBRID', type: 'ESTAGIO', min: 1200, max: 1200, show: true, openings: 1, ideal: preset(10, 40, 40, 10), n: 0,
      summary: 'Recrutamento, onboarding e cultura.', description: 'Venha aprender recrutamento e gestão de pessoas na prática.', req: '- Cursando Psicologia, Administração ou Gestão de RH', ben: '- Bolsa auxílio\n- Vale-transporte' },
    { title: 'Coordenador(a) de Logística', d: 'Operações', status: 'CLOSED', mode: 'ONSITE', type: 'CLT', min: 7000, max: 9000, show: false, openings: 1, ideal: preset(40, 15, 30, 15), n: 7,
      summary: 'Gestão da frota e das rotas regionais.', description: 'Coordenação da frota própria, terceiros e roteirização das entregas na região oeste.', req: '- Experiência com gestão de frota\n- Liderança de equipes', ben: '- Plano de saúde\n- Carro da empresa' },
  ] as const;
  const FIRST = ['Mariana', 'João Victor', 'Larissa', 'Felipe', 'Beatriz', 'Henrique', 'Isabela', 'Vinícius', 'Gabriela', 'Matheus', 'Sofia', 'Daniel', 'Letícia', 'Bruno', 'Amanda', 'Caio', 'Júlia', 'Guilherme', 'Rafaela', 'Leonardo', 'Carolina', 'Diego', 'Fernanda', 'André', 'Natália', 'Samuel', 'Vitória', 'Murilo', 'Bianca', 'Otávio', 'Lívia', 'Heitor'];
  const LAST = ['Teixeira', 'Nunes', 'Duarte', 'Araújo', 'Moreira', 'Castro', 'Freitas', 'Cardoso', 'Pinto', 'Correia', 'Azevedo', 'Monteiro', 'Zanella', 'Bortolini', 'Kuhn', 'Hoffmann', 'Bertoldo', 'Dal Pizzol', 'Sartori', 'Lazzari', 'Rech', 'Schneider', 'Fontana', 'Pasquali'];
  const CITIES = ['Cascavel - PR', 'Cascavel - PR', 'Cascavel - PR', 'Toledo - PR', 'Corbélia - PR', 'Santa Tereza do Oeste - PR', 'Foz do Iguaçu - PR', 'Medianeira - PR'];
  const SOURCES = { site: 3, linkedin: 4, whatsapp: 3, instagram: 2, indeed: 1.5, indicacao: 1.5 };
  const ORDER: Stage[] = ['APPLIED', 'SCREENING', 'ASSESSMENT', 'INTERVIEW', 'OFFER', 'HIRED'];
  const used = new Set<string>();
  let cIdx = 0;
  for (const j of JOBS) {
    const job = await prisma.job.create({
      data: {
        title: j.title,
        slug: `${slug(j.title)}-${randomBytes(3).toString('hex')}`,
        summary: j.summary,
        description: j.description,
        requirements: j.req,
        benefits: j.ben,
        location: j.mode === 'REMOTE' ? 'Remoto (Brasil)' : 'Cascavel - PR',
        workMode: j.mode,
        employmentType: j.type,
        salaryMin: j.min,
        salaryMax: j.max,
        showSalary: j.show,
        openings: j.openings,
        status: j.status,
        idealProfile: j.ideal,
        departmentId: dept[j.d],
        createdById: chance(0.6) ? u.rh : u.bruna,
        publishedAt: j.status === 'DRAFT' ? null : at(NOW, -int(12, 40)),
        closesAt: j.status === 'CLOSED' ? at(NOW, -5) : null,
      },
    });
    let hiredDone = 0;
    for (let i = 0; i < j.n; i++) {
      let name = '';
      do name = `${pick(FIRST)} ${pick(LAST)}`;
      while (used.has(name));
      used.add(name);
      cIdx++;
      const created = at(NOW, -between(0.2, 35));
      let stage: Stage =
        j.status === 'CLOSED'
          ? hiredDone < j.openings ? 'HIRED' : 'REJECTED'
          : weighted({ APPLIED: 4, SCREENING: 2, ASSESSMENT: 3, INTERVIEW: 2, OFFER: 0.6, REJECTED: 2, HIRED: 0.3 });
      if (stage === 'HIRED') hiredDone++;
      // aderência variada: parte parecida com o ideal, parte diferente
      const aligned = chance(0.5);
      const idealMix = Object.fromEntries(PROFILE_KEYS.map((k) => [k, (aligned ? j.ideal[k] : 100 - j.ideal[k]) / 100 + 0.05])) as Record<ProfileKey, number>;
      const hasTest = stage !== 'APPLIED' && stage !== 'SCREENING' ? chance(0.92) : chance(0.2);
      const testDone = hasTest && (stage !== 'ASSESSMENT' || chance(0.6));
      const phone = `(45) 9${int(8800, 9999)}-${int(1000, 9999)}`;
      const candidate = await prisma.candidate.create({
        data: { name, email: `${slug(name).replace(/-/g, '.')}.${cIdx}@email.com`, phone: encryptText(phone), city: pick(CITIES), linkedinUrl: chance(0.5) ? `https://linkedin.com/in/${slug(name)}` : null, createdAt: created },
      });
      const resume = await storeFile('resumes', `Curriculo-${slug(name)}.pdf`, makePdf(`Curriculo - ${name}`, [`E-mail: ${candidate.email}`, `Cidade: ${candidate.city}`, '', 'Experiencia', `- ${pick(['3 anos', '5 anos', '1 ano', '8 anos'])} na area de ${j.d}`, `- ${pick(['Ensino superior completo', 'Tecnologo', 'Cursando graduacao'])}`, '', 'Objetivo', `Atuar como ${j.title}`]));
      const app = await prisma.application.create({
        data: {
          jobId: job.id,
          candidateId: candidate.id,
          stage,
          source: weighted(SOURCES),
          resumePath: resume.key,
          resumeName: resume.name,
          coverLetter: chance(0.6) ? encryptText(pick(['Tenho muito interesse na vaga e acredito que posso contribuir com o time.', 'Moro em Cascavel e tenho disponibilidade imediata.', 'Conheço a Dumax há anos e seria um prazer fazer parte.', 'Trabalhei 3 anos em função parecida e quero crescer na área.'])) : null,
          rating: stage === 'APPLIED' ? null : int(2, 5),
          createdAt: created,
          stageUpdatedAt: at(created, int(1, 4)),
          hiredAt: stage === 'HIRED' ? at(created, 14) : null,
          rejectionReason: stage === 'REJECTED' ? encryptText(pick(['Pretensão salarial acima da faixa', 'Perfil pouco aderente ao momento da vaga', 'Sem disponibilidade de horário', 'Desistiu do processo'])) : null,
          events: { create: { type: 'CREATED', body: 'Candidatura recebida pelo portal de vagas', toStage: 'APPLIED', createdAt: created } },
        },
      });
      const target = stage === 'REJECTED' ? int(0, 3) : ORDER.indexOf(stage);
      for (let s = 1; s <= target; s++) {
        await prisma.applicationEvent.create({ data: { applicationId: app.id, type: 'STAGE_CHANGED', fromStage: ORDER[s - 1], toStage: ORDER[s], authorId: pick([u.rh, u.bruna]), createdAt: at(created, s) } });
      }
      if (stage === 'REJECTED') await prisma.applicationEvent.create({ data: { applicationId: app.id, type: 'STAGE_CHANGED', fromStage: ORDER[target], toStage: 'REJECTED', authorId: u.bruna, createdAt: at(created, target + 1) } });
      if (chance(0.3)) await prisma.applicationEvent.create({ data: { applicationId: app.id, type: 'NOTE', authorId: u.rh, body: pick(['Boa comunicação na triagem por telefone.', 'Pediu para remarcar a entrevista.', 'Referências positivas do último emprego.', 'Mora perto da empresa.']), createdAt: at(created, 1) } });
      if (hasTest) {
        const { answers, result } = profileAnswers(idealMix);
        await prisma.assessmentInvite.create({
          data: {
            applicationId: app.id,
            token: randomBytes(18).toString('base64url'),
            expiresAt: at(created, 7),
            status: testDone ? 'COMPLETED' : 'PENDING',
            answers: testDone ? answers : undefined,
            result: testDone ? (result as unknown as Prisma.InputJsonValue) : undefined,
            primaryProfile: testDone ? result.primary : null,
            startedAt: testDone || chance(0.4) ? at(created, 1) : null,
            completedAt: testDone ? at(created, 1.2) : null,
            createdAt: at(created, 0.1),
          },
        });
        await prisma.applicationEvent.create({ data: { applicationId: app.id, type: 'ASSESSMENT_SENT', body: 'Teste de perfil enviado', createdAt: at(created, 0.1) } });
        if (testDone) await prisma.applicationEvent.create({ data: { applicationId: app.id, type: 'ASSESSMENT_COMPLETED', body: `Teste concluído: perfil ${result.primary.toLowerCase()}`, createdAt: at(created, 1.2) } });
      }
    }
  }

  // ═════════ Licenças e vencimentos ═════════
  console.log('  licenças, documentos, pulse e chat…');
  const LIC: [string, LicenseCategory, string, number, string, string | null, number | null][] = [
    ['Alvará de funcionamento — matriz', 'ALVARA', 'Prefeitura de Cascavel', 18, 'helena', 'rh', 890],
    ['AVCB — Corpo de Bombeiros', 'AVCB', 'Corpo de Bombeiros do Paraná', -6, 'juliana', 'helena', 2400],
    ['Licença de operação ambiental', 'AMBIENTAL', 'IAT — Instituto Água e Terra', 140, 'juliana', 'helena', 5200],
    ['Licença sanitária do refeitório', 'SANITARIA', 'Vigilância Sanitária de Cascavel', 52, 'rh', 'monica', 320],
    ['Certificado digital e-CNPJ A1', 'CERTIFICADO_DIGITAL', 'Certisign', 9, 'fin', 'diego', 260],
    ['Certificado digital A3 — DP', 'CERTIFICADO_DIGITAL', 'Serasa Experian', 210, 'natalia', 'rh', 420],
    ['Microsoft 365 Business', 'SOFTWARE', 'Microsoft', 300, 'tech', 'bianca', 14400],
    ['Licença do ERP', 'SOFTWARE', 'TOTVS', 25, 'tech', 'fin', 38000],
    ['Contrato de locação — galpão BR-277', 'CONTRATO', 'Imobiliária Oeste', 75, 'helena', 'fin', null],
    ['Seguro patrimonial', 'SEGURO', 'Porto Seguro', 33, 'fin', 'helena', 18500],
    ['Seguro da frota', 'SEGURO', 'Sompo', 160, 'juliana', 'fin', 22800],
    ['Certidão negativa de débitos federais', 'OUTRO', 'Receita Federal', 3, 'fin', 'simone', null],
    ['Registro no CRA-PR', 'OUTRO', 'Conselho Regional de Administração', -21, 'rh', null, 690],
    ['Alvará — filial Toledo', 'ALVARA', 'Prefeitura de Toledo', 260, 'helena', null, 640],
  ];
  for (const [name, category, issuer, days, resp, backup, cost] of LIC) {
    const expiresAt = addDays(TODAY, days);
    const file = await storeFile('licenses', `${slug(name)}.pdf`, makePdf(name, [`Emitido por: ${issuer}`, `Validade: ${dk(expiresAt).split('-').reverse().join('/')}`, '', 'Documento de demonstracao do Dumax Hub.']));
    const lic = await prisma.license.create({
      data: {
        name, category, issuer, cost,
        number: `${int(10000, 99999)}/${int(2023, 2026)}`,
        issuedAt: addDays(expiresAt, -365),
        expiresAt,
        responsibleId: u[resp],
        backupId: backup ? u[backup] : null,
        alertDays: category === 'CERTIFICADO_DIGITAL' ? [30, 15, 7, 3, 1] : [60, 30, 15, 7, 1],
        notifyEmails: category === 'OUTRO' || category === 'CERTIFICADO_DIGITAL' ? ['contabilidade@escritoriooeste.com.br'] : [],
        description: pick(['Original arquivado na pasta da diretoria.', 'Para renovar: protocolo online com 30 dias de antecedência.', 'Precisa do laudo atualizado do técnico.', null]),
        filePath: file.key,
        fileName: file.name,
      },
    });
    if (chance(0.5)) {
      await prisma.licenseRenewal.create({ data: { licenseId: lic.id, previousExpiresAt: addDays(expiresAt, -365), newExpiresAt: expiresAt, renewedById: u[resp], note: 'Renovação anual.', createdAt: addDays(expiresAt, -370) } });
    }
    for (const d of [60, 30, 15, 7, 1]) if (days <= d) await prisma.licenseAlertLog.create({ data: { licenseId: lic.id, expiresAt, daysBefore: d, sentAt: addDays(expiresAt, -d) } }).catch(() => undefined);
  }

  // ═════════ Documentos para assinatura ═════════
  const signerToken = () => randomBytes(24).toString('base64url');
  const DOCS: { title: string; category: string; from: string; signers: { key?: string; name?: string; email?: string; cpf?: string; role: string; signed: boolean | 'declined' }[]; sequential?: boolean; canceled?: boolean; ago: number; dueIn?: number; message?: string }[] = [
    { title: 'Política de home office 2026', category: 'Política interna', from: 'rh', ago: 6, dueIn: 4, message: 'Leia com atenção e assine até sexta.', signers: [{ key: 'luiza', role: 'Colaborador', signed: false }, { key: 'pedro', role: 'Colaborador', signed: false }, { key: 'ana', role: 'Colaborador', signed: true }, { key: 'lucas', role: 'Colaborador', signed: true }, { key: 'renan', role: 'Colaborador', signed: true }, { key: 'igor', role: 'Colaborador', signed: false }] },
    { title: 'Recibo de bonificação — 3º trimestre', category: 'Recibo', from: 'fin', ago: 2, dueIn: 5, signers: [{ key: 'luiza', role: 'Colaborador', signed: false }] },
    { title: 'Contrato comercial — Construtora Horizonte', category: 'Contrato comercial', from: 'gestor', ago: 3, dueIn: 7, sequential: true, signers: [{ key: 'gestor', role: 'Representante Dumax', signed: true }, { name: 'Carlos Henrique Zanotto', email: 'carlos@construtorahorizonte.com.br', cpf: '052.318.449-10', role: 'Contratante', signed: false }] },
    { title: 'Aditivo contratual — mudança de jornada', category: 'Aditivo', from: 'rh', ago: 4, sequential: true, signers: [{ key: 'gestor', role: 'Gestor', signed: true }, { key: 'pedro', role: 'Colaborador', signed: false }] },
    { title: 'NDA — fornecedor de embalagens', category: 'Contrato comercial', from: 'fin', ago: 1, dueIn: 3, signers: [{ key: 'ceo', role: 'Diretor', signed: false }, { name: 'Embalagens Paraná Ltda', email: 'juridico@embalagenspr.com.br', role: 'Fornecedor', signed: false }] },
    { title: 'Termo de ciência LGPD', category: 'Termo de responsabilidade', from: 'ceo', ago: 5, signers: [{ key: 'rh', role: 'Encarregada de dados', signed: false }, { key: 'bruna', role: 'Colaborador', signed: true }] },
    { title: 'Contrato de trabalho — Sofia Azevedo', category: 'Contrato de trabalho', from: 'rh', ago: 18, signers: [{ name: 'Sofia Azevedo', email: 'sofia.azevedo@email.com', cpf: '107.442.689-33', role: 'Colaborador', signed: true }, { key: 'ceo', role: 'Empregador', signed: true }] },
    { title: 'Termo de responsabilidade — notebook', category: 'Termo de responsabilidade', from: 'tech', ago: 25, signers: [{ key: 'lucas', role: 'Colaborador', signed: true }] },
    { title: 'Política de uso de veículos', category: 'Política interna', from: 'juliana', ago: 30, signers: ['anderson', 'thiago', 'mateus', 'leandro'].map((key) => ({ key, role: 'Colaborador', signed: true as const })) },
    { title: 'Advertência — atrasos recorrentes', category: 'Advertência', from: 'rh', ago: 12, canceled: true, signers: [{ key: 'thiago', role: 'Colaborador', signed: 'declined' }] },
    { title: 'Contrato de prestação — agência de branding', category: 'Contrato comercial', from: 'tatiane', ago: 40, signers: [{ key: 'tatiane', role: 'Contratante', signed: true }, { name: 'Estúdio Norte Design', email: 'contato@estudionorte.com.br', role: 'Contratada', signed: true }] },
  ];
  for (const d of DOCS) {
    const file = await storeFile('documents', `${slug(d.title)}.pdf`, makePdf(d.title, ['Pelo presente instrumento, as partes abaixo identificadas', 'concordam com os termos descritos neste documento.', '', 'Clausula 1 - Objeto', 'Clausula 2 - Vigencia', 'Clausula 3 - Disposicoes gerais', '', 'Cascavel - PR']));
    const createdAt = at(NOW, -d.ago);
    const allSigned = d.signers.every((s) => s.signed === true);
    const doc = await prisma.document.create({
      data: {
        title: d.title, category: d.category, message: d.message ?? null,
        filePath: file.key, fileName: file.name, fileSize: file.size, fileHash: file.sha256,
        status: d.canceled ? 'CANCELED' : allSigned ? 'COMPLETED' : 'PENDING',
        sequential: d.sequential ?? false,
        dueAt: d.dueIn ? at(NOW, d.dueIn) : null,
        createdById: u[d.from],
        createdAt,
        completedAt: allSigned ? at(createdAt, 1.5) : null,
        canceledAt: d.canceled ? at(createdAt, 2) : null,
      },
    });
    const events: Prisma.DocumentEventCreateManyInput[] = [
      { documentId: doc.id, type: 'CREATED', actorName: byKey.get(d.from)!.name, ip: '177.54.12.8', createdAt },
      { documentId: doc.id, type: 'SENT', actorName: byKey.get(d.from)!.name, createdAt },
    ];
    for (const [i, s] of d.signers.entries()) {
      const person = s.key ? byKey.get(s.key)! : null;
      const name = person?.name ?? s.name!;
      const signedAt = s.signed === true ? at(createdAt, 0.3 + i * 0.4) : null;
      const signer = await prisma.documentSigner.create({
        data: {
          documentId: doc.id,
          userId: s.key ? u[s.key] : null,
          name,
          email: person ? (person.email ?? E(slug(person.name.split(' ')[0]))) : s.email!,
          cpf: s.cpf ? encryptText(s.cpf) : null,
          role: s.role,
          order: i,
          token: signerToken(),
          status: s.signed === true ? 'SIGNED' : s.signed === 'declined' ? 'DECLINED' : 'PENDING',
          viewedAt: s.signed !== false || chance(0.4) ? at(createdAt, 0.2 + i * 0.4) : null,
          signedAt,
          declinedAt: s.signed === 'declined' ? at(createdAt, 1) : null,
          declineReason: s.signed === 'declined' ? 'Discordo dos horários registrados, vou conversar com o RH.' : null,
          signatureText: signedAt ? name : null,
          signatureImage: signedAt ? encryptText(signatureSvg(name)) : null,
          ip: signedAt ? `189.${int(10, 250)}.${int(1, 250)}.${int(1, 250)}` : null,
          userAgent: signedAt ? pick(['Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/129', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Safari/604.1', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) Safari/605.1']) : null,
        },
      });
      if (signer.viewedAt) events.push({ documentId: doc.id, type: 'VIEWED', actorName: name, signerId: signer.id, createdAt: signer.viewedAt });
      if (signedAt) events.push({ documentId: doc.id, type: 'SIGNED', actorName: name, signerId: signer.id, ip: signer.ip, createdAt: signedAt });
      if (s.signed === 'declined') events.push({ documentId: doc.id, type: 'DECLINED', actorName: name, signerId: signer.id, createdAt: at(createdAt, 1) });
    }
    if (allSigned) events.push({ documentId: doc.id, type: 'COMPLETED', actorName: 'Sistema', createdAt: at(createdAt, 1.5) });
    if (d.canceled) events.push({ documentId: doc.id, type: 'CANCELED', actorName: byKey.get(d.from)!.name, createdAt: at(createdAt, 2) });
    await prisma.documentEvent.createMany({ data: events });
  }

  // ═════════ Pulse (12 semanas; a atual aberta) ═════════
  const DEPT_MOOD: Record<string, number> = { Diretoria: 4.1, Comercial: 3.7, Marketing: 3.9, Operações: 3.1, Tecnologia: 4.0, Financeiro: 3.6, 'Pessoas & Cultura': 4.2 };
  const PULSE_COMMENTS: Record<'low' | 'mid' | 'high', string[]> = {
    low: ['Semana muito puxada, faltou gente na expedição.', 'Reuniões demais, não sobra tempo para fazer o trabalho.', 'Falta clareza nas prioridades.', 'O calor no depósito está insuportável.', 'Me sinto sobrecarregada com tantas demandas ao mesmo tempo.'],
    mid: ['Semana normal.', 'Poderia ter mais alinhamento entre as áreas.', 'O sistema travou várias vezes.', 'Tudo certo, mas cansativo.'],
    high: ['O time ajudou muito nesta semana!', 'Adorei o café da manhã de aniversariantes.', 'Muito feliz com o projeto novo.', 'Fechamos o maior contrato do ano!', 'Gestora sempre disponível, isso faz diferença.'],
  };
  const ws = weekStart();
  const demoKeys = new Set(['ceo', 'rh', 'gestor', 'luiza']);
  for (let w = 11; w >= 0; w--) {
    const start = addDays(ws, -7 * w);
    const survey = await prisma.pulseSurvey.create({
      data: { weekStart: start, question: w === 3 ? 'De 1 a 5, quanto você se sente reconhecido(a) pelo seu trabalho?' : PULSE_DEFAULT_QUESTION, status: w === 0 ? 'OPEN' : 'CLOSED', opensAt: addDays(start, 4), closesAt: addDays(start, 10), createdAt: addDays(start, 4) },
    });
    const rows: Prisma.PulseResponseCreateManyInput[] = [];
    for (const p of PEOPLE) {
      if (w === 0 && demoKeys.has(p.key)) continue; // demo: ainda não responderam esta semana
      if (chance(w === 0 ? 0.45 : 0.18)) continue;
      const trend = p.dept === 'Operações' ? -(11 - w) * 0.03 : (11 - w) * 0.02;
      const score = Math.max(1, Math.min(5, Math.round(DEPT_MOOD[p.dept] + ARCH[p.arch].pulse + trend + between(-1, 1))));
      const comment = chance(0.22) ? pick(PULSE_COMMENTS[score <= 2 ? 'low' : score === 3 ? 'mid' : 'high']) : null;
      rows.push({ surveyId: survey.id, userId: u[p.key], score, comment: encryptText(comment), anonymous: chance(0.8), departmentId: dept[p.dept], createdAt: new Date(Math.min(at(start, 4 + between(0, 2)).getTime(), NOW.getTime() - between(1, 40) * 3600000)) });
    }
    await prisma.pulseResponse.createMany({ data: rows });
  }

  // ═════════ Mural e elogios ═════════
  await prisma.announcement.createMany({
    data: [
      { title: 'Bem-vindos ao Dumax Hub', body: 'Demandas, chat, ponto, documentos e comunicados agora ficam todos aqui. Toda sexta tem o pulse da semana: leva 10 segundos e ajuda muito a gente a melhorar.', pinned: true, authorId: u.ceo, createdAt: at(NOW, -40) },
      { title: 'Show Rural 2027: inscrições para o estande', body: 'Quem quiser participar da escala do estande na Show Rural, fale com a Tatiane até o dia 30. Teremos camisetas novas.', authorId: u.tatiane, createdAt: at(NOW, -3) },
      { title: 'Novo plano odontológico', body: 'A partir de novembro, todos os colaboradores CLT têm direito ao plano odontológico sem coparticipação. Detalhes com o RH.', authorId: u.rh, createdAt: at(NOW, -9) },
      { title: 'Treinamento de NR-11', body: 'Dia 22, das 8h às 12h, no auditório. Obrigatório para quem opera empilhadeira ou faz carga e descarga.', pinned: true, authorId: u.juliana, createdAt: at(NOW, -2) },
      { title: 'Café dos aniversariantes de outubro', body: 'Sexta, 9h30, no refeitório. Parabéns a todos os aniversariantes do mês!', authorId: u.bruna, createdAt: at(NOW, -1) },
      { title: 'Resultado do 3º trimestre', body: 'Batemos 104% da meta de faturamento no trimestre. Obrigado a cada um de vocês. A PLR será paga na folha de novembro.', authorId: u.ceo, createdAt: at(NOW, -14) },
    ],
  });
  const KUDOS_MSGS = ['Me ajudou demais na semana de fechamento.', 'Resolveu o problema do cliente em tempo recorde.', 'Ficou até mais tarde para garantir a entrega.', 'Sempre disponível para tirar dúvidas.', 'Organizou tudo com muito cuidado.', 'Atendimento impecável, o cliente elogiou.', 'Trouxe uma ideia que economizou horas do time.', 'Liderou a reunião com muita clareza.'];
  const kudosRows: Prisma.KudosCreateManyInput[] = [];
  for (let i = 0; i < 46; i++) {
    const from = pick(PEOPLE);
    const peers = PEOPLE.filter((x) => x.key !== from.key && (x.dept === from.dept || chance(0.3)));
    const weightedPeers = peers.flatMap((x) => (x.arch === 'star' ? [x, x, x] : x.arch === 'solid' ? [x, x] : [x]));
    const to = pick(weightedPeers.length ? weightedPeers : PEOPLE.filter((x) => x.key !== from.key));
    kudosRows.push({ fromId: u[from.key], toId: u[to.key], value: pick(KUDOS_VALUES), message: pick(KUDOS_MSGS), createdAt: at(NOW, -between(0, 55)) });
  }
  kudosRows.push({ fromId: u.gestor, toId: u.luiza, value: 'Dono do resultado', message: 'Fechou o maior contrato do trimestre. Parabéns!', createdAt: at(NOW, -1) });
  await prisma.kudos.createMany({ data: kudosRows });

  // ═════════ Chat ═════════
  const chatMsgs: Prisma.MessageCreateManyInput[] = [];
  const convLast: Record<string, Date> = {};
  const say = (conversationId: string, from: string | null, body: string, hoursAgo: number, replyToId?: string) => {
    const id = randomUUID();
    const createdAt = hoursFromNow(-hoursAgo);
    chatMsgs.push({ id, conversationId, senderId: from ? u[from] : null, type: from ? 'TEXT' : 'SYSTEM', body, createdAt, replyToId });
    if (!convLast[conversationId] || convLast[conversationId] < createdAt) convLast[conversationId] = createdAt;
    return id;
  };
  const group = async (name: string, members: string[], admin: string, description?: string) =>
    (await prisma.conversation.create({ data: { type: 'GROUP', name, description, createdById: u[admin], createdAt: at(NOW, -50), members: { create: members.map((k) => ({ userId: u[k], isAdmin: k === admin, joinedAt: at(NOW, -50) })) } } })).id;
  const direct = async (a: string, b: string) =>
    (await prisma.conversation.create({ data: { type: 'DIRECT', directKey: [u[a], u[b]].sort().join(':'), createdById: u[a], members: { create: [{ userId: u[a] }, { userId: u[b] }] } } })).id;

  const geral = await group('Geral Dumax', PEOPLE.map((p) => p.key), 'ceo', 'Avisos e papo geral da empresa');
  say(geral, null, 'Ricardo Almeida criou o grupo "Geral Dumax"', 1200);
  say(geral, 'ceo', 'Bom dia, pessoal! Hub novo no ar. Qualquer problema, falem com a Fernanda.', 960);
  say(geral, 'rh', 'Lembrando: o pulse sai toda sexta. Leva 10 segundos!', 950);
  say(geral, 'lucas', 'Ficou muito bom, o chat parece WhatsApp mesmo', 948);
  say(geral, 'juliana', 'Atenção: amanhã o portão 2 fica fechado para manutenção, usem o portão 1.', 70);
  say(geral, 'bruna', 'Café dos aniversariantes sexta às 9h30 no refeitório!', 22);
  const cafe = say(geral, 'kelly', 'Alguém sabe se vai ter bolo de cenoura?', 21.5);
  say(geral, 'monica', 'Vai sim, encomendei na padaria aqui do lado', 21, cafe);
  say(geral, 'ceo', 'Pessoal, batemos 104% da meta no trimestre. Obrigado a todos!', 4);
  say(geral, 'eduardo', 'Bora pra cima!', 3.8);

  const comercial = await group('Time Comercial', PEOPLE.filter((p) => p.dept === 'Comercial').map((p) => p.key), 'gestor');
  say(comercial, 'gestor', 'Pessoal, meta da semana: 40 reuniões agendadas.', 52);
  say(comercial, 'aline', 'Já tenho 12 confirmadas', 51);
  say(comercial, 'camila', 'Estou com 9, mais 3 hoje à tarde. Mas tô afogada nas propostas também', 50.5);
  say(comercial, 'gestor', 'Camila, me chama depois que eu redistribuo umas demandas', 50);
  say(comercial, 'luiza', 'Proposta da Horizonte sai amanhã cedo', 6);
  say(comercial, 'eduardo', 'A Coopavel pediu reunião na segunda, quem pode ir comigo?', 2.5);
  say(comercial, 'rodrigo', 'Eu vou', 2.2);
  say(comercial, 'gestor', 'Lembrem de atualizar o CRM antes da daily de amanhã', 0.6);

  const ops = await group('Operações — turno', PEOPLE.filter((p) => p.dept === 'Operações').map((p) => p.key), 'juliana');
  say(ops, 'juliana', 'Carga da Agro Oeste precisa sair até 14h hoje', 7);
  say(ops, 'rafael', 'Separação concluída, falta conferir', 6);
  say(ops, 'leandro', 'Conferido. Faltou 1 caixa do lote 42, já pedi reposição', 5.5);
  say(ops, 'thiago', 'Desculpa o atraso hoje, o ônibus quebrou', 3);
  say(ops, 'juliana', 'Ok, Thiago. Me procura no fim do dia pra gente conversar', 2.9);

  const techG = await group('Squad Plataforma', ['tech', 'ana', 'lucas', 'renan', 'paula', 'bianca', 'felipe'], 'tech');
  say(techG, 'tech', 'Deploy da versão 2.4 hoje às 18h', 30);
  say(techG, 'paula', 'Testes de regressão ok', 27);
  say(techG, 'renan', 'Migração do banco rodou sem erro', 26);
  say(techG, 'felipe', 'Pessoal, o painel de vendas vai atrasar, travei na consulta do ERP', 8);
  say(techG, 'ana', 'Felipe, te ajudo depois do almoço', 7.8);

  const gestores = await group('Gestores', ['ceo', 'helena', 'rh', 'gestor', 'tatiane', 'juliana', 'tech', 'fin'], 'ceo', 'Assuntos de gestão');
  say(gestores, 'helena', 'O AVCB venceu semana passada. Juliana, qual a previsão da vistoria?', 26);
  say(gestores, 'juliana', 'Bombeiros vêm terça. Já está tudo protocolado.', 25);
  say(gestores, 'fin', 'O e-CNPJ vence em 9 dias, já pedi a renovação', 20);
  say(gestores, 'rh', 'Gestores, por favor revisem os pontos contestados do time até sexta', 5);

  const dmGL = await direct('gestor', 'luiza');
  say(dmGL, 'gestor', 'Luiza, consegue me mandar a apresentação do Vértice até amanhã?', 9);
  say(dmGL, 'luiza', 'Consigo sim! Só estou esperando os números do financeiro.', 8.8);
  say(dmGL, 'gestor', 'Perfeito, vou cobrar a Patrícia.', 8.7);
  say(dmGL, 'gestor', 'Ela mandou agora. Dá uma olhada no e-mail', 0.4);
  const dmGP = await direct('gestor', 'pedro');
  say(dmGP, 'gestor', 'Pedro, os follow-ups da Show Rural estão atrasados. Precisa de ajuda?', 26);
  say(dmGP, 'pedro', 'Estou com dificuldade no CRM novo, perco muito tempo', 25);
  say(dmGP, 'gestor', 'Vamos fazer uma sessão juntos amanhã às 10h', 24.5);
  const dmRL = await direct('rh', 'luiza');
  say(dmRL, 'rh', 'Oi Luiza! Falta só a sua assinatura na política de home office', 30);
  say(dmRL, 'luiza', 'Vou assinar hoje!', 29);
  const dmCG = await direct('ceo', 'gestor');
  say(dmCG, 'ceo', 'Marcos, como estamos no funil do trimestre?', 50);
  say(dmCG, 'gestor', '82% da meta, com 3 propostas grandes para fechar', 49);
  const dmLC = await direct('luiza', 'camila');
  say(dmLC, 'camila', 'Lu, você tem o modelo de proposta atualizado?', 3);
  say(dmLC, 'luiza', 'Tenho! Te mando agora', 2.8);
  say(dmLC, 'camila', 'Valeu demais', 2.7);
  const dmAL = await direct('ana', 'lucas');
  say(dmAL, 'lucas', 'Ana, pode revisar meu PR?', 5);
  say(dmAL, 'ana', 'Revisei, deixei 2 comentários', 4);
  const dmRB = await direct('rh', 'bruna');
  say(dmRB, 'rh', 'Bruna, agenda as entrevistas da vaga de vendas pra quinta?', 28);
  say(dmRB, 'bruna', 'Agendado: 3 candidatos, a partir das 10h', 27);

  await prisma.message.createMany({ data: chatMsgs });
  for (const [id, at] of Object.entries(convLast)) await prisma.conversation.update({ where: { id }, data: { lastMessageAt: at } });
  // leitura: todo mundo leu até 5h atrás; demo users com algumas não lidas
  await prisma.conversationMember.updateMany({ data: { lastReadAt: hoursFromNow(-5) } });
  await prisma.conversationMember.updateMany({ where: { userId: { in: [u.gestor, u.rh, u.ceo] } }, data: { lastReadAt: hoursFromNow(-0.2) } });
  await prisma.conversationMember.updateMany({ where: { userId: u.gestor, conversationId: dmGP }, data: { lastReadAt: hoursFromNow(-30) } });
  await prisma.conversationMember.updateMany({ where: { userId: u.luiza, conversationId: techG }, data: { archived: true } });
  await prisma.conversationMember.updateMany({ where: { userId: u.luiza, conversationId: dmRL }, data: { pinned: true } });
  // reações
  const reactable = chatMsgs.filter((m) => m.type === 'TEXT' && chance(0.35));
  const reactions: Prisma.MessageReactionCreateManyInput[] = [];
  for (const m of reactable) {
    const members = await prisma.conversationMember.findMany({ where: { conversationId: m.conversationId }, select: { userId: true } });
    for (const mem of members.filter((x) => x.userId !== m.senderId).slice(0, int(1, 4))) reactions.push({ messageId: m.id!, userId: mem.userId, emoji: pick(['👍', '❤️', '😂', '👏', '🔥', '🙏']) });
  }
  await prisma.messageReaction.createMany({ data: reactions, skipDuplicates: true });

  // ═════════ Notificações ═════════
  const notes: Prisma.NotificationCreateManyInput[] = [
    { userId: u.luiza, type: 'kudos', title: 'Marcos Oliveira te elogiou', body: 'Dono do resultado: fechou o maior contrato do trimestre.', link: '/mural', createdAt: at(NOW, -1) },
    { userId: u.luiza, type: 'document.sign', title: 'Documento para assinar', body: 'Recibo de bonificação — 3º trimestre', link: '/documentos', createdAt: at(NOW, -2) },
    { userId: u.luiza, type: 'task.assigned', title: 'Nova demanda: Preparar apresentação para o Grupo Vértice', body: 'De Marcos Oliveira', link: '/demandas', createdAt: at(NOW, -3) },
    { userId: u.gestor, type: 'performance.alert', title: 'Pedro Santos: 4 demandas atrasadas', body: 'E 58% das horas trabalhadas sem atividade registrada nos últimos 30 dias.', link: `/admin/desempenho/${u.pedro}`, createdAt: hoursFromNow(-6) },
    { userId: u.gestor, type: 'document.sign', title: 'Documento para assinar', body: 'Contrato comercial — Construtora Horizonte', link: '/documentos', createdAt: at(NOW, -3), readAt: at(NOW, -3) },
    { userId: u.rh, type: 'assessment.completed', title: 'Novo teste de perfil concluído', body: 'Executivo(a) de Vendas B2B', link: '/admin/recrutamento', createdAt: hoursFromNow(-3) },
    { userId: u.rh, type: 'license.expiring', title: 'Licença sanitária do refeitório vence em 52 dias', body: 'Você é a responsável.', link: '/licencas', createdAt: at(NOW, -8), readAt: at(NOW, -7) },
    { userId: u.ceo, type: 'license.expired', title: 'AVCB — Corpo de Bombeiros venceu', body: 'Responsável: Juliana Ferreira', link: '/admin/licencas', createdAt: at(NOW, -6) },
    { userId: u.ceo, type: 'document.sign', title: 'Documento para assinar', body: 'NDA — fornecedor de embalagens', link: '/documentos', createdAt: at(NOW, -1) },
    { userId: u.helena, type: 'license.expiring', title: 'Alvará de funcionamento vence em 18 dias', body: 'Prefeitura de Cascavel', link: '/licencas', createdAt: at(NOW, -1) },
  ];
  await prisma.notification.createMany({ data: notes });

  // ═════════ Recrutamento: perguntas, avaliações e indicações ═════════
  console.log('  avaliações de entrevista e indicações…');
  await prisma.job.updateMany({ where: { status: 'OPEN' }, data: { scorecardCriteria: DEFAULT_SCORECARD_CRITERIA } });
  const salesJob = await prisma.job.findFirst({ where: { title: { startsWith: 'Executivo(a) de Vendas' } } });
  if (salesJob) {
    await prisma.job.update({
      where: { id: salesJob.id },
      data: {
        screeningQuestions: [
          { id: 'cnh', text: 'Possui CNH categoria B?', type: 'YES_NO', expected: 'YES', mode: 'ELIMINATE' },
          { id: 'carro', text: 'Possui veículo próprio para visitar clientes?', type: 'YES_NO', expected: 'YES', mode: 'ELIMINATE' },
          { id: 'exp', text: 'Quantos anos de experiência com vendas B2B?', type: 'NUMBER', min: 2, unit: 'anos', mode: 'ELIMINATE' },
          { id: 'salario', text: 'Qual sua pretensão salarial (fixo)?', type: 'NUMBER', max: 7500, unit: 'R$', mode: 'FLAG' },
        ],
        scorecardCriteria: ['Comunicação', 'Experiência em vendas B2B', 'Negociação', 'Organização da carteira', 'Alinhamento com a cultura'],
      },
    });
  }
  const interviewed = await prisma.application.findMany({ where: { stage: { in: ['INTERVIEW', 'OFFER', 'HIRED'] } }, include: { job: { select: { scorecardCriteria: true } } } });
  for (const a of interviewed) {
    const criteria = (a.job.scorecardCriteria as string[] | null) ?? DEFAULT_SCORECARD_CRITERIA;
    const strong = a.stage !== 'INTERVIEW' || chance(0.5);
    for (const author of [u.rh, ...(chance(0.6) ? [u.bruna] : [])]) {
      const ratings = criteria.map((name) => ({ name, rating: Math.max(1, Math.min(4, (strong ? 3 : 2) + int(-1, 1))) }));
      const avg = ratings.reduce((t, r) => t + r.rating, 0) / ratings.length;
      await prisma.interviewScorecard.create({
        data: {
          applicationId: a.id,
          authorId: author,
          ratings,
          recommendation: avg >= 3.4 ? 'STRONG_YES' : avg >= 2.6 ? 'YES' : avg >= 1.8 ? 'NO' : 'STRONG_NO',
          summary: pick(['Boa conversa, respondeu com exemplos concretos.', 'Mostrou interesse real pela vaga e pela empresa.', 'Faltou profundidade nas perguntas técnicas.', 'Comunicação clara, mas pouca experiência na função.']),
          createdAt: at(a.createdAt, 3),
        },
      });
    }
  }
  const referrable = await prisma.application.findMany({ where: { job: { status: 'OPEN' } }, orderBy: { createdAt: 'desc' }, take: 6 });
  const referrers = [u.luiza, u.luiza, u.rodrigo, u.ana, u.jessica, u.eduardo];
  for (const [i, a] of referrable.entries()) {
    await prisma.application.update({ where: { id: a.id }, data: { referredById: referrers[i], source: 'indicacao' } });
  }

  // ═════════ Comunicado de leitura obrigatória ═════════
  const nr = await prisma.announcement.findFirst({ where: { title: 'Treinamento de NR-11' } });
  if (nr) {
    await prisma.announcement.update({ where: { id: nr.id }, data: { requiresAck: true } });
    const readers = Object.entries(u).filter(([k]) => !['luiza', 'gestor', 'admin', 'ceo', 'rh'].includes(k) && chance(0.6));
    await prisma.announcementRead.createMany({ data: [...readers.map(([, id]) => id), u.juliana].map((userId) => ({ announcementId: nr.id, userId, readAt: at(NOW, -between(0.1, 1.8)) })), skipDuplicates: true });
  }

  const counts = {
    pessoas: PEOPLE.length,
    demandas: tasks.length,
    apontamentos: logs.length,
    batidas: await prisma.timeEntry.count(),
    candidatos: await prisma.candidate.count(),
    mensagens: chatMsgs.length,
    reunioes: await prisma.meeting.count(),
  };
  console.log(`
Pronto. ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(' · ')}

Acessos (senha dumax123):
  admin@dumax.com.br   Diretoria → portal admin
  rh@dumax.com.br      RH → portal admin
  gestor@dumax.com.br  Gerente Comercial → admin do time (Pedro e Camila com alertas)
  luiza@dumax.com.br   Colaboradora → portal colaborador
Os quatro ainda não responderam o pulse desta semana.
`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
