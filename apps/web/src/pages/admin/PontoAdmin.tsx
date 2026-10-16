import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { toast } from 'sonner';
import { RefreshCw, Settings2 } from 'lucide-react';
import { DAY_STATUS_COLOR, DAY_STATUS_LABEL, formatMinutes } from '@dumax/shared';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { PontoSummary, TimeDay, TimeEntry, UserLite, WorkSchedule } from '@/lib/types';
import { fmtDateTime, fmtDayKey, fmtTime } from '@/lib/format';
import { Avatar, Badge, Button, Input, Modal, PageHeader, PageLoader, Select, Tabs } from '@/components/ui';

interface TodayRow {
  user: UserLite & { department: { name: string; color: string } | null; workSchedule: WorkSchedule | null };
  day: TimeDay | null;
  entries: TimeEntry[];
  working: boolean;
}

function TodayView() {
  const { data, isLoading } = useQuery({ queryKey: ['ponto-today'], queryFn: () => api.get<{ date: string; people: TodayRow[] }>('/ponto/today'), refetchInterval: 60_000 });
  const [filter, setFilter] = useState<'all' | 'LATE' | 'ABSENT' | 'working'>('all');
  const [q, setQ] = useState('');
  if (isLoading || !data) return <PageLoader />;
  const count = (s: string) => data.people.filter((p) => p.day?.status === s).length;
  const working = data.people.filter((p) => p.working).length;
  const rows = data.people
    .filter((p) => (filter === 'all' ? true : filter === 'working' ? p.working : p.day?.status === filter))
    .filter((p) => p.user.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (b.day?.lateMinutes ?? 0) - (a.day?.lateMinutes ?? 0) || a.user.name.localeCompare(b.user.name));
  const stats: [string, number, string][] = [
    ['Trabalhando agora', working, 'text-ok'],
    ['Atrasados', count('LATE'), count('LATE') ? 'text-warn' : ''],
    ['Sem registro', count('ABSENT'), count('ABSENT') ? 'text-bad' : ''],
    ['Total previsto', data.people.length, ''],
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 overflow-hidden rounded-lg border border-ink-200 bg-white sm:grid-cols-4">
        {stats.map(([l, v, tone]) => (
          <div key={l} className="border-b border-r border-ink-100 px-5 py-4 sm:border-b-0">
            <p className="text-[13px] text-ink-500">{l}</p>
            <p className={clsx('num mt-1 text-2xl font-semibold', tone)}>{v}</p>
          </div>
        ))}
      </div>
      <div className="card">
        <div className="flex flex-wrap items-center gap-3 border-b border-ink-100 px-4 py-2.5">
          <Tabs
            size="sm"
            value={filter}
            onChange={setFilter}
            items={[
              { value: 'all', label: 'Todos', count: data.people.length },
              { value: 'working', label: 'Trabalhando', count: working },
              { value: 'LATE', label: 'Atrasados', count: count('LATE') },
              { value: 'ABSENT', label: 'Sem registro', count: count('ABSENT') },
            ]}
          />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar pessoa" className="ml-auto h-8 w-56" />
        </div>
        <table className="tbl">
          <thead>
            <tr>
              <th>Pessoa</th>
              <th>Previsto</th>
              <th>Batidas</th>
              <th>Situação</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.user.id}>
                <td>
                  <span className="flex items-center gap-2.5">
                    <Avatar user={p.user} size={28} online={p.working} />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{p.user.name}</span>
                      <span className="block truncate text-xs text-ink-500">{p.user.department?.name ?? '—'}</span>
                    </span>
                  </span>
                </td>
                <td className="num text-ink-600">
                  {p.user.workSchedule?.startTime ?? '09:00'}–{p.user.workSchedule?.endTime ?? '18:00'}
                </td>
                <td>
                  <span className="flex flex-wrap gap-1">
                    {p.entries.length ? (
                      p.entries.map((e) => (
                        <span key={e.id} className="num rounded bg-ink-100 px-1.5 py-0.5 text-2xs text-ink-700">
                          {fmtTime(e.at)}
                        </span>
                      ))
                    ) : (
                      <span className="text-xs text-ink-400">nenhuma</span>
                    )}
                  </span>
                </td>
                <td>
                  {p.day ? (
                    <Badge color={DAY_STATUS_COLOR[p.day.status]} dot>
                      {DAY_STATUS_LABEL[p.day.status]}
                      {p.day.lateMinutes > 0 && ` · ${formatMinutes(p.day.lateMinutes)}`}
                    </Badge>
                  ) : (
                    <Badge tone="neutral">Aguardando</Badge>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DaysView() {
  const [status, setStatus] = useState('');
  const [period, setPeriod] = useState('14');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const PAGE = 50;
  const from = new Date(Date.now() - (Number(period) - 1) * 86400000).toLocaleDateString('en-CA');
  const { data, isLoading } = useQuery({
    queryKey: ['ponto-days', status, period],
    queryFn: () => api.get<{ summary: PontoSummary; days: TimeDay[] }>('/ponto/days', { status: status || undefined, from }),
  });
  const days = (data?.days ?? []).filter((d) => d.status !== 'OFF').filter((d) => d.user!.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }} className="w-48">
          <option value="">Todas as situações</option>
          <option value="LATE">Atrasos</option>
          <option value="ABSENT">Faltas</option>
          <option value="INCOMPLETE">Incompletos</option>
          <option value="OK">Regulares</option>
        </Select>
        <Select value={period} onChange={(e) => { setPeriod(e.target.value); setPage(0); }} className="w-40">
          <option value="7">Últimos 7 dias</option>
          <option value="14">Últimos 14 dias</option>
          <option value="30">Últimos 30 dias</option>
        </Select>
        <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder="Buscar pessoa" className="ml-auto h-9 w-56" />
      </div>
      {isLoading ? (
        <PageLoader />
      ) : (
        <div className="card overflow-x-auto">
          <table className="tbl min-w-[720px]">
            <thead>
              <tr>
                <th>Pessoa</th>
                <th>Dia</th>
                <th>Entrada / saída</th>
                <th>Trabalhado</th>
                <th>Saldo</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {days.slice(page * PAGE, (page + 1) * PAGE).map((d) => (
                <tr key={d.id}>
                  <td>
                    <span className="flex items-center gap-2">
                      <Avatar user={d.user!} size={26} /> {d.user!.name}
                    </span>
                  </td>
                  <td className="capitalize">{fmtDayKey(d.date)}</td>
                  <td className="num text-xs">
                    {d.firstIn ? fmtTime(d.firstIn) : '--:--'} → {d.lastOut ? fmtTime(d.lastOut) : '--:--'}
                  </td>
                  <td>{formatMinutes(d.workedMinutes)}</td>
                  <td className={clsx('num font-medium', d.balanceMinutes < 0 ? 'text-bad' : d.balanceMinutes > 0 ? 'text-ok' : 'text-ink-400')}>{formatMinutes(d.balanceMinutes)}</td>
                  <td>
                    <Badge color={DAY_STATUS_COLOR[d.status]}>
                      {DAY_STATUS_LABEL[d.status]}
                      {d.lateMinutes > 0 && ` ${formatMinutes(d.lateMinutes)}`}
                    </Badge>
                  </td>
                </tr>
              ))}
              {!days.length && (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-ink-400">
                    Nenhum dia encontrado no período
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {days.length > PAGE && (
            <div className="flex items-center justify-between border-t border-ink-100 px-5 py-3 text-[13px] text-ink-500">
              <span className="num">
                {page * PAGE + 1}–{Math.min((page + 1) * PAGE, days.length)} de {days.length} dias
              </span>
              <span className="flex gap-2">
                <Button size="sm" variant="secondary" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                  Anterior
                </Button>
                <Button size="sm" variant="secondary" disabled={(page + 1) * PAGE >= days.length} onClick={() => setPage((p) => p + 1)}>
                  Próxima
                </Button>
              </span>
            </div>
          )}
        </div>
      )}
    </>
  );
}

function SummaryView() {
  const [from, setFrom] = useState(() => new Date(Date.now() - 29 * 86400000).toLocaleDateString('en-CA'));
  const { data, isLoading } = useQuery({
    queryKey: ['ponto-summary', from],
    queryFn: () => api.get<{ people: ({ user: UserLite & { department: { name: string } | null } } & PontoSummary)[]; total: PontoSummary }>('/ponto/summary', { from }),
  });
  return (
    <>
      <div className="mb-4 flex items-center gap-2">
        <span className="text-sm text-ink-500">Desde</span>
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-44" />
      </div>
      {isLoading || !data ? (
        <PageLoader />
      ) : (
        <div className="card overflow-x-auto">
          <table className="tbl min-w-[760px]">
            <thead>
              <tr>
                <th>Pessoa</th>
                <th>Trabalhado</th>
                <th>Banco de horas</th>
                <th className="text-right">Atrasos</th>
                <th className="text-right">Faltas</th>
                <th className="text-right">Incompletos</th>
              </tr>
            </thead>
            <tbody>
              {data.people.map((p) => (
                <tr key={p.user.id}>
                  <td>
                    <span className="flex items-center gap-2">
                      <Avatar user={p.user} size={26} />
                      <span>
                        <span className="block font-semibold">{p.user.name}</span>
                        <span className="block text-xs text-ink-500">{p.user.department?.name}</span>
                      </span>
                    </span>
                  </td>
                  <td>{formatMinutes(p.workedMinutes)}</td>
                  <td className={clsx('num font-semibold', p.balanceMinutes < 0 ? 'text-bad' : 'text-ok')}>{formatMinutes(p.balanceMinutes)}</td>
                  <td className="num text-right">{p.lateCount ? <Badge tone="warn">{p.lateCount}</Badge> : 0}</td>
                  <td className="num text-right">{p.absentCount ? <Badge tone="bad">{p.absentCount}</Badge> : 0}</td>
                  <td className="num text-right">{p.incompleteCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function IntegrationModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { data: logs = [] } = useQuery({
    queryKey: ['ponto-logs'],
    queryFn: () => api.get<{ id: string; startedAt: string; ok: boolean; imported: number; skipped: number; message: string | null }[]>('/ponto/sync/logs'),
  });
  const sync = useMutation({
    mutationFn: () => api.post<{ imported: number; skipped: number }>('/ponto/sync', {}),
    onSuccess: (r) => {
      toast.success(`${r.imported} batida(s) importadas`);
      qc.invalidateQueries();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Modal open onClose={onClose} title="Integração com o sistema de ponto">
      <div className="space-y-4 text-sm">
        <p className="text-ink-600">
          O Hub busca as batidas na API do seu sistema de ponto a cada 15 minutos (<code>PONTO_SYNC_CRON</code>) e também aceita webhooks em <code>POST /api/ponto/webhook</code>. Cada pessoa é ligada pelo campo <strong>Código no ponto</strong> (em Pessoas).
        </p>
        <Button icon={<RefreshCw className="h-4 w-4" />} loading={sync.isPending} onClick={() => sync.mutate()}>
          Sincronizar agora
        </Button>
        <div>
          <p className="mb-1.5 text-xs text-ink-500">Últimas sincronizações</p>
          <ul className="divide-y divide-ink-100 rounded-lg border border-ink-200">
            {logs.map((l) => (
              <li key={l.id} className="flex items-center gap-2 px-3 py-2 text-xs">
                <span className={clsx('h-2 w-2 rounded-full', l.ok ? 'bg-ok' : 'bg-bad')} />
                <span className="flex-1">{fmtDateTime(l.startedAt)}</span>
                <span>{l.ok ? `${l.imported} importadas · ${l.skipped} sem vínculo` : l.message}</span>
              </li>
            ))}
            {!logs.length && <li className="px-3 py-3 text-xs text-ink-400">Nenhuma ainda</li>}
          </ul>
        </div>
      </div>
    </Modal>
  );
}

export default function PontoAdmin() {
  const { isHR } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'hoje';
  const [integration, setIntegration] = useState(false);
  return (
    <div className="space-y-5">
      <PageHeader
        title="Ponto do time"
        subtitle="Quem chegou, quem atrasou e banco de horas. Os dados vêm direto do sistema de ponto."
        actions={
          <>
            <Tabs
              value={tab as 'hoje' | 'dias' | 'resumo'}
              onChange={(t) => setParams({ tab: t })}
              items={[
                { value: 'hoje', label: 'Hoje' },
                { value: 'dias', label: 'Dias' },
                { value: 'resumo', label: 'Resumo' },
              ]}
            />
            {isHR && (
              <Button variant="secondary" size="icon" title="Integração" onClick={() => setIntegration(true)}>
                <Settings2 className="h-4 w-4" />
              </Button>
            )}
          </>
        }
      />
      {tab === 'hoje' && <TodayView />}
      {tab === 'dias' && <DaysView />}
      {tab === 'resumo' && <SummaryView />}
      {integration && <IntegrationModal onClose={() => setIntegration(false)} />}
    </div>
  );
}
