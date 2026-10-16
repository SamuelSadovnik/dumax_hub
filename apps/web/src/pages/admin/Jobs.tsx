import { useMemo, useState, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ExternalLink, Link2, MoreHorizontal, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import {
  EMPLOYMENT_TYPES,
  EMPLOYMENT_TYPE_LABEL,
  JOB_STATUSES,
  JOB_STATUS_LABEL,
  PROFILES,
  PROFILE_KEYS,
  PROFILE_PRESETS,
  STAGE_COLOR,
  WORK_MODES,
  WORK_MODE_LABEL,
  normalizeProfile,
  type EmploymentType,
  type JobStatus,
  type ProfileScores,
  type ScreeningQuestion,
  type ScreeningType,
  SCREENING_TYPE_LABEL,
  DEFAULT_SCORECARD_CRITERIA,
  type Stage,
  type WorkMode,
} from '@dumax/shared';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Department, Job } from '@/lib/types';
import { fromNow } from '@/lib/format';
import { Badge, Button, Checkbox, EmptyState, Field, Input, Menu, Modal, PageHeader, PageLoader, Select, Tabs, Textarea } from '@/components/ui';

export const JOB_STATUS_COLOR: Record<JobStatus, string> = { DRAFT: '#8A93AD', OPEN: '#1F9254', PAUSED: '#C77700', CLOSED: '#5B6382' };

/** Canais de divulgação — cada um gera um link próprio para medir de onde vêm os candidatos */
export const JOB_CHANNELS = [
  { key: 'linkedin', label: 'LinkedIn' },
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'instagram', label: 'Instagram' },
  { key: 'indeed', label: 'Indeed' },
  { key: 'indicacao', label: 'Indicação' },
] as const;
export const SOURCE_LABEL: Record<string, string> = { site: 'Site', banco: 'Banco de talentos', indicacao: 'Indicação', ...Object.fromEntries(JOB_CHANNELS.map((c) => [c.key, c.label])) };

export const publicJobUrl = (slug: string, origem?: string) => `${window.location.origin}/vagas/${slug}${origem ? `?origem=${origem}` : ''}`;

export async function copyJobLink(job: Pick<Job, 'slug' | 'title'>, origem?: string) {
  const url = publicJobUrl(job.slug, origem);
  if (origem === 'whatsapp') {
    window.open(`https://wa.me/?text=${encodeURIComponent(`Estamos contratando: *${job.title}*\nVeja a vaga e candidate-se: ${url}`)}`, '_blank');
    return;
  }
  await navigator.clipboard.writeText(url);
  toast.success(`Link ${origem ? `para ${SOURCE_LABEL[origem]} ` : ''}copiado`);
}

/** Barra empilhada do perfil (usada também na análise do candidato) */
export function ProfileBar({ profile, height = 8 }: { profile: ProfileScores; height?: number }) {
  return (
    <div className="flex overflow-hidden rounded-full bg-ink-100" style={{ height }}>
      {PROFILE_KEYS.map((k) => (profile[k] ? <div key={k} title={`${PROFILES[k].label} ${profile[k]}%`} style={{ width: `${profile[k]}%`, background: PROFILES[k].color }} /> : null))}
    </div>
  );
}

function IdealProfileEditor({ value, onChange }: { value: ProfileScores | null; onChange: (v: ProfileScores | null) => void }) {
  const total = value ? PROFILE_KEYS.reduce((a, k) => a + value[k], 0) : 0;
  if (!value)
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-ink-300 p-3">
        <span className="mr-1 text-sm text-ink-600">Sem perfil ideal. Comece por um modelo:</span>
        {PROFILE_PRESETS.map((p) => (
          <Button key={p.label} size="sm" variant="secondary" onClick={() => onChange(p.profile)}>
            {p.label}
          </Button>
        ))}
      </div>
    );
  return (
    <div className="rounded-lg border border-ink-200 p-4">
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs text-ink-500">Modelos:</span>
        {PROFILE_PRESETS.map((p) => (
          <button key={p.label} onClick={() => onChange(p.profile)} className="rounded-md border border-ink-200 px-2 py-0.5 text-xs hover:border-brand-300 hover:text-brand-700">
            {p.label}
          </button>
        ))}
        <button onClick={() => onChange(null)} className="ml-auto text-xs text-ink-500 hover:text-bad">
          Remover
        </button>
      </div>
      <div className="space-y-2.5">
        {PROFILE_KEYS.map((k) => (
          <div key={k} className="grid grid-cols-[110px_1fr_44px] items-center gap-3 text-sm">
            <span className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full" style={{ background: PROFILES[k].color }} />
              {PROFILES[k].label}
            </span>
            <input type="range" min={0} max={100} step={5} value={value[k]} onChange={(e) => onChange({ ...value, [k]: Number(e.target.value) })} style={{ accentColor: PROFILES[k].color }} />
            <span className="num text-right text-ink-600">{total ? Math.round((value[k] / total) * 100) : 0}%</span>
          </div>
        ))}
      </div>
      <div className="mt-3">
        <ProfileBar profile={normalizeProfile(value)} />
        <p className="mt-1.5 text-xs text-ink-500">Os pesos são convertidos em percentual. Candidatos e o time são comparados com essa distribuição.</p>
      </div>
    </div>
  );
}

