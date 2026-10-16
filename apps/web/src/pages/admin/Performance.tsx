import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowDown, ArrowUp, ArrowUpDown, Info } from 'lucide-react';
import { FLAG_COLOR, SCORE_LEVELS, SCORE_WEIGHTS, formatMinutes, scoreLevel, type ScoreLevel } from '@dumax/shared';
import { api } from '@/lib/api';
import type { Department, PerformanceOverview, Team } from '@/lib/types';
import { pct } from '@/lib/format';
import { Avatar, PageHeader, PageLoader, Panel, Select, StatCard, Tabs } from '@/components/ui';

type SortKey = 'score' | 'delta' | 'utilization' | 'untracked' | 'onTime' | 'overdue' | 'punctuality' | 'name';

const PERIODS = [
  { value: '7', label: '7 dias' },
  { value: '30', label: '30 dias' },
  { value: '90', label: '90 dias' },
] as const;

/** Barra fina 0–100% com cor por faixa */
function Meter({ value, good = 0.8, warn = 0.6 }: { value: number | null; good?: number; warn?: number }) {
  if (value === null) return <span className="text-ink-300">—</span>;
  const color = value >= good ? '#1F9254' : value >= warn ? '#C77700' : '#D93036';
  return (
    <span className="flex items-center gap-2">
      <span className="num w-9 text-right text-[13px]">{Math.round(value * 100)}%</span>
      <span className="h-1.5 w-14 rounded-full bg-ink-100">
        <span className="block h-full rounded-full" style={{ width: `${Math.min(1, value) * 100}%`, background: color }} />
      </span>
    </span>
  );
}

