import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { toast } from 'sonner';
import { Send } from 'lucide-react';
import { PROFILES, PROFILE_KEYS, type ProfileKey } from '@dumax/shared';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Department, Team, UserLite } from '@/lib/types';
import { Avatar, AvatarStack, Button, PageHeader, PageLoader, Panel, ProgressBar, Select } from '@/components/ui';

type Person = {
  user: UserLite & { department: { id: string; name: string; color: string } | null };
  scores: Record<ProfileKey, number>;
  primary: ProfileKey;
  secondary: ProfileKey;
  position: { x: number; y: number };
};
interface MapData {
  people: Person[];
  pending: UserLite[];
  counts: Record<ProfileKey, number>;
  average: Record<ProfileKey, number> | null;
}

/** Quadrantes do mapa: Executor ↖ · Comunicador ↗ · Analista ↙ · Planejador ↘ */
const QUADRANTS: { key: ProfileKey; pos: string; align: string }[] = [
  { key: 'EXECUTOR', pos: 'left-0 top-0', align: 'items-start text-left' },
  { key: 'COMUNICADOR', pos: 'right-0 top-0', align: 'items-end text-right' },
  { key: 'ANALISTA', pos: 'left-0 bottom-0', align: 'items-start text-left justify-end' },
  { key: 'PLANEJADOR', pos: 'right-0 bottom-0', align: 'items-end text-right justify-end' },
];

/** Pequeno deslocamento determinístico para avatares não se sobreporem por completo */
function jitter(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return { dx: ((h % 100) / 100 - 0.5) * 0.06, dy: (((h >> 7) % 100) / 100 - 0.5) * 0.06 };
}

