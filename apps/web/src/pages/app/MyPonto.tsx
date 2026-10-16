import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Fingerprint } from 'lucide-react';
import { DAY_STATUS_COLOR, DAY_STATUS_LABEL, PUNCH_TYPE_LABEL, formatMinutes } from '@dumax/shared';
import { api } from '@/lib/api';
import type { PontoSummary, TimeDay, TimeEntry, WorkSchedule } from '@/lib/types';
import { fmtDayKey, fmtTime } from '@/lib/format';
import { Badge, EmptyState, PageHeader, PageLoader, Tabs } from '@/components/ui';

const PERIODS = { '7': 7, '30': 30, '60': 60 } as const;

/** Meu ponto — somente leitura: tudo vem da API do sistema de ponto. */
export default function MyPonto() {
  const [period, setPeriod] = useState<keyof typeof PERIODS>('30');
  const from = new Date(Date.now() - (PERIODS[period] - 1) * 86400000).toLocaleDateString('en-CA');
  const { data, isLoading } = useQuery({
    queryKey: ['ponto-me', period],
    queryFn: () => api.get<{ summary: PontoSummary; days: TimeDay[]; entries: TimeEntry[]; schedule: WorkSchedule | null }>('/ponto/me', { from }),
  });

  if (isLoading || !data) return <PageLoader />;
  const { summary, days, entries, schedule } = data;
  const entriesOf = (d: TimeDay) => entries.filter((e) => new Date(e.at).toLocaleDateString('en-CA') === d.date.slice(0, 10));
  const today = new Date().toLocaleDateString('en-CA');

  return (
    <div className="space-y-5">
      <PageHeader
        title="Meu ponto"
        subtitle={
          schedule
            ? `Jornada: ${schedule.startTime}–${schedule.endTime} · intervalo ${schedule.breakMinutes}min · tolerância ${schedule.toleranceMinutes}min`
            : 'Batidas sincronizadas automaticamente com o sistema de ponto.'
        }
        actions={<Tabs size="sm" value={period} onChange={setPeriod} items={[{ value: '7', label: '7 dias' }, { value: '30', label: '30 dias' }, { value: '60', label: '60 dias' }]} />}
      />

      <div className="grid grid-cols-2 overflow-hidden rounded-lg border border-ink-200 bg-white lg:grid-cols-4">
        {(
          [
            ['Horas trabalhadas', formatMinutes(summary.workedMinutes), '', `de ${formatMinutes(summary.expectedMinutes)} previstas`],
            ['Banco de horas', formatMinutes(summary.balanceMinutes), summary.balanceMinutes < 0 ? 'text-bad' : 'text-ok', 'no período'],
            ['Atrasos', String(summary.lateCount), summary.lateCount ? 'text-warn' : '', `${formatMinutes(summary.lateMinutes)} no total`],
            ['Faltas', String(summary.absentCount), summary.absentCount ? 'text-bad' : '', summary.incompleteCount ? `${summary.incompleteCount} dia(s) incompleto(s)` : 'no período'],
          ] as const
        ).map(([l, v, tone, sub]) => (
          <div key={l} className="border-b border-r border-ink-100 px-5 py-4 lg:border-b-0">
            <p className="text-[13px] text-ink-500">{l}</p>
            <p className={clsx('num mt-1 text-2xl font-semibold', tone)}>{v}</p>
            <p className="mt-0.5 text-xs text-ink-500">{sub}</p>
          </div>
        ))}
      </div>

      {!days.length ? (
        <div className="card">
          <EmptyState icon={<Fingerprint />} title="Nenhuma batida no período" text="Assim que o sistema de ponto sincronizar, seus dias aparecem aqui." />
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="tbl min-w-[640px]">
            <thead>
              <tr>
                <th>Dia</th>
                <th>Batidas</th>
                <th>Trabalhado</th>
                <th>Saldo</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {days.map((d) => {
                const es = entriesOf(d);
                const isToday = d.date.slice(0, 10) === today;
                return (
                  <tr key={d.id} className={clsx(isToday && 'bg-brand-50/40')}>
                    <td className="whitespace-nowrap font-medium capitalize">
                      {fmtDayKey(d.date)}
                      {isToday && <span className="ml-2 text-xs font-medium text-brand-600">hoje</span>}
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {es.length ? (
                          es.map((e) => (
                            <span key={e.id} title={PUNCH_TYPE_LABEL[e.type]} className={clsx('num rounded px-1.5 py-0.5 text-2xs', e.type === 'IN' || e.type === 'BREAK_END' ? 'bg-ok-soft text-ok' : 'bg-ink-100 text-ink-600')}>
                              {fmtTime(e.at)}
                            </span>
                          ))
                        ) : (
                          <span className="text-xs text-ink-400">—</span>
                        )}
                      </div>
                    </td>
                    <td>{formatMinutes(d.workedMinutes)}</td>
                    <td className={clsx('num font-medium', d.balanceMinutes < 0 ? 'text-bad' : d.balanceMinutes > 0 ? 'text-ok' : 'text-ink-400')}>{isToday ? '—' : formatMinutes(d.balanceMinutes)}</td>
                    <td>
                      <Badge color={DAY_STATUS_COLOR[d.status]}>
                        {DAY_STATUS_LABEL[d.status]}
                        {d.lateMinutes > 0 && ` · ${formatMinutes(d.lateMinutes)}`}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
