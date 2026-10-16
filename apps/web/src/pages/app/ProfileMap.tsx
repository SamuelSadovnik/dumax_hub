import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { toast } from 'sonner';
import { Send, X } from 'lucide-react';
import { PROFILES, PROFILE_KEYS, type ProfileKey } from '@dumax/shared';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Department, Team, UserLite } from '@/lib/types';
import { Avatar, AvatarStack, Button, PageHeader, PageLoader, Panel, ProgressBar, RingAvatar, Select, Tabs } from '@/components/ui';

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

/** Setores da bússola (y para cima): Executor ↖ · Comunicador ↗ · Analista ↙ · Planejador ↘ */
const SECTORS: { key: ProfileKey; path: string; corner: string; align: string }[] = [
  { key: 'EXECUTOR', path: 'M0 0 L-1 0 A1 1 0 0 1 0 -1 Z', corner: 'left-0 top-0', align: 'text-left' },
  { key: 'COMUNICADOR', path: 'M0 0 L0 -1 A1 1 0 0 1 1 0 Z', corner: 'right-0 top-0', align: 'text-right' },
  { key: 'ANALISTA', path: 'M0 0 L0 1 A1 1 0 0 1 -1 0 Z', corner: 'left-0 bottom-0', align: 'text-left' },
  { key: 'PLANEJADOR', path: 'M0 0 L1 0 A1 1 0 0 1 0 1 Z', corner: 'right-0 bottom-0', align: 'text-right' },
];
const ORDER: ProfileKey[] = ['EXECUTOR', 'COMUNICADOR', 'ANALISTA', 'PLANEJADOR'];

/** Leva o ponto do quadrado [-1,1]² para dentro do círculo, mantendo a direção e a intensidade */
function toDisc(x: number, y: number) {
  const m = Math.hypot(x, y);
  if (!m) return { x: 0, y: 0 };
  const r = Math.max(Math.abs(x), Math.abs(y));
  return { x: (x / m) * r, y: (y / m) * r };
}

/** Afasta fotos sobrepostas e puxa cada uma de volta para perto da posição real */
function relax(points: { id: string; x: number; y: number }[], minDist: number, limit = 0.9) {
  const p = points.map((q) => ({ ...q, ox: q.x, oy: q.y }));
  for (let it = 0; it < 180; it++) {
    for (let i = 0; i < p.length; i++) {
      for (let j = i + 1; j < p.length; j++) {
        const dx = p[j].x - p[i].x;
        const dy = p[j].y - p[i].y;
        const d = Math.hypot(dx, dy);
        if (d >= minDist) continue;
        const ux = d > 1e-6 ? dx / d : Math.cos(i * 2.4 + j);
        const uy = d > 1e-6 ? dy / d : Math.sin(i * 2.4 + j);
        const push = (minDist - d) / 2;
        p[i].x -= ux * push;
        p[i].y -= uy * push;
        p[j].x += ux * push;
        p[j].y += uy * push;
      }
    }
    for (const q of p) {
      q.x += (q.ox - q.x) * 0.02;
      q.y += (q.oy - q.y) * 0.02;
      const m = Math.hypot(q.x, q.y);
      if (m > limit) {
        q.x *= limit / m;
        q.y *= limit / m;
      }
    }
  }
  return new Map(p.map((q) => [q.id, { x: q.x, y: q.y }]));
}

