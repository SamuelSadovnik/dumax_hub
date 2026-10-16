import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { ChevronsDownUp, ChevronsUpDown, Maximize, Minimize, MessageCircle, Minus, Plus, Scan, Search, X } from 'lucide-react';
import { LEVELS, LEVEL_LABEL, ROLE_LABEL, levelRank, type Level } from '@dumax/shared';
import { api } from '@/lib/api';
import type { UserLite } from '@/lib/types';
import { Avatar, AvatarStack, Button, Drawer, Input, PageHeader, PageLoader, Tabs } from '@/components/ui';
import { useAuth } from '@/lib/auth';

interface ChartUser extends UserLite {
  managerId: string | null;
  level: string | null;
  departmentId: string | null;
  teamIds: string[];
}
interface ChartData {
  users: ChartUser[];
  departments: { id: string; name: string; color: string; parentId: string | null; headId: string | null }[];
  teams: { id: string; name: string; departmentId: string | null; leadId: string | null }[];
}

/** Controle global de expandir/recolher: muda a "versão" e cada nó reinicia pro estado pedido */
const ExpandCtx = createContext<{ version: number; all: boolean | null }>({ version: 0, all: null });
/** Clique numa pessoa abre o painel de detalhes */
const SelectCtx = createContext<(u: ChartUser) => void>(() => undefined);
const stop = (e: React.PointerEvent) => e.stopPropagation();
/** Mantém um cartão parado na tela enquanto a árvore muda (abrir/recolher equipe) */
const AnchorCtx = createContext<(el: HTMLElement | null, mutate: () => void) => void>((_el, mutate) => mutate());
const LINE = 'border-ink-300';

/** Nível do cargo com degraus de senioridade */
function LevelChip({ level }: { level: string }) {
  const rank = levelRank(level);
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-ink-100 px-2 py-0.5 text-2xs font-medium text-ink-700" title={`Nível: ${LEVEL_LABEL[level as Level] ?? level}`}>
      <span className="flex items-end gap-[1.5px]" aria-hidden>
        {[1, 2, 3, 4].map((i) => (
          <span key={i} className={clsx('w-[2.5px] rounded-sm', Math.ceil(rank / 2) >= i ? 'bg-brand-500' : 'bg-ink-300')} style={{ height: 3 + i * 2 }} />
        ))}
      </span>
      {LEVEL_LABEL[level as Level] ?? level}
    </span>
  );
}

/** Cartão-retrato: a foto é o centro; a faixa no topo é a cor da área */
function PersonCard({ u, dept, reports, highlight, open, onToggle, lead }: { u: ChartUser; dept?: { name: string; color: string }; reports: ChartUser[]; highlight: boolean; open: boolean; onToggle: (card: HTMLElement | null) => void; lead: boolean }) {
  const select = useContext(SelectCtx);
  return (
    <div
      data-person={u.id}
      className={clsx(
        'relative flex flex-col items-center rounded-2xl border bg-white px-3 pb-3 text-center shadow-card transition-shadow',
        lead ? 'w-[212px]' : 'w-[188px]',
        highlight ? 'border-brand-500 ring-4 ring-brand-500/15' : 'border-ink-200/80 hover:shadow-lift',
      )}
    >
      <span className="absolute inset-x-0 top-0 h-1.5 rounded-t-2xl" style={{ background: dept?.color ?? '#C9CFDC' }} />
      <button onPointerDown={stop} onClick={() => select(u)} className="mt-4 rounded-full" title={`Ver ${u.name.split(' ')[0]}`}>
        <Avatar user={u} size={lead ? 72 : 58} className="rounded-full ring-4 ring-white" />
      </button>
      <button onPointerDown={stop} onClick={() => select(u)} className="mt-2 w-full min-w-0">
        <p className={clsx('truncate font-semibold text-ink-900', lead ? 'text-[15px]' : 'text-[13.5px]')}>{u.name}</p>
        <p className="line-clamp-2 min-h-[32px] text-xs leading-4 text-ink-500">{u.jobTitle ?? ROLE_LABEL[u.role]}</p>
      </button>
      <div className="mt-2 flex max-w-full flex-wrap items-center justify-center gap-1">
        {dept && (
          <span className="max-w-full truncate rounded-full px-2 py-0.5 text-2xs font-medium" style={{ background: `${dept.color}17`, color: dept.color }}>
            {dept.name}
          </span>
        )}
        {u.level && <LevelChip level={u.level} />}
      </div>
      {reports.length > 0 && (
        <button
          onPointerDown={stop}
          onClick={(e) => onToggle(e.currentTarget.closest('[data-person]'))}
          className={clsx(
            'mt-3 flex h-8 w-full items-center justify-center gap-2 rounded-xl border text-2xs font-medium transition-colors',
            open ? 'border-ink-200 text-ink-500 hover:text-ink-800' : 'border-brand-200 bg-brand-50 text-brand-700 hover:border-brand-300',
          )}
        >
          {open ? (
            <>
              <Minus className="h-3 w-3" /> Recolher equipe
            </>
          ) : (
            <>
              <AvatarStack users={reports} max={3} size={18} />
              {reports.length} na equipe
            </>
          )}
        </button>
      )}
    </div>
  );
}

