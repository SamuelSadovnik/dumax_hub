import { useDeferredValue, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { toast } from 'sonner';
import { ArrowLeft, Library, MapPin, Search, UserPlus } from 'lucide-react';
import { PROFILES, PROFILE_KEYS, STAGE_COLOR, STAGE_LABEL, type ProfileKey, type Stage } from '@dumax/shared';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Job } from '@/lib/types';
import { fromNow } from '@/lib/format';
import { Avatar, Button, EmptyState, Field, Input, Modal, PageHeader, PageLoader, Select, Stars, Tabs, Textarea } from '@/components/ui';

interface PoolCandidate {
  id: string;
  name: string;
  email: string;
  city: string | null;
  profile: ProfileKey | null;
  rating: number | null;
  hired: boolean;
  lastAppliedAt: string;
  applications: { id: string; stage: Stage; rating: number | null; createdAt: string; job: { id: string; title: string } }[];
}

function InviteModal({ c, onClose }: { c: PoolCandidate; onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: jobs } = useQuery({ queryKey: ['jobs'], queryFn: () => api.get<Job[]>('/jobs') });
  const taken = new Set(c.applications.map((a) => a.job.id));
  const open = (jobs ?? []).filter((j) => j.status === 'OPEN' && !taken.has(j.id));
  const [jobId, setJobId] = useState('');
  const [note, setNote] = useState('');
  const invite = useMutation({
    mutationFn: () => api.post<{ id: string }>(`/candidates/${c.id}/invite`, { jobId, ...(note.trim() ? { note: note.trim() } : {}) }),
    onSuccess: (r) => {
      toast.success(`${c.name.split(' ')[0]} entrou na vaga, direto na triagem`, { action: { label: 'Abrir', onClick: () => navigate(`/admin/recrutamento/candidaturas/${r.id}`) } });
      qc.invalidateQueries({ queryKey: ['talent-pool'] });
      qc.invalidateQueries({ queryKey: ['jobs'] });
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={`Trazer ${c.name.split(' ')[0]} para uma vaga`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={invite.isPending} disabled={!jobId} onClick={() => invite.mutate()}>
            Trazer para a vaga
          </Button>
        </>
      }
    >
      {jobs && open.length === 0 ? (
        <p className="text-sm text-ink-500">Não há vaga aberta em que essa pessoa ainda não esteja.</p>
      ) : (
        <div className="space-y-4">
          <Field label="Vaga">
            <Select value={jobId} onChange={(e) => setJobId(e.target.value)}>
              <option value="">Selecione</option>
              {open.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.title}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Mensagem para a pessoa (opcional)" hint="Vai no e-mail junto com o convite. O currículo da última candidatura é reaproveitado.">
            <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex.: Lembramos de você do processo de março e achamos que essa vaga combina ainda mais." />
          </Field>
        </div>
      )}
    </Modal>
  );
}

export default function TalentPool() {
  const { isHR } = useAuth();
  const [search, setSearch] = useState('');
  const q = useDeferredValue(search.trim());
  const [profile, setProfile] = useState<ProfileKey | 'ALL'>('ALL');
  const [hideHired, setHideHired] = useState(true);
  const [inviting, setInviting] = useState<PoolCandidate | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ['talent-pool', q, profile],
    queryFn: () => api.get<PoolCandidate[]>(`/candidates?${new URLSearchParams({ ...(q ? { search: q } : {}), ...(profile !== 'ALL' ? { profile } : {}) })}`),
    placeholderData: (prev) => prev,
  });
  const rows = (data ?? []).filter((c) => !hideHired || !c.hired);

  return (
    <div>
      <Link to="/admin/recrutamento" className="mb-3 inline-flex items-center gap-1 text-[13px] text-ink-500 hover:text-ink-900">
        <ArrowLeft className="h-4 w-4" /> Vagas e candidatos
      </Link>
      <PageHeader title="Banco de talentos" subtitle="Todo mundo que já se candidatou. Antes de abrir uma vaga do zero, veja quem já passou por aqui." />

      <div className="card mb-4 flex flex-wrap items-center gap-3 p-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nome, e-mail ou cidade" className="pl-9" />
        </div>
        <Select value={profile} onChange={(e) => setProfile(e.target.value as ProfileKey | 'ALL')} className="w-48" aria-label="Perfil">
          <option value="ALL">Todos os perfis</option>
          {PROFILE_KEYS.map((k) => (
            <option key={k} value={k}>
              {PROFILES[k].label}
            </option>
          ))}
        </Select>
        <Tabs
          size="sm"
          value={hideHired ? 'disp' : 'todos'}
          onChange={(v) => setHideHired(v === 'disp')}
          items={[
            { value: 'disp', label: 'Disponíveis' },
            { value: 'todos', label: 'Todos' },
          ]}
        />
      </div>

      {isLoading ? (
        <PageLoader />
      ) : rows.length === 0 ? (
        <div className="card">
          <EmptyState icon={<Library />} title={q || profile !== 'ALL' ? 'Ninguém encontrado' : 'O banco ainda está vazio'} text="Cada candidatura recebida pelo portal entra aqui automaticamente." />
        </div>
      ) : (
        <div className="card overflow-hidden">
          <p className="border-b border-ink-100 px-5 py-2.5 text-xs text-ink-500">
            <span className="num font-medium text-ink-700">{rows.length}</span> pessoa{rows.length === 1 ? '' : 's'}
          </p>
          <ul className="divide-y divide-ink-100">
            {rows.map((c) => {
              const last = c.applications[0];
              return (
                <li key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 hover:bg-ink-50/50">
                  <Link to={last ? `/admin/recrutamento/candidaturas/${last.id}` : '#'} className="flex min-w-0 flex-1 basis-64 items-center gap-3">
                    <Avatar user={{ id: c.id, name: c.name, avatarUrl: null }} size={36} />
                    <span className="min-w-0">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-semibold text-ink-900">{c.name}</span>
                        {c.hired && <span className="shrink-0 rounded-full bg-ok-soft px-2 py-0.5 text-[11px] font-medium text-ok">Contratado</span>}
                      </span>
                      <span className="flex items-center gap-1 truncate text-xs text-ink-500">
                        {c.city && (
                          <>
                            <MapPin className="h-3 w-3" /> {c.city} ·
                          </>
                        )}
                        {c.applications.length} candidatura{c.applications.length === 1 ? '' : 's'}
                      </span>
                    </span>
                  </Link>
                  <span className="hidden w-56 min-w-0 md:block">
                    {last && (
                      <>
                        <span className="block truncate text-xs text-ink-700">{last.job.title}</span>
                        <span className="flex items-center gap-1.5 text-xs text-ink-500">
                          <span className="h-1.5 w-1.5 rounded-full" style={{ background: STAGE_COLOR[last.stage] }} />
                          <span style={{ color: STAGE_COLOR[last.stage] }}>{STAGE_LABEL[last.stage]}</span>
                          · {fromNow(last.createdAt)}
                        </span>
                      </>
                    )}
                  </span>
                  <span className="hidden w-28 lg:block">
                    {c.profile ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-700">
                        <span className="h-2 w-2 rounded-full" style={{ background: PROFILES[c.profile].color }} />
                        {PROFILES[c.profile].label}
                      </span>
                    ) : (
                      <span className="text-xs text-ink-400">Sem teste</span>
                    )}
                  </span>
                  <span className={clsx('hidden w-24 sm:block', !c.rating && 'opacity-40')}>
                    <Stars value={c.rating} size={13} />
                  </span>
                  {isHR && (
                    <Button size="sm" variant="secondary" icon={<UserPlus className="h-3.5 w-3.5" />} onClick={() => setInviting(c)}>
                      Trazer para vaga
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {inviting && <InviteModal c={inviting} onClose={() => setInviting(null)} />}
    </div>
  );
}
