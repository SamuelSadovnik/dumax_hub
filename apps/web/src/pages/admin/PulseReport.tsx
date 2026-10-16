import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import clsx from 'clsx';
import { toast } from 'sonner';
import { Lock, Send } from 'lucide-react';
import { PULSE_SCALE } from '@dumax/shared';
import { api, errorMessage } from '@/lib/api';
import { fmtDayKey, pct } from '@/lib/format';
import { Button, EmptyState, PageHeader, PageLoader, Panel, Tabs } from '@/components/ui';

interface Report {
  headcount: number;
  minGroup: number;
  series: { id: string; weekStart: string; status: string; question: string; responses: number; participation: number; average: number | null; distribution: number[]; happinessIndex: number | null }[];
  byDepartment: { id: string; name: string; color: string; responses: number; average: number | null; hidden: boolean }[];
  comments: { id: string; weekStart: string; score: number; comment: string; author: string | null }[];
}

const SCORE_COLOR = ['#D93036', '#E5732E', '#B8A200', '#5FA83A', '#1F9254'];
const axis = { fontSize: 11, fill: '#8A93AD' };
type CommentFilter = 'all' | 'low' | 'mid' | 'high';

function scoreTone(v: number | null) {
  if (v === null) return 'text-ink-400';
  return v >= 4 ? 'text-ok' : v >= 3 ? 'text-ink-900' : 'text-bad';
}