function Compass({ people, counts, focus, selected, onSelect }: { people: Person[]; counts: Record<ProfileKey, number>; focus: ProfileKey | null; selected: string | null; onSelect: (id: string | null) => void }) {
  const [hover, setHover] = useState<string | null>(null);
  const placed = useMemo(() => {
    const pts = people.map((p) => ({ id: p.user.id, ...toDisc(p.position.x * 0.92, p.position.y * 0.92) }));
    const pos = relax(pts, 0.14);
    return people.map((p) => {
      const q = pos.get(p.user.id)!;
      return { ...p, left: ((q.x + 1) / 2) * 100, top: ((1 - q.y) / 2) * 100 };
    });
  }, [people]);

  return (
    <div className="relative mx-auto aspect-square w-full max-w-[680px] select-none" onClick={() => onSelect(null)}>
      {/* rótulos dos perfis nos cantos (fora do círculo) */}
      {SECTORS.map((s) => (
        <div key={s.key} className={clsx('pointer-events-none absolute w-[30%]', s.corner, s.align, focus && focus !== s.key && 'opacity-30')}>
          <p className="font-display text-lg font-bold leading-tight" style={{ color: PROFILES[s.key].color }}>
            {PROFILES[s.key].label}
          </p>
          <p className="text-xs text-ink-500">
            <span className="num font-medium text-ink-700">{counts[s.key]}</span> {counts[s.key] === 1 ? 'pessoa' : 'pessoas'}
          </p>
        </div>
      ))}

      <svg viewBox="-1.02 -1.02 2.04 2.04" className="absolute inset-0 h-full w-full">
        <defs>
          {SECTORS.map((s) => (
            <radialGradient key={s.key} id={`g-${s.key}`} cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse">
              <stop offset="0.15" stopColor={PROFILES[s.key].color} stopOpacity="0.02" />
              <stop offset="1" stopColor={PROFILES[s.key].color} stopOpacity="0.2" />
            </radialGradient>
          ))}
        </defs>
        {SECTORS.map((s) => (
          <path key={s.key} d={s.path} fill={`url(#g-${s.key})`} opacity={focus && focus !== s.key ? 0.25 : 1} style={{ transition: 'opacity .2s' }} />
        ))}
        {[0.34, 0.67].map((r) => (
          <circle key={r} r={r} fill="none" stroke="#C5CAD6" strokeWidth="0.004" strokeDasharray="0.015 0.015" />
        ))}
        <circle r="1" fill="none" stroke="#C5CAD6" strokeWidth="0.005" />
        <line x1="-1" y1="0" x2="1" y2="0" stroke="#C5CAD6" strokeWidth="0.004" />
        <line x1="0" y1="-1" x2="0" y2="1" stroke="#C5CAD6" strokeWidth="0.004" />
        <circle r="0.045" fill="white" stroke="#C5CAD6" strokeWidth="0.004" />
      </svg>

      {/* eixos em palavras */}
      <span className="pointer-events-none absolute left-1/2 top-[1%] -translate-x-1/2 rounded-full bg-white/90 px-2 text-2xs font-medium text-ink-500">Ativo e assertivo</span>
      <span className="pointer-events-none absolute bottom-[1%] left-1/2 -translate-x-1/2 rounded-full bg-white/90 px-2 text-2xs font-medium text-ink-500">Reservado e ponderado</span>
      <span className="pointer-events-none absolute left-[1%] top-1/2 -translate-y-1/2 rounded-full bg-white/90 px-2 text-2xs font-medium text-ink-500">Tarefas</span>
      <span className="pointer-events-none absolute right-[1%] top-1/2 -translate-y-1/2 rounded-full bg-white/90 px-2 text-2xs font-medium text-ink-500">Pessoas</span>

      {/* pessoas */}
      {placed.map((p) => {
        const isSel = selected === p.user.id;
        const isHover = hover === p.user.id;
        const dim = (selected && !isSel) || (focus && p.primary !== focus);
        return (
          <button
            key={p.user.id}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(isSel ? null : p.user.id);
            }}
            onMouseEnter={() => setHover(p.user.id)}
            onMouseLeave={() => setHover(null)}
            className={clsx('absolute -translate-x-1/2 -translate-y-1/2 rounded-full transition-[transform,opacity] duration-200', isSel || isHover ? 'z-20 scale-[1.18]' : 'z-10', dim && 'opacity-25')}
            style={{ left: `${p.left}%`, top: `${p.top}%` }}
            aria-label={`${p.user.name}, ${PROFILES[p.primary].label}`}
          >
            <RingAvatar user={p.user} size={40} color={PROFILES[p.primary].color} className="shadow-md" />
            {(isHover || isSel) && (
              <span className="pointer-events-none absolute left-1/2 top-full z-30 mt-1.5 -translate-x-1/2 whitespace-nowrap rounded-lg bg-ink-900 px-2.5 py-1.5 text-left shadow-pop">
                <span className="block text-[13px] font-semibold text-white">{p.user.name}</span>
                <span className="block text-2xs" style={{ color: PROFILES[p.primary].color }}>
                  {PROFILES[p.primary].label} · {p.scores[p.primary]}%
                </span>
              </span>
            )}
          </button>
        );
      })}
      {!placed.length && <p className="absolute inset-0 flex items-center justify-center text-sm text-ink-500">Ninguém deste filtro fez o teste ainda.</p>}
    </div>
  );
}

