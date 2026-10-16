import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { ChevronsDownUp, ChevronsUpDown, Maximize, Minimize, MessageCircle, Minus, Plus, Scan, Search } from 'lucide-react';
import { ROLE_LABEL } from '@dumax/shared';
import { api } from '@/lib/api';
import type { UserLite } from '@/lib/types';
import { Avatar, Input, PageHeader, PageLoader, Tabs } from '@/components/ui';

interface ChartUser extends UserLite {
  managerId: string | null;
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

function PersonCard({ u, dept, reports, highlight }: { u: ChartUser; dept?: { name: string; color: string }; reports: number; highlight: boolean }) {
  const navigate = useNavigate();
  const openChat = async () => {
    const c = await api.post<{ id: string }>('/chat/direct', { userId: u.id });
    navigate(`/chat?c=${c.id}`);
  };
  return (
    <div
      data-person={u.id}
      className={clsx(
        'group relative w-56 rounded-lg border bg-white px-3 py-2.5 text-left transition-shadow',
        highlight ? 'border-brand-500 shadow-[0_0_0_3px_rgba(45,63,224,.18)]' : 'border-ink-200 hover:shadow-pop',
      )}
    >
      <span className="absolute inset-y-2 left-0 w-[3px] rounded-r" style={{ background: dept?.color ?? '#C9CFDC' }} />
      <div className="flex items-center gap-2.5">
        <Avatar user={u} size={36} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold">{u.name}</p>
          <p className="truncate text-xs text-ink-500">{u.jobTitle ?? ROLE_LABEL[u.role]}</p>
        </div>
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={openChat}
          title={`Conversar com ${u.name.split(' ')[0]}`}
          className="rounded p-1 text-ink-300 opacity-0 hover:bg-brand-50 hover:text-brand-600 group-hover:opacity-100"
        >
          <MessageCircle className="h-4 w-4" />
        </button>
      </div>
      <p className="mt-1.5 flex items-center justify-between text-2xs text-ink-500">
        <span className="truncate">{dept?.name ?? 'Sem área'}</span>
        {reports > 0 && <span className="num">{reports} direto{reports > 1 ? 's' : ''}</span>}
      </p>
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
  const [open, setOpen] = useState(depth < 2);
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
      <PersonCard u={u} dept={deptOf(u.departmentId)} reports={children.length} highlight={matches.has(u.id)} />
      {children.length > 0 && (
        <>
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setOpen((o) => !o)}
            className="num z-10 -mt-2.5 flex h-5 min-w-[20px] items-center justify-center rounded-full border border-ink-200 bg-white px-1 text-2xs text-ink-600 hover:border-brand-400 hover:text-brand-600"
            title={open ? 'Recolher' : 'Expandir'}
          >
            {open ? <Minus className="h-3 w-3" /> : children.length}
          </button>
          {open && (
            <>
              <div className="h-4 w-px bg-ink-300" />
              <div className="flex">
                {children.map((c, i) => (
                  <div key={c.id} className="relative flex flex-col items-center px-2.5">
                    {children.length > 1 && <div className={clsx('absolute top-0 h-px bg-ink-300', i === 0 ? 'left-1/2 right-0' : i === children.length - 1 ? 'left-0 right-1/2' : 'left-0 right-0')} />}
                    <div className="h-4 w-px bg-ink-300" />
                    <TreeNode u={c} byManager={byManager} deptOf={deptOf} matches={matches} depth={depth + 1} />
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
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
    const t = setTimeout(center, 30);
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
        <div ref={content} className="inline-flex gap-10 p-2" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: '0 0' }}>
          {children}
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
  const [fullscreen, setFullscreen] = useState(false);
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
  const matches = useMemo(() => new Set(search.trim().length > 1 ? (data?.users ?? []).filter((u) => `${u.name} ${u.jobTitle ?? ''}`.toLowerCase().includes(search.toLowerCase())).map((u) => u.id) : []), [data, search]);

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
      {matches.size > 0 && <span className="text-xs text-ink-500">{matches.size} encontrado(s)</span>}
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
          </div>
        </div>
      ) : (
        <AreasView data={data} />
      )}
    </div>
  );
}