function TreeNode({
  u,
  byManager,
  deptOf,
  matches,
  depth,
}: {
  u: ChartUser;
  byManager: Map<string | null, ChartUser[]>;
  deptOf: (id: string | null) => { name: string; color: string } | undefined;
  matches: Set<string>;
  depth: number;
}) {
  const children = byManager.get(u.id) ?? [];
  const { version, all } = useContext(ExpandCtx);
  const anchor = useContext(AnchorCtx);
  const [open, setOpen] = useState(depth < 1);
  useEffect(() => {
    if (all !== null) setOpen(all);
  }, [version, all]);
  // abre o caminho até quem foi buscado
  const hasMatchBelow = useMemo(() => {
    if (!matches.size) return false;
    const stack = [...children];
    while (stack.length) {
      const c = stack.pop()!;
      if (matches.has(c.id)) return true;
      stack.push(...(byManager.get(c.id) ?? []));
    }
    return false;
  }, [matches, children, byManager]);
  useEffect(() => {
    if (hasMatchBelow) setOpen(true);
  }, [hasMatchBelow]);

  return (
    <div className="flex flex-col items-center">
      <PersonCard u={u} dept={deptOf(u.departmentId)} reports={children} highlight={matches.has(u.id)} open={open} onToggle={(el) => anchor(el, () => setOpen((o) => !o))} lead={depth === 0} />
      {children.length > 0 && open && (
        <>
          <div className={clsx('h-6 border-l-2', LINE)} />
          <div className="flex">
            {children.map((c, i) => {
              const first = i === 0;
              const last = i === children.length - 1;
              return (
                <div key={c.id} className="relative flex flex-col items-center px-3 pt-6">
                  {children.length === 1 ? (
                    <span className={clsx('absolute left-1/2 top-0 h-6 -translate-x-px border-l-2', LINE)} />
                  ) : first ? (
                    <span className={clsx('absolute left-1/2 right-0 top-0 h-6 -translate-x-px rounded-tl-2xl border-l-2 border-t-2', LINE)} />
                  ) : last ? (
                    <span className={clsx('absolute left-0 right-1/2 top-0 h-6 translate-x-px rounded-tr-2xl border-r-2 border-t-2', LINE)} />
                  ) : (
                    <>
                      <span className={clsx('absolute inset-x-0 top-0 border-t-2', LINE)} />
                      <span className={clsx('absolute left-1/2 top-0 h-6 -translate-x-px border-l-2', LINE)} />
                    </>
                  )}
                  <TreeNode u={c} byManager={byManager} deptOf={deptOf} matches={matches} depth={depth + 1} />
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

/** Painel lateral da pessoa: quem é, a quem responde, quem está abaixo */
function PersonDrawer({ u, data, onSelect, onClose }: { u: ChartUser; data: ChartData; onSelect: (u: ChartUser) => void; onClose: () => void }) {
  const navigate = useNavigate();
  const { isAdminPortal } = useAuth();
  const dept = data.departments.find((d) => d.id === u.departmentId);
  const manager = data.users.find((x) => x.id === u.managerId);
  const reports = data.users.filter((x) => x.managerId === u.id);
  const teams = data.teams.filter((t) => u.teamIds.includes(t.id));
  const openChat = async () => {
    const c = await api.post<{ id: string }>('/chat/direct', { userId: u.id });
    navigate(`/chat?c=${c.id}`);
  };
  const Row = ({ p, note }: { p: ChartUser; note?: string }) => (
    <button onClick={() => onSelect(p)} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-ink-50">
      <Avatar user={p} size={36} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{p.name}</span>
        <span className="block truncate text-xs text-ink-500">{note ?? p.jobTitle ?? ROLE_LABEL[p.role]}</span>
      </span>
    </button>
  );
  return (
    <Drawer open onClose={onClose} width={400}>
      <div className="relative">
        <div className="h-24" style={{ background: `linear-gradient(135deg, ${dept?.color ?? '#2D3FE0'}, ${dept?.color ?? '#2D3FE0'}99)` }} />
        <button onClick={onClose} className="absolute right-3 top-3 rounded-lg bg-white/20 p-1.5 text-white hover:bg-white/30" aria-label="Fechar">
          <X className="h-4 w-4" />
        </button>
        <div className="-mt-12 flex flex-col items-center px-6 text-center">
          <Avatar user={u} size={96} className="rounded-full ring-4 ring-white" />
          <h2 className="mt-3 text-xl font-bold">{u.name}</h2>
          <p className="text-sm text-ink-500">{u.jobTitle ?? ROLE_LABEL[u.role]}</p>
          <div className="mt-2 flex flex-wrap justify-center gap-1.5">
            {dept && (
              <span className="rounded-full px-2.5 py-0.5 text-xs font-medium" style={{ background: `${dept.color}17`, color: dept.color }}>
                {dept.name}
              </span>
            )}
            {u.level && <LevelChip level={u.level} />}
          </div>
          <div className="mt-4 flex gap-2">
            <Button size="sm" icon={<MessageCircle className="h-4 w-4" />} onClick={openChat}>
              Conversar
            </Button>
            {isAdminPortal && (
              <Button size="sm" variant="secondary" onClick={() => navigate(`/admin/desempenho/${u.id}`)}>
                Ver desempenho
              </Button>
            )}
          </div>
        </div>
      </div>
      <div className="scroll-thin mt-6 flex-1 space-y-5 overflow-y-auto px-4 pb-6">
        {manager && (
          <section>
            <p className="mb-1 px-2 text-xs font-medium text-ink-500">Responde a</p>
            <Row p={manager} />
          </section>
        )}
        {reports.length > 0 && (
          <section>
            <p className="mb-1 px-2 text-xs font-medium text-ink-500">Equipe direta ({reports.length})</p>
            {reports.map((p) => (
              <Row key={p.id} p={p} />
            ))}
          </section>
        )}
        {teams.length > 0 && (
          <section>
            <p className="mb-2 px-2 text-xs font-medium text-ink-500">Times</p>
            <div className="flex flex-wrap gap-1.5 px-2">
              {teams.map((t) => (
                <span key={t.id} className="rounded-full bg-ink-100 px-2.5 py-1 text-xs text-ink-700">
                  {t.name}
                </span>
              ))}
            </div>
          </section>
        )}
      </div>
    </Drawer>
  );
}

/** Tela com arrastar para mover e zoom (Ctrl/⌘ + roda, ou botões) */
function Canvas({ children, fullscreen, toolbar }: { children: React.ReactNode; fullscreen: boolean; toolbar: (api: { zoom: number; setZoom: (z: number) => void; fit: () => void; center: () => void }) => React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [zoom, setZoomState] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 24 });
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const setZoom = (z: number) => setZoomState(Math.min(1.6, Math.max(0.25, Number(z.toFixed(2)))));
  const anchor = useCallback((el: HTMLElement | null, mutate: () => void) => {
    const before = el?.getBoundingClientRect();
    mutate();
    if (!el || !before) return;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const after = el.getBoundingClientRect();
        setPan((p) => ({ x: p.x + before.left - after.left, y: p.y + before.top - after.top }));
      }),
    );
  }, []);

  const center = useCallback(() => {
    if (!box.current || !content.current) return;
    const bw = box.current.clientWidth;
    const cw = content.current.scrollWidth * zoom;
    setPan({ x: (bw - cw) / 2, y: 24 });
  }, [zoom]);
  const fit = useCallback(() => {
    if (!box.current || !content.current) return;
    const z = Math.min(1, (box.current.clientWidth - 48) / content.current.scrollWidth, (box.current.clientHeight - 48) / content.current.scrollHeight);
    const nz = Math.max(0.25, Number(z.toFixed(2)));
    setZoomState(nz);
    setPan({ x: (box.current.clientWidth - content.current.scrollWidth * nz) / 2, y: 24 });
  }, []);

  useEffect(() => {
    const t = setTimeout(fit, 60);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullscreen]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setPan((p) => ({ x: p.x - e.deltaX, y: p.y - e.deltaY }));
        return;
      }
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const my = e.clientY - r.top;
      setZoomState((z) => {
        const nz = Math.min(1.6, Math.max(0.25, z * (e.deltaY < 0 ? 1.1 : 0.9)));
        setPan((p) => ({ x: mx - ((mx - p.x) / z) * nz, y: my - ((my - p.y) / z) * nz }));
        return nz;
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  return (
    <div className={clsx('relative flex flex-col overflow-hidden bg-[radial-gradient(#DCE1EA_1px,transparent_1px)] [background-size:18px_18px]', fullscreen ? 'h-full' : 'h-[calc(100vh-230px)] min-h-[480px] rounded-lg border border-ink-200')}>
      <div className="absolute right-3 top-3 z-20">{toolbar({ zoom, setZoom, fit, center })}</div>
      <div
        ref={box}
        className="flex-1 cursor-grab select-none active:cursor-grabbing"
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          setPan({ x: drag.current.px + e.clientX - drag.current.x, y: drag.current.py + e.clientY - drag.current.y });
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
      >
        <div ref={content} className="inline-flex items-start gap-12 p-2" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: '0 0' }}>
          <AnchorCtx.Provider value={anchor}>{children}</AnchorCtx.Provider>
        </div>
      </div>
    </div>
  );
}

function AreasView({ data }: { data: ChartData }) {
  return (
    <div className="space-y-4">
      {data.departments.map((d) => {
        const members = data.users.filter((u) => u.departmentId === d.id);
        const head = data.users.find((u) => u.id === d.headId);
        const teams = data.teams.filter((t) => t.departmentId === d.id);
        const noTeam = members.filter((u) => !teams.some((t) => u.teamIds.includes(t.id)));
        return (
          <section key={d.id} className="card overflow-hidden">
            <header className="flex flex-wrap items-center gap-3 border-b border-ink-100 px-4 py-3">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: d.color }} />
              <h3 className="font-semibold">{d.name}</h3>
              <span className="text-[13px] text-ink-500">
                {members.length} pessoas · {teams.length} times
              </span>
              {head && (
                <span className="ml-auto flex items-center gap-2 text-[13px] text-ink-600">
                  <Avatar user={head} size={22} /> {head.name}
                  <span className="text-ink-400">responsável</span>
                </span>
              )}
            </header>
            <div className="grid divide-y divide-ink-100 md:grid-cols-2 md:divide-x md:divide-y-0 xl:grid-cols-3">
              {[...teams.map((t) => ({ key: t.id, name: t.name, lead: data.users.find((u) => u.id === t.leadId), people: data.users.filter((u) => u.teamIds.includes(t.id)) })), ...(noTeam.length ? [{ key: `${d.id}-none`, name: 'Sem time', lead: undefined, people: noTeam }] : [])].map((t) => (
                <div key={t.key} className="px-4 py-3">
                  <p className="text-[13px] font-medium">
                    {t.name}
                    {t.lead && <span className="font-normal text-ink-500"> · líder {t.lead.name.split(' ')[0]}</span>}
                  </p>
                  <ul className="mt-2 space-y-1.5">
                    {t.people.map((u) => (
                      <li key={u.id} className="flex items-center gap-2 text-[13px]">
                        <Avatar user={u} size={22} />
                        <span className="truncate">{u.name}</span>
                        <span className="ml-auto truncate text-xs text-ink-500">{u.jobTitle}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export default function OrgChart() {
  const [view, setView] = useState<'tree' | 'areas'>('tree');
  const [search, setSearch] = useState('');
  const [dept, setDept] = useState('');
  const [level, setLevel] = useState('');
  const [fullscreen, setFullscreen] = useState(false);
  const [selected, setSelected] = useState<ChartUser | null>(null);
  const [expand, setExpand] = useState<{ version: number; all: boolean | null }>({ version: 0, all: null });
  const wrap = useRef<HTMLDivElement>(null);
  const { data, isLoading } = useQuery({ queryKey: ['org-chart'], queryFn: () => api.get<ChartData>('/org/chart') });

  const { roots, byManager } = useMemo(() => {
    const users = (data?.users ?? []).filter((u) => !dept || u.departmentId === dept);
    const byManager = new Map<string | null, ChartUser[]>();
    const ids = new Set(users.map((u) => u.id));
    for (const u of users) {
      const key = u.managerId && ids.has(u.managerId) ? u.managerId : null;
      byManager.set(key, [...(byManager.get(key) ?? []), u]);
    }
    return { roots: byManager.get(null) ?? [], byManager };
  }, [data, dept]);
  const matches = useMemo(
    () =>
      new Set(
        search.trim().length > 1 || level
          ? (data?.users ?? [])
              .filter((u) => (search.trim().length < 2 || `${u.name} ${u.jobTitle ?? ''}`.toLowerCase().includes(search.toLowerCase())) && (!level || u.level === level))
              .map((u) => u.id)
          : [],
      ),
    [data, search, level],
  );

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === wrap.current);
    document.addEventListener('fullscreenchange', onChange);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !document.fullscreenElement && setFullscreen(false);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      window.removeEventListener('keydown', onKey);
    };
  }, []);
  const toggleFullscreen = async () => {
    if (fullscreen) {
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined);
      setFullscreen(false);
    } else {
      setFullscreen(true);
      await wrap.current?.requestFullscreen?.().catch(() => undefined);
    }
  };

  if (isLoading || !data) return <PageLoader />;
  const deptOf = (id: string | null) => data.departments.find((d) => d.id === id);

  const filters = (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
        <Input className="h-8 w-56 pl-8" placeholder="Encontrar pessoa ou cargo" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <select value={dept} onChange={(e) => setDept(e.target.value)} className="input h-8 w-48">
        <option value="">Todas as áreas</option>
        {data.departments.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>
      <select value={level} onChange={(e) => setLevel(e.target.value)} className="input h-8 w-44" aria-label="Destacar nível">
        <option value="">Todos os níveis</option>
        {LEVELS.map((l) => (
          <option key={l} value={l}>
            {LEVEL_LABEL[l]}
          </option>
        ))}
      </select>
      {matches.size > 0 && <span className="text-xs text-ink-500">{matches.size} {matches.size === 1 ? 'pessoa destacada' : 'pessoas destacadas'}</span>}
    </div>
  );

  return (
    <div className="space-y-4">
      {!fullscreen && (
        <PageHeader
          title="Organograma"
          subtitle={`${data.users.length} pessoas · ${data.departments.length} áreas · ${data.teams.length} times`}
          actions={
            <Tabs
              value={view}
              onChange={setView}
              items={[
                { value: 'tree', label: 'Hierarquia' },
                { value: 'areas', label: 'Áreas e times' },
              ]}
            />
          }
        />
      )}
      {view === 'tree' ? (
        <div ref={wrap} className={clsx(fullscreen && 'fixed inset-0 z-50 flex flex-col bg-canvas')}>
          <div className={clsx('flex flex-wrap items-center gap-3', fullscreen ? 'border-b border-ink-200 bg-white px-4 py-2.5' : 'mb-3')}>
            {fullscreen && <p className="mr-2 font-semibold">Organograma</p>}
            {filters}
          </div>
          <div className={clsx(fullscreen && 'flex-1')}>
            <SelectCtx.Provider value={setSelected}>
            <ExpandCtx.Provider value={expand}>
              <Canvas
                fullscreen={fullscreen}
                toolbar={({ zoom, setZoom, fit, center }) => (
                  <div className="flex items-center gap-0.5 rounded-lg border border-ink-200 bg-white p-0.5 shadow-sm" onPointerDown={(e) => e.stopPropagation()}>
                    <button title="Diminuir" onClick={() => setZoom(zoom - 0.1)} className="rounded p-1.5 hover:bg-ink-100">
                      <Minus className="h-4 w-4" />
                    </button>
                    <button title="Voltar para 100%" onClick={() => setZoom(1)} className="num w-12 rounded py-1 text-center text-xs hover:bg-ink-100">
                      {Math.round(zoom * 100)}%
                    </button>
                    <button title="Aumentar" onClick={() => setZoom(zoom + 0.1)} className="rounded p-1.5 hover:bg-ink-100">
                      <Plus className="h-4 w-4" />
                    </button>
                    <span className="mx-0.5 h-5 w-px bg-ink-200" />
                    <button title="Caber na tela" onClick={fit} className="rounded p-1.5 hover:bg-ink-100">
                      <Scan className="h-4 w-4" />
                    </button>
                    <button title="Expandir tudo" onClick={() => { setExpand((e) => ({ version: e.version + 1, all: true })); setTimeout(center, 50); }} className="rounded p-1.5 hover:bg-ink-100">
                      <ChevronsUpDown className="h-4 w-4" />
                    </button>
                    <button title="Recolher" onClick={() => { setExpand((e) => ({ version: e.version + 1, all: false })); setTimeout(center, 50); }} className="rounded p-1.5 hover:bg-ink-100">
                      <ChevronsDownUp className="h-4 w-4" />
                    </button>
                    <span className="mx-0.5 h-5 w-px bg-ink-200" />
                    <button title={fullscreen ? 'Sair da tela cheia (Esc)' : 'Tela cheia'} onClick={toggleFullscreen} className="rounded p-1.5 hover:bg-ink-100">
                      {fullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
                    </button>
                  </div>
                )}
              >
                {roots.map((r) => (
                  <TreeNode key={r.id} u={r} byManager={byManager} deptOf={deptOf} matches={matches} depth={0} />
                ))}
              </Canvas>
            </ExpandCtx.Provider>
            </SelectCtx.Provider>
          </div>
        </div>
      ) : (
        <AreasView data={data} />
      )}
      {selected && <PersonDrawer u={selected} data={data} onSelect={setSelected} onClose={() => setSelected(null)} />}
    </div>
  );
}
