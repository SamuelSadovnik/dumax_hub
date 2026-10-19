import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { toast } from 'sonner';
import { Send, X } from 'lucide-react';
import { PROFILES, PROFILE_KEYS, mapPosition, type ProfileKey } from '@dumax/shared';
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

/** Cor de texto (mais escura) de cada perfil, para leitura sobre fundo claro */
const INK: Record<ProfileKey, string> = { EXECUTOR: '#C4323A', COMUNICADOR: '#9A6400', PLANEJADOR: '#0B7F5F', ANALISTA: '#2D4FC4' };
const ORDER: ProfileKey[] = ['EXECUTOR', 'COMUNICADOR', 'ANALISTA', 'PLANEJADOR'];

/** Faixa de ângulo de cada quadrante (graus, y para cima) e o canto do rótulo */
const QUAD: Record<ProfileKey, { from: number; to: number; corner: string; align: string }> = {
  COMUNICADOR: { from: 0, to: 90, corner: 'right-0 top-0', align: 'items-end text-right' },
  EXECUTOR: { from: 90, to: 180, corner: 'left-0 top-0', align: 'items-start text-left' },
  ANALISTA: { from: 180, to: 270, corner: 'left-0 bottom-0', align: 'items-start text-left' },
  PLANEJADOR: { from: 270, to: 360, corner: 'right-0 bottom-0', align: 'items-end text-right' },
};
const wedge = (from: number, to: number) => {
  const r = (d: number) => (d * Math.PI) / 180;
  // SVG tem y para baixo: inverte o sinal de y
  return `M0 0 L${Math.cos(r(from))} ${-Math.sin(r(from))} A1 1 0 0 0 ${Math.cos(r(to))} ${-Math.sin(r(to))} Z`;
};

const VIEW = 1.32; // metade do viewBox: sobra espaço fora do círculo para os rótulos
const R_IN = 0.25; // miolo livre (equilíbrio)
const R_OUT = 0.84;

/** Leva o ponto do quadrado [-1,1]² para dentro do círculo, mantendo a direção e a intensidade */
function toDisc(x: number, y: number) {
  const m = Math.hypot(x, y);
  if (!m) return { x: 0, y: 0 };
  const r = Math.max(Math.abs(x), Math.abs(y));
  return { x: (x / m) * r, y: (y / m) * r };
}

/**
 * Posiciona as fotos: o ângulo vem da mistura de perfis, a distância do centro da
 * intensidade. Depois afasta quem se sobrepõe sem deixar ninguém sair do próprio
 * quadrante nem cair em cima dos eixos.
 */
function layout(people: Person[], minD: number) {
  const pts = people.map((p) => {
    const d = toDisc(p.position.x, p.position.y);
    const q = QUAD[p.primary];
    let ang = (Math.atan2(d.y, d.x) * 180) / Math.PI;
    if (ang < 0) ang += 360;
    if (p.primary === 'PLANEJADOR' && ang < 45) ang += 360;
    ang = Math.min(q.to, Math.max(q.from, ang));
    const rho = R_IN + (R_OUT - R_IN) * Math.min(1, Math.hypot(d.x, d.y));
    const rad = (ang * Math.PI) / 180;
    return { id: p.user.id, q, x: rho * Math.cos(rad), y: rho * Math.sin(rad), ox: rho * Math.cos(rad), oy: rho * Math.sin(rad) };
  });
  const clamp = (pt: (typeof pts)[number]) => {
    let rho = Math.hypot(pt.x, pt.y);
    let ang = (Math.atan2(pt.y, pt.x) * 180) / Math.PI;
    if (ang < 0) ang += 360;
    if (pt.q.from === 270 && ang < 45) ang += 360;
    rho = Math.min(R_OUT, Math.max(R_IN, rho));
    const pad = Math.min(44, (Math.asin(Math.min(1, minD / 2 / rho)) * 180) / Math.PI);
    ang = Math.min(pt.q.to - pad, Math.max(pt.q.from + pad, ang));
    const rad = (ang * Math.PI) / 180;
    pt.x = rho * Math.cos(rad);
    pt.y = rho * Math.sin(rad);
  };
  pts.forEach(clamp);
  for (let it = 0; it < 320; it++) {
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const dx = pts[j].x - pts[i].x;
        const dy = pts[j].y - pts[i].y;
        const d = Math.hypot(dx, dy);
        if (d >= minD) continue;
        const ux = d > 1e-6 ? dx / d : Math.cos(i * 2.4 + j);
        const uy = d > 1e-6 ? dy / d : Math.sin(i * 2.4 + j);
        const push = (minD - d) / 2;
        pts[i].x -= ux * push;
        pts[i].y -= uy * push;
        pts[j].x += ux * push;
        pts[j].y += uy * push;
      }
    }
    for (const pt of pts) {
      pt.x += (pt.ox - pt.x) * 0.015;
      pt.y += (pt.oy - pt.y) * 0.015;
      clamp(pt);
    }
  }
  return new Map(pts.map((pt) => [pt.id, { x: pt.x, y: pt.y }]));
}