/** Sugestões comuns de perguntas eliminatórias */
const SUGGESTED_QUESTIONS: ScreeningQuestion[] = [
  { id: '', text: 'Possui CNH categoria B?', type: 'YES_NO', expected: 'YES', mode: 'ELIMINATE' },
  { id: '', text: 'Possui veículo próprio para trabalhar?', type: 'YES_NO', expected: 'YES', mode: 'ELIMINATE' },
  { id: '', text: 'Qual sua pretensão salarial?', type: 'NUMBER', max: 5000, unit: 'R$', mode: 'FLAG' },
  { id: '', text: 'Quantos anos de experiência na função?', type: 'NUMBER', min: 2, unit: 'anos', mode: 'ELIMINATE' },
  { id: '', text: 'Qual sua escolaridade?', type: 'CHOICE', options: ['Fundamental', 'Médio', 'Técnico', 'Superior'], accepted: ['Médio', 'Técnico', 'Superior'], mode: 'ELIMINATE' },
  { id: '', text: 'Tem disponibilidade para viajar?', type: 'YES_NO', expected: 'YES', mode: 'FLAG' },
];
const newId = () => Math.random().toString(36).slice(2, 10);

function QuestionRow({ q, onChange, onRemove }: { q: ScreeningQuestion; onChange: (patch: Partial<ScreeningQuestion>) => void; onRemove: () => void }) {
  const type = q.type ?? 'YES_NO';
  const [opt, setOpt] = useState('');
  const options = q.options ?? [];
  const accepted = q.accepted ?? [];
  const addOption = () => {
    const v = opt.trim();
    if (!v || options.includes(v)) return;
    onChange({ options: [...options, v], accepted: [...accepted, v] });
    setOpt('');
  };
  const num = (v: string) => (v === '' ? null : Number(v));
  return (
    <li className="space-y-2.5 rounded-xl border border-ink-200 bg-white p-3">
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_170px_auto]">
        <Input value={q.text} placeholder="Ex.: Possui CNH categoria B?" onChange={(e) => onChange({ text: e.target.value })} aria-label="Pergunta" />
        <Select
          value={type}
          onChange={(e) => {
            const t = e.target.value as ScreeningType;
            onChange(t === 'CHOICE' && !options.length ? { type: t, options: ['Opção 1', 'Opção 2'], accepted: ['Opção 1'] } : { type: t });
          }}
          aria-label="Tipo de resposta"
        >
          {(['YES_NO', 'CHOICE', 'NUMBER'] as const).map((t) => (
            <option key={t} value={t}>
              {SCREENING_TYPE_LABEL[t]}
            </option>
          ))}
        </Select>
        <button onClick={onRemove} className="justify-self-end rounded-lg p-2 text-ink-400 hover:bg-ink-50 hover:text-bad" aria-label="Remover pergunta">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        {type === 'YES_NO' && (
          <Select value={q.expected ?? 'YES'} onChange={(e) => onChange({ expected: e.target.value as 'YES' | 'NO' })} className="w-44" aria-label="Resposta exigida">
            <option value="YES">Exige “Sim”</option>
            <option value="NO">Exige “Não”</option>
          </Select>
        )}
        {type === 'NUMBER' && (
          <>
            <span className="text-ink-500">Aceita de</span>
            <Input type="number" className="w-28" value={q.min ?? ''} placeholder="sem mínimo" onChange={(e) => onChange({ min: num(e.target.value) })} aria-label="Mínimo" />
            <span className="text-ink-500">até</span>
            <Input type="number" className="w-28" value={q.max ?? ''} placeholder="sem máximo" onChange={(e) => onChange({ max: num(e.target.value) })} aria-label="Máximo" />
            <Input className="w-24" value={q.unit ?? ''} placeholder="unidade" onChange={(e) => onChange({ unit: e.target.value })} aria-label="Unidade, ex.: anos ou R$" />
          </>
        )}
        {type === 'CHOICE' && (
          <div className="w-full space-y-2">
            <p className="text-xs text-ink-500">Clique nas opções que passam (verdes).</p>
            <div className="flex flex-wrap items-center gap-1.5">
              {options.map((o) => {
                const ok = accepted.includes(o);
                return (
                  <span key={o} className={clsx('inline-flex items-center gap-1 rounded-full border py-0.5 pl-2.5 pr-1 text-xs font-medium', ok ? 'border-ok/40 bg-ok-soft text-ok' : 'border-ink-200 bg-ink-50 text-ink-500')}>
                    <button type="button" onClick={() => onChange({ accepted: ok ? accepted.filter((a) => a !== o) : [...accepted, o] })}>
                      {ok ? '✓ ' : ''}
                      {o}
                    </button>
                    <button type="button" className="rounded-full p-0.5 hover:bg-white/70" onClick={() => onChange({ options: options.filter((x) => x !== o), accepted: accepted.filter((x) => x !== o) })} aria-label={`Remover ${o}`}>
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                );
              })}
              <Input className="h-7 w-40 text-xs" value={opt} placeholder="Nova opção e Enter" onChange={(e) => setOpt(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addOption())} />
            </div>
          </div>
        )}
        <Select value={q.mode} onChange={(e) => onChange({ mode: e.target.value as 'ELIMINATE' | 'FLAG' })} className="ml-auto w-52" aria-label="Se não atender">
          <option value="ELIMINATE">Descartar se não atender</option>
          <option value="FLAG">Só sinalizar para o RH</option>
        </Select>
      </div>
    </li>
  );
}