export default function PulseReport() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<CommentFilter>('all');
  const { data, isLoading } = useQuery({ queryKey: ['pulse-report'], queryFn: () => api.get<Report>('/pulse/report', { weeks: 12 }) });
  const openNow = useMutation({
    mutationFn: () => api.post<{ created: boolean }>('/pulse/open-now', {}),
    onSuccess: (r) => {
      toast.success(r.created ? 'Pulse aberto e enviado para todos' : 'O pulse desta semana já está aberto');
      qc.invalidateQueries({ queryKey: ['pulse-report'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (isLoading || !data) return <PageLoader />;
  const answered = data.series.filter((s) => s.responses > 0);
  const last = answered[answered.length - 1];
  const prev = answered[answered.length - 2];
  const delta = last?.average != null && prev?.average != null ? last.average - prev.average : null;
  const open = data.series.find((s) => s.status === 'OPEN');
  const chart = data.series.map((s) => ({ label: fmtDayKey(s.weekStart, 'dd/MM'), media: s.average ? Number(s.average.toFixed(2)) : null, participacao: Math.round(s.participation * 100) }));
  const comments = data.comments.filter((c) => filter === 'all' || (filter === 'low' ? c.score <= 2 : filter === 'mid' ? c.score === 3 : c.score >= 4));

  const stats = [
    { label: 'Média da última semana', value: last?.average != null ? last.average.toFixed(2) : '—', tone: scoreTone(last?.average ?? null), sub: delta !== null ? `${delta >= 0 ? '+' : ''}${delta.toFixed(2)} vs. anterior` : 'escala de 1 a 5' },
    { label: 'Participação', value: pct(last?.participation), tone: '', sub: `${last?.responses ?? 0} de ${data.headcount} pessoas` },
    { label: 'Índice de felicidade', value: last?.happinessIndex ?? '—', tone: (last?.happinessIndex ?? 0) < 0 ? 'text-bad' : 'text-ok', sub: '% satisfeitos − % insatisfeitos' },
    { label: 'Pulse aberto', value: open ? `${open.responses} resp.` : 'nenhum', tone: '', sub: open ? `semana de ${fmtDayKey(open.weekStart, 'dd/MM')}` : 'abre toda sexta' },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Clima do time"
        subtitle="Pulse semanal anônimo, enviado toda sexta-feira"
        actions={
          <Button icon={<Send className="h-4 w-4" />} loading={openNow.isPending} onClick={() => openNow.mutate()}>
            Abrir pulse agora
          </Button>
        }
      />

      <div className="grid grid-cols-2 overflow-hidden rounded-lg border border-ink-200 bg-white lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="border-b border-r border-ink-100 px-5 py-4 lg:border-b-0">
            <p className="text-[13px] text-ink-500">{s.label}</p>
            <p className={clsx('num mt-1 text-2xl font-semibold', s.tone)}>{s.value}</p>
            <p className="mt-0.5 text-xs text-ink-500">{s.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Panel title="Média e participação" subtitle="Últimas 12 semanas">
          <div className="h-64 px-2 pb-3 pt-4">
            <ResponsiveContainer>
              <ComposedChart data={chart}>
                <CartesianGrid vertical={false} stroke="#EEF1F6" />
                <XAxis dataKey="label" tick={axis} axisLine={false} tickLine={false} />
                <YAxis yAxisId="l" domain={[1, 5]} ticks={[1, 2, 3, 4, 5]} tick={axis} axisLine={false} tickLine={false} width={24} />
                <YAxis yAxisId="r" orientation="right" domain={[0, 100]} tick={axis} axisLine={false} tickLine={false} width={34} unit="%" />
                <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #E3E7EF', fontSize: 12 }} />
                <Bar yAxisId="r" dataKey="participacao" name="Participação %" fill="#E3E7EF" radius={[3, 3, 0, 0]} barSize={18} />
                <Line yAxisId="l" dataKey="media" name="Média" stroke="#2D3FE0" strokeWidth={2} dot={{ r: 3, fill: '#2D3FE0' }} connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel
          title="Por área"
          subtitle={
            <span className="flex items-center gap-1">
              <Lock className="h-3 w-3" /> Áreas com menos de {data.minGroup} respostas ficam ocultas
            </span>
          }
        >
          {data.byDepartment.length ? (
            <table className="tbl">
              <tbody>
                {[...data.byDepartment]
                  .sort((a, b) => (a.average ?? 9) - (b.average ?? 9))
                  .map((d) => (
                    <tr key={d.id}>
                      <td>
                        <span className="flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full" style={{ background: d.color }} />
                          {d.name}
                        </span>
                      </td>
                      <td className="num text-right text-xs text-ink-500">{d.responses} resp.</td>
                      <td className={clsx('num w-14 text-right font-semibold', scoreTone(d.average))}>{d.hidden ? <Lock className="ml-auto h-3.5 w-3.5 text-ink-400" /> : d.average!.toFixed(1)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          ) : (
            <p className="px-4 py-4 text-sm text-ink-500">Sem respostas na última semana.</p>
          )}
        </Panel>
      </div>

      <Panel title="Semanas">
        <table className="tbl">
          <thead>
            <tr>
              <th>Semana</th>
              <th>Pergunta</th>
              <th className="w-[22%]">Distribuição</th>
              <th className="text-right">Respostas</th>
              <th className="text-right">Média</th>
            </tr>
          </thead>
          <tbody>
            {[...data.series].reverse().map((s) => (
              <tr key={s.id}>
                <td className="num whitespace-nowrap">
                  {fmtDayKey(s.weekStart, 'dd/MM')}
                  {s.status === 'OPEN' && <span className="ml-2 text-2xs font-medium text-brand-600">aberto</span>}
                </td>
                <td className="max-w-md truncate text-ink-600">{s.question}</td>
                <td>
                  <div className="flex h-2 overflow-hidden rounded-full bg-ink-100">
                    {s.distribution.map((v, i) => (v ? <div key={i} title={`Nota ${i + 1}: ${v}`} style={{ width: `${(v / (s.responses || 1)) * 100}%`, background: SCORE_COLOR[i] }} /> : null))}
                  </div>
                </td>
                <td className="num text-right text-ink-600">
                  {s.responses} <span className="text-ink-400">({pct(s.participation)})</span>
                </td>
                <td className={clsx('num text-right font-semibold', scoreTone(s.average))}>{s.average?.toFixed(2) ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel
        title="Comentários"
        subtitle={`${data.comments.length} nas últimas 12 semanas`}
        actions={
          <Tabs
            size="sm"
            value={filter}
            onChange={setFilter}
            items={[
              { value: 'all', label: 'Todos' },
              { value: 'low', label: 'Notas 1–2', count: data.comments.filter((c) => c.score <= 2).length },
              { value: 'mid', label: 'Nota 3' },
              { value: 'high', label: 'Notas 4–5' },
            ]}
          />
        }
      >
        {comments.length ? (
          <ul className="divide-y divide-ink-100">
            {comments.map((c) => (
              <li key={c.id} className="flex gap-3 px-4 py-3 text-sm">
                <span className="num flex h-6 w-6 shrink-0 items-center justify-center rounded text-xs font-semibold text-white" style={{ background: SCORE_COLOR[c.score - 1] }} title={PULSE_SCALE[c.score - 1].label}>
                  {c.score}
                </span>
                <p className="flex-1 text-ink-800">{c.comment}</p>
                <span className="shrink-0 text-right text-xs text-ink-500">
                  {c.author ?? 'Anônimo'}
                  <span className="num block text-ink-400">{fmtDayKey(c.weekStart, 'dd/MM')}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState compact title="Nenhum comentário com esse filtro" />
        )}
      </Panel>
    </div>
  );
}