const pctX = (x: number) => ((x + VIEW) / (2 * VIEW)) * 100;
const pctY = (y: number) => ((VIEW - y) / (2 * VIEW)) * 100;

function MiniBars({ scores }: { scores: Record<ProfileKey, number> }) {
  return (
    <span className="mt-2 flex h-1.5 w-full overflow-hidden rounded-full bg-ink-100">
      {PROFILE_KEYS.map((k) => (
        <span key={k} style={{ width: `${scores[k]}%`, background: PROFILES[k].color }} />
      ))}
    </span>
  );
}

function Compass({
  people, counts, total, average, focus, selected, onSelect,
}: {
  people: Person[]; counts: Record<ProfileKey, number>; total: number; average: Record<ProfileKey, number> | null;
  focus: ProfileKey | null; selected: string | null; onSelect: (id: string | null) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(640);
  const [hover, setHover] = useState<string | null>(null);
  useLayoutEffect(() => {
    if (!box.current) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(box.current);
    return () => ro.disconnect();
  }, []);
  const size = Math.round(Math.min(40, Math.max(24, w * 0.056)));
  const unit = w / (2 * VIEW); // pixels por unidade do mapa
  const placed = useMemo(() => {
    const pos = layout(people, (size + 7) / unit);
    return people.map((p) => ({ ...p, ...pos.get(p.user.id)! }));
  }, [people, size, unit]);
  const avg = average ? toDisc(mapPosition(average).x, mapPosition(average).y) : null;
  const tipFor = hover ?? selected;

  return (
    <div ref={box} className="relative mx-auto aspect-square w-full max-w-[720px] select-none" onClick={() => onSelect(null)}>
      <svg viewBox={`${-VIEW} ${-VIEW} ${2 * VIEW} ${2 * VIEW}`} className="absolute inset-0 h-full w-full" aria-hidden>
        <defs>
          {ORDER.map((k) => (
            <radialGradient key={k} id={`pm-${k}`} cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse">
              <stop offset="0.2" stopColor={PROFILES[k].color} stopOpacity="0.06" />
              <stop offset="0.75" stopColor={PROFILES[k].color} stopOpacity="0.16" />
              <stop offset="1" stopColor={PROFILES[k].color} stopOpacity="0.26" />
            </radialGradient>
          ))}
          <filter id="pm-shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="0.012" stdDeviation="0.02" floodColor="#0f172a" floodOpacity="0.08" />
          </filter>
        </defs>
        <circle r="1.004" fill="#fff" filter="url(#pm-shadow)" />
        {ORDER.map((k) => (
          <path key={k} d={wedge(QUAD[k].from, QUAD[k].to)} fill={`url(#pm-${k})`} opacity={focus && focus !== k ? 0.3 : 1} style={{ transition: 'opacity .25s' }} />
        ))}
        {/* anéis de intensidade */}
        <circle r={(R_IN + R_OUT) / 2} fill="none" stroke="#fff" strokeWidth="0.008" strokeDasharray="0.02 0.02" />
        <circle r={R_OUT + 0.05} fill="none" stroke="#fff" strokeWidth="0.006" />
        {/* eixos como vãos brancos entre os quadrantes */}
        <line x1="-1.01" y1="0" x2="1.01" y2="0" stroke="#fff" strokeWidth="0.016" />
        <line x1="0" y1="-1.01" x2="0" y2="1.01" stroke="#fff" strokeWidth="0.016" />
        <circle r="1" fill="none" stroke="#E4E7EE" strokeWidth="0.006" />
        {/* miolo: equilíbrio */}
        <circle r={R_IN - 0.04} fill="#fff" stroke="#E4E7EE" strokeWidth="0.006" />
      </svg>

      {/* nomes dos perfis nos cantos */}
      {ORDER.map((k) => (
        <div key={k} className={clsx('pointer-events-none absolute flex w-[26%] flex-col transition-opacity', QUAD[k].corner, QUAD[k].align, focus && focus !== k && 'opacity-30')}>
          <span className="font-display text-[clamp(15px,2.6vw,22px)] font-bold leading-none" style={{ color: INK[k] }}>
            {PROFILES[k].label}
          </span>
          <span className="mt-1 text-xs text-ink-500">
            <span className="num font-semibold text-ink-800">{total ? Math.round((counts[k] / total) * 100) : 0}%</span> · {counts[k]} {counts[k] === 1 ? 'pessoa' : 'pessoas'}
          </span>
        </div>
      ))}

      {/* eixos em palavras, fora do círculo */}
      {[
        { t: 'Ativo e assertivo', s: { left: '50%', top: `${pctY(1.075)}%` } },
        { t: 'Reservado e ponderado', s: { left: '50%', top: `${pctY(-1.075)}%` } },
        { t: 'Tarefas', s: { left: `${pctX(-1.16)}%`, top: '50%' } },
        { t: 'Pessoas', s: { left: `${pctX(1.16)}%`, top: '50%' } },
      ].map((a) => (
        <span key={a.t} className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-400" style={a.s}>
          {a.t}
        </span>
      ))}

      {/* centro: onde o time está, em média */}
      {avg && (
        <span
          className="pointer-events-none absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
          style={{ left: `${pctX(avg.x * (R_IN - 0.06))}%`, top: `${pctY(avg.y * (R_IN - 0.06))}%` }}
          title="Média do time"
        >
          <span className="relative flex h-3 w-3">
            <span className="absolute inset-0 animate-ping rounded-full bg-ink-900/30" />
            <span className="relative h-3 w-3 rounded-full border-2 border-white bg-ink-900 shadow" />
          </span>
          <span className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-ink-500">Time</span>
        </span>
      )}

      {/* pessoas */}
      {placed.map((p) => {
        const isSel = selected === p.user.id;
        const isHover = hover === p.user.id;
        const dim = (selected && !isSel && !isHover) || (focus && p.primary !== focus);
        const c = PROFILES[p.primary].color;
        return (
          <button
            key={p.user.id}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(isSel ? null : p.user.id);
            }}
            onMouseEnter={() => setHover(p.user.id)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(p.user.id)}
            onBlur={() => setHover(null)}
            className={clsx(
              'absolute -translate-x-1/2 -translate-y-1/2 rounded-full transition-[transform,opacity] duration-200 ease-out focus:outline-none',
              isSel || isHover ? 'z-20 scale-[1.22]' : 'z-10 hover:scale-110',
              dim && 'opacity-20',
            )}
            style={{
              left: `${pctX(p.x)}%`,
              top: `${pctY(p.y)}%`,
              boxShadow: `0 0 0 2px #fff, 0 0 0 ${isSel ? 4.5 : 3.5}px ${c}, 0 6px 14px -4px rgba(15,23,42,.35)`,
            }}
            aria-label={`${p.user.name}, ${PROFILES[p.primary].label} ${p.scores[p.primary]}%`}
            aria-pressed={isSel}
          >
            <Avatar user={p.user} size={size} color={c} />
          </button>
        );
      })}

      {/* cartão da pessoa sob o cursor */}
      {tipFor &&
        (() => {
          const p = placed.find((x) => x.user.id === tipFor);
          if (!p) return null;
          const below = p.y > 0.25;
          return (
            <div
              className="pointer-events-none absolute z-30 w-52 -translate-x-1/2 rounded-xl border border-ink-100 bg-white px-3 py-2.5 shadow-pop"
              style={{ left: `${Math.min(84, Math.max(16, pctX(p.x)))}%`, top: `${pctY(p.y)}%`, transform: `translate(-50%, ${below ? `${size / 2 + 12}px` : `calc(-100% - ${size / 2 + 12}px)`})` }}
            >
              <p className="truncate text-[13px] font-semibold text-ink-900">{p.user.name}</p>
              {p.user.jobTitle && <p className="truncate text-xs text-ink-500">{p.user.jobTitle}</p>}
              <p className="mt-1.5 text-xs">
                <span className="font-semibold" style={{ color: INK[p.primary] }}>
                  {PROFILES[p.primary].label} {p.scores[p.primary]}%
                </span>
                <span className="text-ink-400"> · traços de {PROFILES[p.secondary].label.toLowerCase()}</span>
              </p>
              <MiniBars scores={p.scores} />
            </div>
          );
        })()}

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
            <header className="flex items-center gap-3 border-b border-ink-100 px-4 py-3" style={{ background: `${PROFILES[k].color}10` }}>
              <span className="h-8 w-1.5 shrink-0 rounded-full" style={{ background: PROFILES[k].color }} />
              <span className="min-w-0 flex-1">
                <span className="block font-display text-base font-bold" style={{ color: INK[k] }}>
                  {PROFILES[k].label}
                </span>
                <span className="block truncate text-xs text-ink-500">{PROFILES[k].tagline}</span>
              </span>
              <span className="num rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-ink-700 shadow-sm">{list.length}</span>
            </header>
            <ul className="divide-y divide-ink-100">
              {list.map((p) => (
                <li key={p.user.id}>
                  <button onClick={() => onSelect(p.user.id)} className={clsx('flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-ink-50', selected === p.user.id && 'bg-brand-50/60')}>
                    <Avatar user={p.user} size={36} color={PROFILES[k].color} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{p.user.name}</span>
                      <span className="block truncate text-xs text-ink-500">{p.user.jobTitle ?? p.user.department?.name}</span>
                    </span>
                    <span className="flex w-16 shrink-0 flex-col items-end gap-1">
                      <span className="num text-xs font-semibold" style={{ color: INK[k] }}>
                        {p.scores[k]}%
                      </span>
                      <span className="h-1 w-full overflow-hidden rounded-full bg-ink-100">
                        <span className="block h-full rounded-full" style={{ width: `${p.scores[k]}%`, background: PROFILES[k].color }} />
                      </span>
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

/** O que a composição do time sugere, em linguagem simples */
const TEAM_TEXT: Record<ProfileKey, { high: string; low: string }> = {
  EXECUTOR: {
    high: 'Decide rápido e corre atrás de resultado. Cuidado para não atropelar processos e pessoas.',
    low: 'Pouca gente puxando decisões. Deixe claro quem decide e até quando.',
  },
  COMUNICADOR: {
    high: 'Conversa, engaja e vende ideias com facilidade. Cuidado com o foco e o acompanhamento até o fim.',
    low: 'Pouca gente animando e conectando o time. Reconhecimento e alinhamentos frequentes ajudam.',
  },
  PLANEJADOR: {
    high: 'Estável, colaborativo e confiável na rotina. Mudanças pedem tempo e explicação.',
    low: 'Pouca gente cuidando da rotina e da constância. Combine processos e responsáveis.',
  },
  ANALISTA: {
    high: 'Cuidadoso com qualidade, dados e detalhes. Cuidado com a demora para decidir.',
    low: 'Pouca gente revisando detalhes e números. Vale ter uma checagem antes das entregas.',
  },
};

function TeamReading({ average, total }: { average: Record<ProfileKey, number> | null; total: number }) {
  if (!average || !total)
    return (
      <Panel title="Como ler o mapa">
        <p className="p-4 text-[13px] leading-relaxed text-ink-600">Quando as pessoas fizerem o teste, elas aparecem aqui, cada uma no quadrante do seu perfil.</p>
      </Panel>
    );
  const sorted = [...PROFILE_KEYS].sort((a, b) => average[b] - average[a]);
  const top = sorted[0];
  const low = sorted[sorted.length - 1];
  return (
    <Panel title="Leitura do time" subtitle={`Com base em ${total} ${total === 1 ? 'pessoa' : 'pessoas'}`}>
      <div className="p-4">
        <div className="flex h-3 overflow-hidden rounded-full">
          {ORDER.map((k) => (
            <span key={k} style={{ width: `${average[k]}%`, background: PROFILES[k].color }} title={`${PROFILES[k].label} ${average[k]}%`} />
          ))}
        </div>
        <div className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-ink-600">
          {ORDER.map((k) => (
            <span key={k} className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: PROFILES[k].color }} />
              {PROFILES[k].label}
              <span className="num ml-auto font-medium text-ink-800">{average[k]}%</span>
            </span>
          ))}
        </div>
      </div>
      <div className="space-y-3 border-t border-ink-100 p-4 text-[13px] leading-relaxed">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: INK[top] }}>
            Mais forte: {PROFILES[top].label}
          </p>
          <p className="mt-0.5 text-ink-600">{TEAM_TEXT[top].high}</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: INK[low] }}>
            Menos presente: {PROFILES[low].label}
          </p>
          <p className="mt-0.5 text-ink-600">{TEAM_TEXT[low].low}</p>
        </div>
      </div>
      <p className="border-t border-ink-100 px-4 py-3 text-xs leading-relaxed text-ink-500">
        No alto, os mais ativos; embaixo, os mais ponderados. À esquerda o foco é a tarefa, à direita as pessoas. Quanto mais perto da borda, mais forte o perfil.
      </p>
    </Panel>
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
                <p className="font-semibold" style={{ color: INK[k] }}>
                  {PROFILES[k].label}
                </p>
                <p className="num font-display text-2xl font-bold text-ink-900">
                  {total ? Math.round((data.counts[k] / total) * 100) : 0}%
                </p>
              </div>
              <p className="text-xs text-ink-500">{PROFILES[k].tagline}</p>
              <div className="mt-3 flex items-center gap-2">
                {members.length ? <AvatarStack users={members.map((m) => m.user)} max={5} size={26} color={PROFILES[k].color} /> : <span className="text-xs text-ink-400">Ninguém ainda</span>}
                <span className="ml-auto text-xs text-ink-500">
                  <span className="num font-medium text-ink-700">{data.counts[k]}</span> {data.counts[k] === 1 ? 'pessoa' : 'pessoas'}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        {view === 'map' ? (
          <div className="card px-3 py-5 sm:px-8 sm:py-8">
            <Compass people={data.people} counts={data.counts} total={total} average={data.average} focus={focus} selected={selected} onSelect={setSelected} />
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
            <TeamReading average={data.average} total={total} />
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