function ScoreCell({ score, delta }: { score: number | null; delta: number | null }) {
  const lvl = scoreLevel(score);
  return (
    <span className="flex items-center gap-2">
      <span className="num inline-flex h-7 w-10 items-center justify-center rounded-md text-sm font-semibold" style={{ background: lvl ? `${lvl.color}14` : '#EEF0F4', color: lvl?.color ?? '#9AA1B5' }}>
        {score ?? '—'}
      </span>
      {delta !== null && delta !== 0 && (
        <span className={clsx('num flex items-center text-xs', delta > 0 ? 'text-ok' : 'text-bad')}>
          {delta > 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
          {Math.abs(delta)}
        </span>
      )}
    </span>
  );
}

export default function Performance() {
  const navigate = useNavigate();
  const [days, setDays] = useState<'7' | '30' | '90'>('30');
  const [departmentId, setDepartmentId] = useState('');
  const [teamId, setTeamId] = useState('');
  const [level, setLevel] = useState<ScoreLevel | ''>('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'score', dir: 1 });
  const [showMethod, setShowMethod] = useState(false);

  const { data: depts = [] } = useQuery({ queryKey: ['departments'], queryFn: () => api.get<Department[]>('/org/departments') });
  const { data: teams = [] } = useQuery({ queryKey: ['teams'], queryFn: () => api.get<Team[]>('/org/teams') });
  const { data, isLoading } = useQuery({
    queryKey: ['performance', days, departmentId, teamId],
    queryFn: () => api.get<PerformanceOverview>('/performance/overview', { days, departmentId, teamId }),
  });

  const rows = useMemo(() => {
    const list = (data?.people ?? []).filter((p) => !level || p.level === level);
    const val = (p: (typeof list)[number]): number | string => {
      switch (sort.key) {
        case 'name': return p.user.name;
        case 'score': return p.score ?? 999;
        case 'delta': return p.delta ?? 0;
        case 'utilization': return p.metrics.utilization ?? 9;
        case 'untracked': return -p.metrics.untrackedMinutes;
        case 'onTime': return p.metrics.onTimeRate ?? 9;
        case 'overdue': return -p.metrics.overdueOpen;
        case 'punctuality': return p.metrics.punctuality ?? 9;
      }
    };
    return [...list].sort((a, b) => {
      const x = val(a);
      const y = val(b);
      return (typeof x === 'string' ? x.localeCompare(y as string) : x - (y as number)) * sort.dir;
    });
  }, [data, level, sort]);

  if (isLoading || !data) return <PageLoader />;
  const s = data.summary;
  const th = (key: SortKey, label: string, className?: string) => (
    <th className={className}>
      <button onClick={() => setSort((cur) => ({ key, dir: cur.key === key ? (cur.dir === 1 ? -1 : 1) : 1 }))} className="inline-flex items-center gap-1 hover:text-ink-800">
        {label}
        {sort.key === key ? sort.dir === 1 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" /> : <ArrowUpDown className="h-3 w-3 opacity-40" />}
      </button>
    </th>
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Visão geral do time"
        subtitle={`${s.people} pessoas · ${days === '7' ? 'últimos 7 dias' : days === '30' ? 'últimos 30 dias' : 'últimos 90 dias'} comparados ao período anterior`}
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
            <Tabs size="sm" value={days} onChange={setDays} items={PERIODS.map((p) => ({ ...p }))} />
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard
          label="Nota média"
          value={s.avgScore !== null ? Math.round(s.avgScore) : '—'}
          delta={s.avgScore !== null && s.prevAvgScore !== null ? s.avgScore - s.prevAvgScore : null}
          hint="de 0 a 100"
        />
        <StatCard
          label="Horas sem registro"
          value={formatMinutes(s.untrackedHours * 60)}
          tone={s.workedHours && s.untrackedHours / s.workedHours > 0.3 ? 'danger' : 'default'}
          hint={s.workedHours ? `${Math.round((s.untrackedHours / s.workedHours) * 100)}% das ${Math.round(s.workedHours)}h trabalhadas` : undefined}
        />
        <StatCard label="Entregas no prazo" value={pct(s.avgOnTime)} hint={`${s.tasksDone} demandas entregues`} />
        <StatCard label="Atrasadas em aberto" value={s.overdueOpen} tone={s.overdueOpen ? 'danger' : 'default'} />
        <StatCard label="Pontualidade" value={pct(s.avgPunctuality)} hint="dias sem atraso" />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Panel
          title="Pessoas"
          subtitle="Clique numa linha para ver o raio-x da pessoa"
          actions={
            <div className="flex items-center gap-1">
              {SCORE_LEVELS.map((l) => (
                <button
                  key={l.key}
                  onClick={() => setLevel(level === l.key ? '' : l.key)}
                  className={clsx('flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition', level === l.key ? 'border-ink-900 bg-ink-900 text-white' : 'border-ink-200 text-ink-600 hover:border-ink-300')}
                >
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: l.color }} />
                  {l.label}
                  <span className="num opacity-70">{s.distribution[l.key]}</span>
                </button>
              ))}
            </div>
          }
        >
          <div className="scroll-thin overflow-x-auto">
            <table className="tbl min-w-[880px]">
              <thead>
                <tr>
                  {th('name', 'Pessoa')}
                  {th('score', 'Nota')}
                  {th('utilization', 'Tempo com atividade')}
                  {th('untracked', 'Sem registro')}
                  {th('onTime', 'No prazo')}
                  {th('overdue', 'Atrasadas')}
                  {th('punctuality', 'Pontualidade')}
                  <th>Alerta principal</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const top = p.flags.find((f) => f.severity !== 'positive') ?? p.flags[0];
                  return (
                    <tr key={p.user.id} className="clickable" onClick={() => navigate(`/admin/desempenho/${p.user.id}?days=${days}`)}>
                      <td>
                        <span className="flex items-center gap-2.5">
                          <Avatar user={p.user} size={28} />
                          <span className="min-w-0">
                            <span className="block truncate font-medium">{p.user.name}</span>
                            <span className="block truncate text-xs text-ink-500">{p.user.department?.name ?? p.user.jobTitle}</span>
                          </span>
                        </span>
                      </td>
                      <td>
                        <ScoreCell score={p.score} delta={p.delta} />
                      </td>
                      <td>
                        <Meter value={p.metrics.utilization} good={0.75} warn={0.6} />
                      </td>
                      <td className={clsx('num text-[13px]', p.metrics.untrackedMinutes > 10 * 60 && 'font-medium text-bad')}>{p.metrics.workedMinutes ? formatMinutes(p.metrics.untrackedMinutes) : '—'}</td>
                      <td>
                        <Meter value={p.metrics.onTimeRate} />
                      </td>
                      <td className={clsx('num text-[13px]', p.metrics.overdueOpen ? 'font-medium text-bad' : 'text-ink-400')}>{p.metrics.overdueOpen}</td>
                      <td>
                        <Meter value={p.metrics.punctuality} good={0.9} warn={0.75} />
                      </td>
                      <td className="max-w-[260px]">
                        {top ? (
                          <span className="flex items-center gap-1.5 text-[13px] text-ink-600">
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: FLAG_COLOR[top.severity] }} />
                            <span className="truncate" title={top.message}>
                              {top.message}
                            </span>
                          </span>
                        ) : (
                          <span className="text-xs text-ink-400">Sem alertas</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>

        <div className="space-y-5">
          <Panel title="Onde agir primeiro" subtitle={`${data.insights.filter((i) => i.severity === 'high').length} alertas críticos`}>
            <ul className="scroll-thin max-h-[520px] overflow-y-auto">
              {data.insights
                .filter((i) => i.severity !== 'low')
                .slice(0, 20)
                .map((i, idx) => (
                  <li key={idx}>
                    <Link to={`/admin/desempenho/${i.user.id}?days=${days}`} className="flex gap-3 border-b border-ink-100 px-4 py-2.5 last:border-0 hover:bg-ink-50">
                      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: FLAG_COLOR[i.severity] }} />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{i.user.name}</span>
                        <span className="block text-[13px] text-ink-600">{i.message}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              {!data.insights.length && <li className="px-4 py-5 text-sm text-ink-500">Nenhum alerta no período.</li>}
            </ul>
          </Panel>

          <Panel
            title="Como a nota é calculada"
            actions={
              <button onClick={() => setShowMethod((v) => !v)} className="text-ink-400 hover:text-ink-700" aria-label="Mostrar método">
                <Info className="h-4 w-4" />
              </button>
            }
          >
            <div className={clsx('px-4 py-3 text-[13px] text-ink-600', !showMethod && 'line-clamp-2')}>
              <p>Média ponderada de cinco fatores no período, com desconto de 3 pontos por demanda atrasada em aberto (máximo 15). Fatores sem dado são ignorados.</p>
              <table className="mt-3 w-full">
                <tbody>
                  {(
                    [
                      ['Tempo com atividade registrada', 'utilization', 'horas registradas + reuniões ÷ horas do ponto'],
                      ['Entregas no prazo', 'onTime', '% concluídas até o prazo'],
                      ['Volume entregue', 'throughput', 'comparado à mediana do grupo'],
                      ['Metas', 'goals', 'progresso médio das metas'],
                      ['Pontualidade', 'punctuality', 'dias sem atraso no ponto'],
                    ] as const
                  ).map(([label, key, how]) => (
                    <tr key={key} className="border-t border-ink-100">
                      <td className="py-1.5 pr-2">
                        <span className="block font-medium text-ink-800">{label}</span>
                        <span className="text-xs text-ink-500">{how}</span>
                      </td>
                      <td className="num py-1.5 text-right font-medium">{Math.round(SCORE_WEIGHTS[key] * 100)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