/** Visão em colunas: cada perfil com as pessoas ordenadas pela intensidade */
function Groups({ people, onSelect, selected }: { people: Person[]; onSelect: (id: string) => void; selected: string | null }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
      {PROFILE_KEYS.map((k) => {
        const list = people.filter((p) => p.primary === k).sort((a, b) => b.scores[k] - a.scores[k]);
        return (
          <section key={k} className="card overflow-hidden">
            <header className="border-b border-ink-100 px-4 py-3" style={{ background: `${PROFILES[k].color}0F` }}>
              <p className="font-display text-base font-bold" style={{ color: PROFILES[k].color }}>
                {PROFILES[k].label}
              </p>
              <p className="text-xs text-ink-500">{PROFILES[k].tagline}</p>
            </header>
            <ul className="divide-y divide-ink-100">
              {list.map((p) => (
                <li key={p.user.id}>
                  <button onClick={() => onSelect(p.user.id)} className={clsx('flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-ink-50', selected === p.user.id && 'bg-brand-50/60')}>
                    <Avatar user={p.user} size={36} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{p.user.name}</span>
                      <span className="block truncate text-xs text-ink-500">{p.user.jobTitle ?? p.user.department?.name}</span>
                    </span>
                    <span className="num text-xs font-semibold" style={{ color: PROFILES[k].color }}>
                      {p.scores[k]}%
                    </span>
                  </button>
                </li>
              ))}
              {!list.length && <li className="px-4 py-6 text-center text-sm text-ink-400">Ninguém com este perfil predominante</li>}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function PersonPanel({ p, onClose }: { p: Person; onClose: () => void }) {
  const meta = PROFILES[p.primary];
  return (
    <section className="card overflow-hidden">
      <div className="relative px-5 pb-5 pt-6 text-center" style={{ background: `linear-gradient(180deg, ${meta.color}1F, transparent)` }}>
        <button onClick={onClose} className="absolute right-3 top-3 rounded-lg p-1 text-ink-400 hover:bg-white hover:text-ink-700" aria-label="Fechar">
          <X className="h-4 w-4" />
        </button>
        <RingAvatar user={p.user} size={76} color={meta.color} />
        <h2 className="mt-3 text-lg font-bold">{p.user.name}</h2>
        <p className="text-sm text-ink-500">{[p.user.jobTitle, p.user.department?.name].filter(Boolean).join(' · ')}</p>
        <p className="mt-3 text-sm">
          <span className="font-semibold" style={{ color: meta.color }}>
            {meta.label}
          </span>{' '}
          com traços de {PROFILES[p.secondary].label.toLowerCase()}
        </p>
      </div>
      <div className="space-y-3 px-5 pb-5">
        {PROFILE_KEYS.map((k) => (
          <div key={k}>
            <div className="mb-1 flex justify-between text-[13px]">
              <span className={clsx(k === p.primary && 'font-semibold')}>{PROFILES[k].label}</span>
              <span className="num text-ink-600">{p.scores[k]}%</span>
            </div>
            <ProgressBar value={p.scores[k] / 100} color={PROFILES[k].color} />
          </div>
        ))}
        <p className="pt-2 text-[13px] leading-relaxed text-ink-600">{meta.description}</p>
        <div>
          <p className="mb-1.5 text-xs font-medium text-ink-500">Pontos fortes</p>
          <div className="flex flex-wrap gap-1.5">
            {meta.strengths.map((s) => (
              <span key={s} className="rounded-full px-2.5 py-1 text-xs font-medium" style={{ background: `${meta.color}14`, color: meta.color }}>
                {s}
              </span>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-1.5 text-xs font-medium text-ink-500">Pontos de atenção</p>
          <div className="flex flex-wrap gap-1.5">
            {meta.watchOuts.map((s) => (
              <span key={s} className="rounded-full bg-ink-100 px-2.5 py-1 text-xs text-ink-700">
                {s}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export default function ProfileMap({ admin }: { admin?: boolean }) {
  const { isHR } = useAuth();
  const [departmentId, setDepartmentId] = useState('');
  const [teamId, setTeamId] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [focus, setFocus] = useState<ProfileKey | null>(null);
  const [view, setView] = useState<'map' | 'groups'>('map');
  const { data: depts = [] } = useQuery({ queryKey: ['departments'], queryFn: () => api.get<Department[]>('/org/departments') });
  const { data: teams = [] } = useQuery({ queryKey: ['teams'], queryFn: () => api.get<Team[]>('/org/teams') });
  const { data, isLoading } = useQuery({ queryKey: ['profile-map', departmentId, teamId], queryFn: () => api.get<MapData>('/profiles/map', { departmentId, teamId }) });
  const invite = useMutation({
    mutationFn: () => api.post<{ invited: number }>('/profiles/request'),
    onSuccess: (r) => toast.success(r.invited ? `Convite enviado para ${r.invited} pessoa(s)` : 'Todos já fizeram o teste'),
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (isLoading || !data) return <PageLoader />;
  const sel = data.people.find((p) => p.user.id === selected) ?? null;
  const total = data.people.length;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Mapa de perfis"
        subtitle={`${total} ${total === 1 ? 'pessoa' : 'pessoas'} no mapa${data.pending.length ? `, ${data.pending.length} ainda sem teste` : ''}`}
        actions={
          <>
            <Tabs
              size="sm"
              value={view}
              onChange={setView}
              items={[
                { value: 'map', label: 'Mapa' },
                { value: 'groups', label: 'Por perfil' },
              ]}
            />
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
                Lembrar agora
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

      {/* composição: um cartão por perfil, também serve de filtro */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {ORDER.map((k) => {
          const members = data.people.filter((p) => p.primary === k).sort((a, b) => b.scores[k] - a.scores[k]);
          const on = focus === k;
          return (
            <button
              key={k}
              onClick={() => setFocus(on ? null : k)}
              className={clsx('card relative overflow-hidden px-4 py-3.5 text-left transition', on ? 'ring-2' : 'hover:shadow-lift', focus && !on && 'opacity-60')}
              style={on ? { boxShadow: `0 0 0 2px ${PROFILES[k].color}` } : undefined}
              aria-pressed={on}
            >
              <span className="absolute inset-y-0 left-0 w-1" style={{ background: PROFILES[k].color }} />
              <div className="flex items-baseline justify-between gap-2">
                <p className="font-semibold" style={{ color: PROFILES[k].color }}>
                  {PROFILES[k].label}
                </p>
                <p className="num font-display text-2xl font-bold text-ink-900">
                  {total ? Math.round((data.counts[k] / total) * 100) : 0}%
                </p>
              </div>
              <p className="text-xs text-ink-500">{PROFILES[k].tagline}</p>
              <div className="mt-3 flex items-center gap-2">
                {members.length ? <AvatarStack users={members.map((m) => m.user)} max={5} size={26} /> : <span className="text-xs text-ink-400">Ninguém ainda</span>}
                <span className="num ml-auto text-xs text-ink-500">{data.counts[k]}</span>
              </div>
            </button>
          );
        })}
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        {view === 'map' ? (
          <div className="card p-4 sm:p-6">
            <Compass people={data.people} counts={data.counts} focus={focus} selected={selected} onSelect={setSelected} />
          </div>
        ) : (
          <Groups people={focus ? data.people.filter((p) => p.primary === focus) : data.people} selected={selected} onSelect={setSelected} />
        )}

        <div className="space-y-5">
          {sel ? (
            <PersonPanel p={sel} onClose={() => setSelected(null)} />
          ) : focus ? (
            <Panel title={PROFILES[focus].label} subtitle={PROFILES[focus].tagline}>
              <div className="space-y-3 p-4 text-[13px]">
                <p className="leading-relaxed text-ink-600">{PROFILES[focus].description}</p>
                <div>
                  <p className="mb-1.5 text-xs font-medium text-ink-500">Onde costuma render mais</p>
                  <ul className="list-disc space-y-0.5 pl-5 text-ink-700">
                    {PROFILES[focus].bestFit.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </Panel>
          ) : (
            <Panel title="Como ler o mapa">
              <div className="space-y-2 p-4 text-[13px] leading-relaxed text-ink-600">
                <p>No alto ficam as pessoas mais ativas e assertivas; embaixo, as mais ponderadas. À esquerda, o foco é a tarefa; à direita, as pessoas.</p>
                <p>Quanto mais perto da borda, mais forte o perfil. Perto do centro, mais equilibrado. Clique numa foto para ver o perfil completo.</p>
              </div>
              {data.average && (
                <div className="border-t border-ink-100 p-4">
                  <p className="mb-2 text-xs font-medium text-ink-500">Média do grupo</p>
                  <div className="flex h-2.5 overflow-hidden rounded-full">
                    {PROFILE_KEYS.map((k) => (
                      <span key={k} style={{ width: `${data.average![k]}%`, background: PROFILES[k].color }} title={`${PROFILES[k].label} ${data.average![k]}%`} />
                    ))}
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-1 text-xs text-ink-600">
                    {PROFILE_KEYS.map((k) => (
                      <span key={k} className="flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full" style={{ background: PROFILES[k].color }} />
                        {PROFILES[k].label} <span className="num ml-auto pr-3 text-ink-500">{data.average![k]}%</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </Panel>
          )}

          {data.pending.length > 0 && (
            <Panel title="Ainda sem teste" subtitle={`${data.pending.length} ${data.pending.length === 1 ? 'pessoa' : 'pessoas'}, com lembrete automático toda segunda`}>
              <ul className="divide-y divide-ink-100">
                {data.pending.slice(0, 6).map((u) => (
                  <li key={u.id} className="flex items-center gap-2.5 px-4 py-2">
                    <Avatar user={u} size={28} />
                    <span className="truncate text-sm">{u.name}</span>
                  </li>
                ))}
              </ul>
              {data.pending.length > 6 && <p className="border-t border-ink-100 px-4 py-2 text-xs text-ink-500">e mais {data.pending.length - 6}</p>}
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