/** Perguntas da candidatura: descartam na hora ou só sinalizam para o RH */
function ScreeningEditor({ value, onChange }: { value: ScreeningQuestion[]; onChange: (v: ScreeningQuestion[]) => void }) {
  const add = (q?: ScreeningQuestion) => onChange([...value, { type: 'YES_NO', expected: 'YES', mode: 'ELIMINATE', text: '', ...(q ?? {}), id: newId() }]);
  const update = (i: number, patch: Partial<ScreeningQuestion>) => onChange(value.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  const unused = SUGGESTED_QUESTIONS.filter((s) => !value.some((q) => q.text.trim().toLowerCase() === s.text.toLowerCase()));
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div className="max-w-xl">
          <p className="text-sm font-semibold text-ink-900">Perguntas eliminatórias</p>
          <p className="text-xs text-ink-500">Sim ou não, múltipla escolha ou número (pretensão salarial, anos de experiência). Quem não atende a uma pergunta eliminatória é descartado na hora, com o motivo na ficha.</p>
        </div>
        <Button size="sm" variant="secondary" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => add()}>
          Adicionar pergunta
        </Button>
      </div>
      {value.length > 0 && (
        <ul className="space-y-2">
          {value.map((q, i) => (
            <QuestionRow key={q.id} q={q} onChange={(patch) => update(i, patch)} onRemove={() => onChange(value.filter((_, j) => j !== i))} />
          ))}
        </ul>
      )}
      {unused.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-ink-500">Sugestões:</span>
          {unused.map((s) => (
            <button key={s.text} onClick={() => add(s)} className="rounded-full border border-dashed border-ink-300 px-2.5 py-1 text-xs text-ink-600 hover:border-brand-400 hover:text-brand-700">
              + {s.text}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Critérios que cada entrevistador avalia de 1 a 4 */
function CriteriaEditor({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = useState('');
  const add = () => {
    const v = text.trim();
    if (v.length < 2 || value.includes(v)) return;
    onChange([...value, v]);
    setText('');
  };
  return (
    <div>
      <p className="text-sm font-semibold text-ink-900">Avaliação de entrevista</p>
      <p className="mb-2.5 text-xs text-ink-500">Todo entrevistador avalia os mesmos critérios, de 1 a 4, e dá uma recomendação final.</p>
      <div className="flex flex-wrap items-center gap-1.5">
        {value.map((c) => (
          <span key={c} className="inline-flex items-center gap-1 rounded-full bg-ink-100 py-0.5 pl-2.5 pr-1 text-xs font-medium text-ink-700">
            {c}
            <button type="button" className="rounded-full p-0.5 hover:bg-white" onClick={() => onChange(value.filter((x) => x !== c))} aria-label={`Remover ${c}`}>
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <Input className="h-7 w-48 text-xs" value={text} placeholder="Novo critério e Enter" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())} />
      </div>
    </div>
  );
}

export function JobFormModal({ job, onClose }: { job: Job | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: depts = [] } = useQuery({ queryKey: ['departments'], queryFn: () => api.get<Department[]>('/org/departments') });
  const [f, setF] = useState({
    title: job?.title ?? '',
    summary: job?.summary ?? '',
    description: job?.description ?? '',
    requirements: job?.requirements ?? '',
    benefits: job?.benefits ?? '',
    location: job?.location ?? 'Cascavel - PR',
    workMode: job?.workMode ?? ('ONSITE' as WorkMode),
    employmentType: job?.employmentType ?? ('CLT' as EmploymentType),
    salaryMin: job?.salaryMin?.toString() ?? '',
    salaryMax: job?.salaryMax?.toString() ?? '',
    showSalary: job?.showSalary ?? false,
    openings: job?.openings ?? 1,
    status: job?.status ?? ('OPEN' as JobStatus),
    autoSendAssessment: job?.autoSendAssessment ?? true,
    departmentId: job?.departmentId ?? '',
  });
  const [ideal, setIdeal] = useState<ProfileScores | null>(job?.idealProfile ?? null);
  const [questions, setQuestions] = useState<ScreeningQuestion[]>(job?.screeningQuestions ?? []);
  const [criteria, setCriteria] = useState<string[]>(job?.scorecardCriteria ?? DEFAULT_SCORECARD_CRITERIA);
  const [tried, setTried] = useState(false);

  const errors = {
    title: f.title.trim().length < 3 ? 'Dê um título com pelo menos 3 letras' : null,
    description: f.description.trim().length < 3 ? 'Descreva a vaga: o que a pessoa vai fazer' : null,
    salary: f.salaryMin && f.salaryMax && Number(f.salaryMax) < Number(f.salaryMin) ? 'O máximo precisa ser maior que o mínimo' : null,
  };
  const invalid = Object.values(errors).some(Boolean);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...f,
        title: f.title.trim(),
        summary: f.summary || null,
        requirements: f.requirements || null,
        benefits: f.benefits || null,
        location: f.location || null,
        salaryMin: f.salaryMin ? Number(f.salaryMin) : null,
        salaryMax: f.salaryMax ? Number(f.salaryMax) : null,
        departmentId: f.departmentId || null,
        openings: Number(f.openings) || 1,
        idealProfile: ideal,
        screeningQuestions: questions.filter((q) => q.text.trim().length >= 3).map((q) => ({ ...q, text: q.text.trim() })),
        scorecardCriteria: criteria,
      };
      return job ? api.patch<Job>(`/jobs/${job.id}`, body) : api.post<Job>('/jobs', body);
    },
    onSuccess: (j) => {
      if (!job && j.status === 'OPEN') {
        void navigator.clipboard?.writeText(publicJobUrl(j.slug));
        toast.success('Vaga publicada. O link já está copiado.');
      } else toast.success(job ? 'Vaga atualizada' : 'Vaga salva');
      qc.invalidateQueries({ queryKey: ['jobs'] });
      qc.invalidateQueries({ queryKey: ['job', j.id] });
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const set = (k: keyof typeof f) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const submit = () => {
    setTried(true);
    if (!invalid) save.mutate();
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={job ? `Editar ${job.title}` : 'Nova vaga'}
      footer={
        <>
          {tried && invalid && <span className="mr-auto text-sm text-bad">Corrija os campos marcados</span>}
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={save.isPending} onClick={submit}>
            {f.status === 'OPEN' && job?.status !== 'OPEN' ? 'Publicar vaga' : 'Salvar'}
          </Button>
        </>
      }
    >
      <div className="grid gap-x-6 gap-y-4 lg:grid-cols-2">
        <div className="space-y-4">
          <Field label="Título da vaga" required error={tried ? errors.title : null}>
            <Input autoFocus value={f.title} invalid={tried && !!errors.title} onChange={set('title')} placeholder="Ex.: Analista Comercial Pleno" />
          </Field>
          <Field label="Resumo" hint="Uma linha que aparece na lista de vagas">
            <Input value={f.summary} onChange={set('summary')} maxLength={300} />
          </Field>
          <Field label="Descrição" required error={tried ? errors.description : null}>
            <Textarea rows={6} value={f.description} invalid={tried && !!errors.description} onChange={set('description')} placeholder="O que a pessoa vai fazer no dia a dia, com quem trabalha, o que esperamos nos primeiros meses" />
          </Field>
          <Field label="Requisitos">
            <Textarea rows={4} value={f.requirements} onChange={set('requirements')} placeholder={'- 2 anos de experiência\n- Excel avançado'} />
          </Field>
          <Field label="Benefícios">
            <Textarea rows={3} value={f.benefits} onChange={set('benefits')} />
          </Field>
        </div>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Situação">
              <Select value={f.status} onChange={set('status')}>
                {JOB_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {JOB_STATUS_LABEL[s]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Área">
              <Select value={f.departmentId} onChange={set('departmentId')}>
                <option value="">Sem área</option>
                {depts.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Local">
              <Input value={f.location} onChange={set('location')} />
            </Field>
            <Field label="Modelo">
              <Select value={f.workMode} onChange={set('workMode')}>
                {WORK_MODES.map((m) => (
                  <option key={m} value={m}>
                    {WORK_MODE_LABEL[m]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Contratação">
              <Select value={f.employmentType} onChange={set('employmentType')}>
                {EMPLOYMENT_TYPES.map((m) => (
                  <option key={m} value={m}>
                    {EMPLOYMENT_TYPE_LABEL[m]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Posições">
              <Input type="number" min={1} value={f.openings} onChange={(e) => setF({ ...f, openings: Number(e.target.value) })} />
            </Field>
            <Field label="Salário mínimo (R$)" error={tried ? errors.salary : null}>
              <Input type="number" value={f.salaryMin} onChange={set('salaryMin')} />
            </Field>
            <Field label="Salário máximo (R$)">
              <Input type="number" value={f.salaryMax} onChange={set('salaryMax')} />
            </Field>
          </div>
          <div className="space-y-2">
            <Checkbox checked={f.showSalary} onChange={(v) => setF({ ...f, showSalary: v })} label="Mostrar a faixa salarial no portal de vagas" />
            <Checkbox checked={f.autoSendAssessment} onChange={(v) => setF({ ...f, autoSendAssessment: v })} label="Enviar o teste de perfil logo após a candidatura" />
          </div>
          <Field label="Perfil comportamental ideal" hint="Usado para calcular a aderência de cada candidato">
            <IdealProfileEditor value={ideal} onChange={setIdeal} />
          </Field>
        </div>
      </div>
      <div className="mt-6 border-t border-ink-100 pt-5">
        <ScreeningEditor value={questions} onChange={setQuestions} />
      </div>
      <div className="mt-6 border-t border-ink-100 pt-5">
        <CriteriaEditor value={criteria} onChange={setCriteria} />
      </div>
    </Modal>
  );
}

/** Botão "Divulgar" com um link por canal */
export function ShareJobMenu({ job, size = 'sm' }: { job: Pick<Job, 'slug' | 'title' | 'status'>; size?: 'sm' | 'md' }) {
  if (job.status !== 'OPEN') return null;
  return (
    <Menu
      header={<span className="text-xs text-ink-500">Cada canal tem seu link, para saber de onde vêm os candidatos</span>}
      trigger={() => (
        <Button size={size} variant="secondary" icon={<Link2 className="h-3.5 w-3.5" />}>
          Divulgar
        </Button>
      )}
      items={[
        { label: 'Copiar link geral', onClick: () => copyJobLink(job) },
        ...JOB_CHANNELS.map((c) => ({ label: c.key === 'whatsapp' ? 'Enviar no WhatsApp' : `Link para ${c.label}`, onClick: () => copyJobLink(job, c.key) })),
        { label: 'Abrir no portal', icon: <ExternalLink className="h-4 w-4" />, onClick: () => window.open(publicJobUrl(job.slug), '_blank') },
      ]}
    />
  );
}

type StatusFilter = 'active' | JobStatus | 'all';

export default function Jobs() {
  const { isHR } = useAuth();
  const navigate = useNavigate();
  const { data: jobs, isLoading } = useQuery({ queryKey: ['jobs'], queryFn: () => api.get<Job[]>('/jobs') });
  const [editing, setEditing] = useState<Job | null | undefined>(undefined);
  const [status, setStatus] = useState<StatusFilter>('active');
  const [focus, setFocus] = useState<Stage | null>(null);
  const [q, setQ] = useState('');

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: jobs?.length ?? 0, active: 0 };
    jobs?.forEach((j) => {
      c[j.status] = (c[j.status] ?? 0) + 1;
      if (j.status === 'OPEN' || j.status === 'PAUSED') c.active++;
    });
    return c;
  }, [jobs]);

  // O que pede ação agora, somando todas as vagas em andamento
  const attention = useMemo(() => {
    const live = (jobs ?? []).filter((j) => j.status === 'OPEN' || j.status === 'PAUSED');
    const sum = (s: Stage) => live.reduce((a, j) => a + (j.byStage?.[s] ?? 0), 0);
    return [
      { stage: 'SCREENING' as Stage, value: sum('SCREENING'), label: 'para triar', hint: 'Fizeram o teste e esperam sua decisão' },
      { stage: 'ASSESSMENT' as Stage, value: sum('ASSESSMENT'), label: 'fazendo o teste', hint: 'Recebem lembrete automático em 2 dias' },
      { stage: 'INTERVIEW' as Stage, value: sum('INTERVIEW'), label: 'em entrevista', hint: 'Registre o retorno de cada entrevista' },
      { stage: 'OFFER' as Stage, value: sum('OFFER'), label: 'com proposta', hint: 'Aguardando resposta do candidato' },
    ];
  }, [jobs]);

  const rows = (jobs ?? []).filter(
    (j) =>
      (status === 'all' || (status === 'active' ? j.status === 'OPEN' || j.status === 'PAUSED' : j.status === status)) &&
      (!focus || (j.byStage?.[focus] ?? 0) > 0) &&
      `${j.title} ${j.department?.name ?? ''}`.toLowerCase().includes(q.toLowerCase()),
  );
  const openJobs = (jobs ?? []).filter((j) => j.status === 'OPEN');
  const positions = openJobs.reduce((a, j) => a + j.openings, 0);

  if (isLoading) return <PageLoader />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Vagas"
        subtitle={`${openJobs.length} ${openJobs.length === 1 ? 'vaga aberta' : 'vagas abertas'}, ${positions} ${positions === 1 ? 'posição' : 'posições'} para preencher`}
        actions={
          <>
            <a href="/vagas" target="_blank" rel="noreferrer">
              <Button variant="secondary" icon={<ExternalLink className="h-4 w-4" />}>
                Ver portal
              </Button>
            </a>
            {isHR && (
              <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing(null)}>
                Nova vaga
              </Button>
            )}
          </>
        }
      />

      <section>
        <h2 className="mb-2.5 text-sm font-semibold text-ink-700">Para agir agora</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {attention.map((a) => {
            const on = focus === a.stage;
            return (
              <button
                key={a.stage}
                onClick={() => setFocus(on ? null : a.stage)}
                disabled={!a.value && !on}
                aria-pressed={on}
                className={clsx(
                  'card group flex items-center gap-3.5 px-4 py-3.5 text-left transition',
                  on ? 'border-brand-400 ring-4 ring-brand-500/10' : a.value ? 'hover:border-ink-300 hover:shadow-lift' : 'opacity-60',
                )}
              >
                <span className="h-9 w-1 shrink-0 rounded-full" style={{ background: STAGE_COLOR[a.stage] }} />
                <span className="min-w-0">
                  <span className="flex items-baseline gap-1.5">
                    <span className="num font-display text-[26px] font-bold leading-none text-ink-900">{a.value}</span>
                    <span className="text-sm font-medium text-ink-700">{a.label}</span>
                  </span>
                  <span className="mt-1 block truncate text-xs text-ink-500">{a.hint}</span>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <Tabs
            size="sm"
            value={status}
            onChange={setStatus}
            items={[
              { value: 'active', label: 'Em andamento', count: counts.active },
              { value: 'DRAFT', label: 'Rascunhos', count: counts.DRAFT ?? 0 },
              { value: 'CLOSED', label: 'Encerradas', count: counts.CLOSED ?? 0 },
            ]}
          />
          {focus && (
            <button onClick={() => setFocus(null)} className="inline-flex h-7 items-center gap-1.5 rounded-full bg-brand-50 px-3 text-xs font-medium text-brand-700 hover:bg-brand-100">
              Só vagas com candidatos {attention.find((a) => a.stage === focus)?.label}
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <div className="relative ml-auto">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar vaga ou área" className="h-9 w-60 pl-8" />
          </div>
        </div>

        {rows.length ? (
          <ul className="card divide-y divide-ink-100 overflow-hidden">
            {rows.map((j) => {
              const total = j.applicationsTotal ?? 0;
              const toScreen = j.byStage?.SCREENING ?? 0;
              return (
                <li key={j.id}>
                  <div
                    role="link"
                    tabIndex={0}
                    onClick={() => navigate(`/admin/recrutamento/vagas/${j.id}`)}
                    onKeyDown={(e) => e.key === 'Enter' && navigate(`/admin/recrutamento/vagas/${j.id}`)}
                    className="group relative flex cursor-pointer items-center gap-4 px-5 py-4 transition-colors hover:bg-ink-50/70"
                  >
                    <span className="absolute inset-y-3 left-0 w-1 rounded-r-full" style={{ background: j.department?.color ?? '#C5CAD6' }} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-[15px] font-semibold text-ink-900 group-hover:text-brand-700">{j.title}</p>
                        {j.status !== 'OPEN' && (
                          <Badge color={JOB_STATUS_COLOR[j.status]} dot>
                            {JOB_STATUS_LABEL[j.status]}
                          </Badge>
                        )}
                      </div>
                      <p className="mt-0.5 truncate text-[13px] text-ink-500">
                        {[j.department?.name, WORK_MODE_LABEL[j.workMode], j.openings > 1 ? `${j.openings} posições` : null].filter(Boolean).join(' · ')}
                        <span className="text-ink-400"> · aberta {fromNow(j.publishedAt ?? j.createdAt)}</span>
                      </p>
                    </div>
                    <div className="hidden w-32 shrink-0 sm:block">
                      {toScreen > 0 ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700">
                          <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />
                          {toScreen} para triar
                        </span>
                      ) : (
                        <span className="text-xs text-ink-400">Nada pendente</span>
                      )}
                    </div>
                    <div className="w-28 shrink-0 text-right">
                      <p className="num font-display text-xl font-bold leading-none text-ink-900">{total}</p>
                      <p className="mt-1 text-xs text-ink-500">{j.lastWeek ? <span className="font-medium text-ok">+{j.lastWeek} esta semana</span> : total === 1 ? 'candidato' : 'candidatos'}</p>
                    </div>
                    <div className="flex w-[120px] shrink-0 items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                      <ShareJobMenu job={j} />
                      {isHR && (
                        <Menu
                          trigger={() => (
                            <Button size="icon-sm" variant="ghost" aria-label="Mais ações">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          )}
                          items={[
                            { label: 'Editar vaga', icon: <Pencil className="h-4 w-4" />, onClick: () => setEditing(j) },
                            { label: 'Ver no portal', icon: <ExternalLink className="h-4 w-4" />, onClick: () => window.open(publicJobUrl(j.slug), '_blank'), hidden: j.status !== 'OPEN' },
                          ]}
                        />
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="card">
            <EmptyState
              compact
              title={jobs?.length ? 'Nenhuma vaga com esse filtro' : 'Nenhuma vaga ainda'}
              text={jobs?.length ? undefined : 'Crie uma vaga, publique e divulgue o link em cada canal.'}
              action={
                isHR && !jobs?.length ? (
                  <Button onClick={() => setEditing(null)} icon={<Plus className="h-4 w-4" />}>
                    Criar vaga
                  </Button>
                ) : undefined
              }
            />
          </div>
        )}
      </section>
      {editing !== undefined && <JobFormModal job={editing} onClose={() => setEditing(undefined)} />}
    </div>
  );
}
