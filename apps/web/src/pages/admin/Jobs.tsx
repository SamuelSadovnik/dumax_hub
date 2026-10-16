import { useMemo, useState, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ExternalLink, Link2, MoreHorizontal, Pencil, Plus, Search } from 'lucide-react';
import {
  EMPLOYMENT_TYPES,
  EMPLOYMENT_TYPE_LABEL,
  JOB_STATUSES,
  JOB_STATUS_LABEL,
  PROFILES,
  PROFILE_KEYS,
  PROFILE_PRESETS,
  STAGE_COLOR,
  STAGE_LABEL,
  WORK_MODES,
  WORK_MODE_LABEL,
  ACTIVE_STAGES,
  normalizeProfile,
  type EmploymentType,
  type JobStatus,
  type ProfileScores,
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
export const SOURCE_LABEL: Record<string, string> = { site: 'Site', ...Object.fromEntries(JOB_CHANNELS.map((c) => [c.key, c.label])) };

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
  const [q, setQ] = useState('');

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: jobs?.length ?? 0, active: 0 };
    jobs?.forEach((j) => {
      c[j.status] = (c[j.status] ?? 0) + 1;
      if (j.status === 'OPEN' || j.status === 'PAUSED') c.active++;
    });
    return c;
  }, [jobs]);
  const rows = (jobs ?? []).filter(
    (j) => (status === 'all' || (status === 'active' ? j.status === 'OPEN' || j.status === 'PAUSED' : j.status === status)) && `${j.title} ${j.department?.name ?? ''}`.toLowerCase().includes(q.toLowerCase()),
  );
  const totals = useMemo(() => {
    const open = (jobs ?? []).filter((j) => j.status === 'OPEN');
    return {
      open: open.length,
      positions: open.reduce((a, j) => a + j.openings, 0),
      inProcess: open.reduce((a, j) => a + ACTIVE_STAGES.reduce((s, st) => s + (j.byStage?.[st] ?? 0), 0), 0),
      lastWeek: (jobs ?? []).reduce((a, j) => a + (j.lastWeek ?? 0), 0),
    };
  }, [jobs]);

  if (isLoading) return <PageLoader />;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Vagas"
        subtitle={
          <>
            Portal público:{' '}
            <a href="/vagas" target="_blank" rel="noreferrer" className="text-brand-600 hover:underline">
              {window.location.host}/vagas
            </a>
          </>
        }
        actions={
          isHR && (
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing(null)}>
              Nova vaga
            </Button>
          )
        }
      />

      <div className="grid grid-cols-2 overflow-hidden rounded-lg border border-ink-200 bg-white sm:grid-cols-4">
        {[
          ['Vagas abertas', totals.open],
          ['Posições a preencher', totals.positions],
          ['Candidatos em processo', totals.inProcess],
          ['Candidaturas em 7 dias', totals.lastWeek],
        ].map(([l, v]) => (
          <div key={l} className="border-b border-r border-ink-100 px-5 py-4 sm:border-b-0">
            <p className="text-[13px] text-ink-500">{l}</p>
            <p className="num mt-1 text-2xl font-semibold">{v}</p>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="flex flex-wrap items-center gap-3 border-b border-ink-100 px-4 py-2.5">
          <Tabs
            size="sm"
            value={status}
            onChange={setStatus}
            items={[
              { value: 'active', label: 'Em andamento', count: counts.active },
              { value: 'DRAFT', label: 'Rascunhos', count: counts.DRAFT ?? 0 },
              { value: 'CLOSED', label: 'Encerradas', count: counts.CLOSED ?? 0 },
              { value: 'all', label: 'Todas', count: counts.all },
            ]}
          />
          <div className="relative ml-auto">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar vaga" className="h-8 w-56 pl-8" />
          </div>
        </div>
        {rows.length ? (
          <table className="tbl">
            <thead>
              <tr>
                <th>Vaga</th>
                <th>Situação</th>
                <th className="w-[26%]">Funil</th>
                <th className="text-right">Candidatos</th>
                <th>Origem</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((j) => {
                const total = j.applicationsTotal ?? 0;
                const sources = Object.entries(j.bySource ?? {}).sort((a, b) => b[1] - a[1]);
                return (
                  <tr key={j.id} className="cursor-pointer" onClick={() => navigate(`/admin/recrutamento/vagas/${j.id}`)}>
                    <td>
                      <span className="block font-medium">{j.title}</span>
                      <span className="block text-xs text-ink-500">
                        {[j.department?.name, WORK_MODE_LABEL[j.workMode], EMPLOYMENT_TYPE_LABEL[j.employmentType], j.openings > 1 && `${j.openings} posições`].filter(Boolean).join(' · ')}
                      </span>
                    </td>
                    <td>
                      <Badge color={JOB_STATUS_COLOR[j.status]} dot>
                        {JOB_STATUS_LABEL[j.status]}
                      </Badge>
                      <span className="mt-0.5 block text-2xs text-ink-400">{fromNow(j.publishedAt ?? j.createdAt)}</span>
                    </td>
                    <td>
                      <div className="flex h-1.5 overflow-hidden rounded-full bg-ink-100">
                        {ACTIVE_STAGES.concat('HIRED').map((s) => {
                          const v = j.byStage?.[s] ?? 0;
                          return v ? <div key={s} style={{ width: `${(v / (total || 1)) * 100}%`, background: STAGE_COLOR[s] }} title={`${STAGE_LABEL[s]}: ${v}`} /> : null;
                        })}
                      </div>
                      <span className="num mt-1 block text-2xs text-ink-500">
                        {(j.byStage?.INTERVIEW ?? 0) > 0 && `${j.byStage?.INTERVIEW} em entrevista · `}
                        {(j.byStage?.HIRED ?? 0) > 0 ? `${j.byStage?.HIRED} contratado(s)` : `${j.byStage?.APPLIED ?? 0} novos`}
                      </span>
                    </td>
                    <td className="num text-right">
                      <span className="font-medium">{total}</span>
                      {!!j.lastWeek && <span className="block text-2xs text-ok">+{j.lastWeek} na semana</span>}
                    </td>
                    <td className="text-xs text-ink-600">
                      {sources.length
                        ? sources.slice(0, 3).map(([k, v]) => (
                            <span key={k} className="mr-2 whitespace-nowrap">
                              {SOURCE_LABEL[k] ?? k} <span className="num text-ink-400">{v}</span>
                            </span>
                          ))
                        : '—'}
                    </td>
                    <td className="w-40" onClick={(e) => e.stopPropagation()}>
                      <span className="flex items-center justify-end gap-1">
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
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
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
        )}
      </div>
      {editing !== undefined && <JobFormModal job={editing} onClose={() => setEditing(undefined)} />}
    </div>
  );
}