export default function ProfileMap({ admin }: { admin?: boolean }) {
  const { isHR } = useAuth();
  const [departmentId, setDepartmentId] = useState('');
  const [teamId, setTeamId] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const { data: depts = [] } = useQuery({ queryKey: ['departments'], queryFn: () => api.get<Department[]>('/org/departments') });
  const { data: teams = [] } = useQuery({ queryKey: ['teams'], queryFn: () => api.get<Team[]>('/org/teams') });
  const { data, isLoading } = useQuery({ queryKey: ['profile-map', departmentId, teamId], queryFn: () => api.get<MapData>('/profiles/map', { departmentId, teamId }) });
  const invite = useMutation({
    mutationFn: () => api.post<{ invited: number }>('/profiles/request'),
    onSuccess: (r) => toast.success(r.invited ? `Convite enviado para ${r.invited} pessoa(s)` : 'Todos já fizeram o teste'),
    onError: (e) => toast.error(errorMessage(e)),
  });

  const placed = useMemo(
    () =>
      (data?.people ?? []).map((p) => {
        const j = jitter(p.user.id);
        const x = Math.max(-0.94, Math.min(0.94, p.position.x + j.dx));
        const y = Math.max(-0.94, Math.min(0.94, p.position.y + j.dy));
        return { ...p, left: ((x + 1) / 2) * 100, top: ((1 - y) / 2) * 100 };
      }),
    [data],
  );

  if (isLoading || !data) return <PageLoader />;
  const sel = placed.find((p) => p.user.id === selected) ?? null;
  const total = data.people.length;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Mapa de perfis"
        subtitle={`${total} pessoa(s) no mapa${data.pending.length ? ` · ${data.pending.length} sem teste` : ''}`}
        actions={
          <>
            <Select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className="w-40">
              <option value="">Todas as áreas</option>
              {depts.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
            <Select value={teamId} onChange={(e) => setTeamId(e.target.value)} className="w-40">
              <option value="">Todos os times</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
            {admin && isHR && data.pending.length > 0 && (
              <Button variant="secondary" icon={<Send className="h-4 w-4" />} loading={invite.isPending} onClick={() => invite.mutate()}>
                Pedir teste a quem falta
              </Button>
            )}
            {!admin && (
              <Link to="/perfil-comportamental">
                <Button variant="secondary">Meu perfil</Button>
              </Link>
            )}
          </>
        }
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="card p-4 sm:p-6">
          <div className="mx-auto w-full max-w-[720px]">
            <p className="mb-2 text-center text-xs font-medium text-ink-500">Ativo · assertivo</p>
            <div className="flex items-stretch gap-2">
              <p className="flex w-5 shrink-0 items-center justify-center text-xs font-medium text-ink-500 [writing-mode:vertical-rl] rotate-180">Foco em tarefas</p>
              <div className="relative aspect-square flex-1 overflow-hidden rounded-xl border border-ink-200" onClick={() => setSelected(null)}>
                {/* quadrantes */}
                {QUADRANTS.map((q) => (
                  <div key={q.key} className={clsx('absolute flex h-1/2 w-1/2 flex-col p-3', q.pos, q.align)} style={{ background: `${PROFILES[q.key].color}0D` }}>
                    <span className="text-sm font-semibold" style={{ color: PROFILES[q.key].color }}>
                      {PROFILES[q.key].label}
                    </span>
                    <span className="num text-xs text-ink-500">{data.counts[q.key]} pessoa(s)</span>
                  </div>
                ))}
                {/* eixos */}
                <div className="absolute left-1/2 top-0 h-full w-px bg-ink-200" />
                <div className="absolute left-0 top-1/2 h-px w-full bg-ink-200" />
                {[0.25, 0.75].map((f) => (
                  <div key={`v${f}`} className="absolute top-0 h-full w-px border-l border-dashed border-ink-100" style={{ left: `${f * 100}%` }} />
                ))}
                {[0.25, 0.75].map((f) => (
                  <div key={`h${f}`} className="absolute left-0 h-px w-full border-t border-dashed border-ink-100" style={{ top: `${f * 100}%` }} />
                ))}

                {/* pessoas */}
                {placed.map((p) => {
                  const active = selected === p.user.id || hover === p.user.id;
                  const dim = selected && selected !== p.user.id;
                  return (
                    <button
                      key={p.user.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelected(p.user.id === selected ? null : p.user.id);
                      }}
                      onMouseEnter={() => setHover(p.user.id)}
                      onMouseLeave={() => setHover(null)}
                      className={clsx('absolute -translate-x-1/2 -translate-y-1/2 rounded-full transition', active ? 'z-20 scale-125' : 'z-10', dim && 'opacity-40')}
                      style={{ left: `${p.left}%`, top: `${p.top}%` }}
                      aria-label={p.user.name}
                    >
                      <span className="block rounded-full p-[2px]" style={{ background: PROFILES[p.primary].color }}>
                        <span className="block rounded-full ring-2 ring-white">
                          <Avatar user={p.user} size={34} />
                        </span>
                      </span>
                      {active && (
                        <span className="pointer-events-none absolute left-1/2 top-full z-30 mt-1.5 w-44 -translate-x-1/2 rounded-lg border border-ink-200 bg-white p-2.5 text-left shadow-pop">
                          <span className="block truncate text-[13px] font-semibold">{p.user.name}</span>
                          <span className="mb-1.5 block truncate text-2xs text-ink-500">{p.user.jobTitle}</span>
                          {PROFILE_KEYS.map((k) => (
                            <span key={k} className="flex items-center gap-1.5 text-2xs">
                              <span className="w-[72px] text-ink-600">{PROFILES[k].label}</span>
                              <span className="h-1 flex-1 rounded-full bg-ink-100">
                                <span className="block h-full rounded-full" style={{ width: `${p.scores[k]}%`, background: PROFILES[k].color }} />
                              </span>
                              <span className="num w-7 text-right">{p.scores[k]}%</span>
                            </span>
                          ))}
                        </span>
                      )}
                    </button>
                  );
                })}
                {!placed.length && <p className="absolute inset-0 flex items-center justify-center text-sm text-ink-500">Ninguém deste filtro fez o teste ainda.</p>}
              </div>
              <p className="flex w-5 shrink-0 items-center justify-center text-xs font-medium text-ink-500 [writing-mode:vertical-rl]">Foco em pessoas</p>
            </div>
            <p className="mt-2 text-center text-xs font-medium text-ink-500">Reservado · ponderado</p>
          </div>
        </div>

        <div className="space-y-5">
          {sel ? (
            <Panel title={sel.user.name} subtitle={[sel.user.jobTitle, sel.user.department?.name].filter(Boolean).join(' · ')}>
              <div className="space-y-3 p-4">
                <p className="text-sm">
                  <span className="font-semibold" style={{ color: PROFILES[sel.primary].color }}>
                    {PROFILES[sel.primary].label}
                  </span>{' '}
                  com traços de {PROFILES[sel.secondary].label.toLowerCase()}
                </p>
                <p className="text-[13px] text-ink-600">{PROFILES[sel.primary].description}</p>
                {PROFILE_KEYS.map((k) => (
                  <div key={k}>
                    <div className="mb-1 flex justify-between text-[13px]">
                      <span>{PROFILES[k].label}</span>
                      <span className="num">{sel.scores[k]}%</span>
                    </div>
                    <ProgressBar value={sel.scores[k] / 100} color={PROFILES[k].color} />
                  </div>
                ))}
              </div>
            </Panel>
          ) : (
            <Panel title="Composição" subtitle="Perfil predominante de cada pessoa">
              <ul className="space-y-3 p-4">
                {PROFILE_KEYS.map((k) => (
                  <li key={k}>
                    <div className="mb-1 flex justify-between text-[13px]">
                      <span className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full" style={{ background: PROFILES[k].color }} />
                        {PROFILES[k].label}
                      </span>
                      <span className="num text-ink-600">
                        {data.counts[k]} <span className="text-ink-400">· {total ? Math.round((data.counts[k] / total) * 100) : 0}%</span>
                      </span>
                    </div>
                    <ProgressBar value={total ? data.counts[k] / total : 0} color={PROFILES[k].color} />
                  </li>
                ))}
              </ul>
              {data.average && (
                <p className="border-t border-ink-100 px-4 py-3 text-[13px] text-ink-600">
                  Média do grupo:{' '}
                  {PROFILE_KEYS.map((k) => `${PROFILES[k].label} ${data.average![k]}%`).join(' · ')}
                </p>
              )}
            </Panel>
          )}

          {data.pending.length > 0 && (
            <Panel title="Ainda sem teste" subtitle={`${data.pending.length} pessoa(s)`}>
              <div className="flex items-center gap-3 p-4">
                <AvatarStack users={data.pending} max={8} size={28} />
              </div>
            </Panel>
          )}

          <Panel title="Como ler o mapa">
            <p className="p-4 text-[13px] leading-relaxed text-ink-600">
              Quem está mais no alto tende a ser mais ativo e assertivo; mais embaixo, mais ponderado. À esquerda, o foco é na tarefa; à direita, nas pessoas. Quanto mais perto do canto,
              mais forte o perfil. Perto do centro, mais equilibrado.
            </p>
          </Panel>
        </div>
      </div>
    </div>
  );
}
