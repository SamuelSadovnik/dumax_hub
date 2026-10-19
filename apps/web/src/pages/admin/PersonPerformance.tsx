import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import clsx from 'clsx';
import { toast } from 'sonner';
import { ArrowLeft, Clock, Lock, MessageSquarePlus, Plus, Trash2 } from 'lucide-react';
import {
  FEEDBACK_TYPES, FEEDBACK_TYPE_LABEL, FLAG_COLOR, PROFILES, SCORE_WEIGHTS, TASK_PRIORITY_COLOR, TASK_STATUS_LABEL, TIMELOG_ACTIVITIES,
  TIMELOG_ACTIVITY_COLOR, TIMELOG_ACTIVITY_LABEL, formatGoalValue, formatMinutes, scoreLevel, type FeedbackType, type ProfileKey, type TimeLogActivity,
} from '@dumax/shared';
import { api, errorMessage } from '@/lib/api';
import { useMe } from '@/lib/auth';
import type { PersonPerformanceData } from '@/lib/types';
import { dueLabel, fmtDate, fmtDateTime, fmtDayKey, fromNow, isoToLocalInput, localInputToIso, pct } from '@/lib/format';
import { Avatar, Badge, Button, Checkbox, EmptyState, Field, Input, Modal, PageLoader, Panel, ProgressBar, ScoreRing, Select, StatCard, Tabs, Textarea } from '@/components/ui';
import { NewTaskModal } from '../app/Tasks';
import { confirmDialog } from '@/components/ConfirmDialog';

const axis = { fontSize: 11, fill: '#9AA1B5' };
const tooltipStyle = { borderRadius: 8, border: '1px solid #E3E6EC', fontSize: 12, boxShadow: '0 8px 24px -8px rgba(13,19,48,.2)' };

function FeedbackModal({ userId, onClose }: { userId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [type, setType] = useState<FeedbackType>('ONE_ON_ONE');
  const [body, setBody] = useState('');
  const [items, setItems] = useState('');
  const [priv, setPriv] = useState(false);
  const save = useMutation({
    mutationFn: () => api.post(`/performance/people/${userId}/feedbacks`, { type, body, private: priv, actionItems: items.split('\n').map((s) => s.trim()).filter(Boolean) }),
    onSuccess: () => {
      toast.success('Registrado');
      qc.invalidateQueries({ queryKey: ['person-performance'] });
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title="Registrar 1:1 ou feedback"
      footer={
        <Button disabled={body.trim().length < 3} loading={save.isPending} onClick={() => save.mutate()}>
          Salvar registro
        </Button>
      }
    >
      <div className="space-y-4">
        <Field label="Tipo">
          <Select value={type} onChange={(e) => setType(e.target.value as FeedbackType)}>
            {FEEDBACK_TYPES.map((t) => (
              <option key={t} value={t}>
                {FEEDBACK_TYPE_LABEL[t]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="O que foi conversado">
          <Textarea autoFocus rows={5} value={body} onChange={(e) => setBody(e.target.value)} />
        </Field>
        <Field label="Combinados" hint="Um por linha">
          <Textarea rows={3} value={items} onChange={(e) => setItems(e.target.value)} />
        </Field>
        <Checkbox checked={priv} onChange={setPriv} label="Nota privada (só gestores e RH veem)" />
      </div>
    </Modal>
  );
}

/** Lançamento manual de horas (para o próprio usuário) */
export function LogTimeModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const start = new Date();
  start.setHours(9, 0, 0, 0);
  const [f, setF] = useState({ activity: 'EXECUCAO' as TimeLogActivity, startedAt: isoToLocalInput(start.toISOString()), hours: '1', minutes: '0', description: '' });
  const save = useMutation({
    mutationFn: () =>
      api.post('/timelogs', {
        activity: f.activity,
        startedAt: localInputToIso(f.startedAt),
        minutes: Number(f.hours) * 60 + Number(f.minutes),
        description: f.description || null,
      }),
    onSuccess: () => {
      toast.success('Horas registradas');
      qc.invalidateQueries({ queryKey: ['person-performance'] });
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Modal open onClose={onClose} title="Registrar horas" size="sm" footer={<Button loading={save.isPending} onClick={() => save.mutate()}>Registrar</Button>}>
      <div className="space-y-4">
        <Field label="Atividade">
          <Select value={f.activity} onChange={(e) => setF({ ...f, activity: e.target.value as TimeLogActivity })}>
            {TIMELOG_ACTIVITIES.map((a) => (
              <option key={a} value={a}>
                {TIMELOG_ACTIVITY_LABEL[a]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Início">
          <Input type="datetime-local" value={f.startedAt} onChange={(e) => setF({ ...f, startedAt: e.target.value })} />
        </Field>
        <Field label="Duração">
          <div className="flex items-center gap-2">
            <Input type="number" min={0} max={16} className="w-20" value={f.hours} onChange={(e) => setF({ ...f, hours: e.target.value })} /> h
            <Input type="number" min={0} max={59} step={5} className="w-20" value={f.minutes} onChange={(e) => setF({ ...f, minutes: e.target.value })} /> min
          </div>
        </Field>
        <Field label="Descrição">
          <Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Ex.: atendimento ao cliente X" />
        </Field>
      </div>
    </Modal>
  );
}

export default function PersonPerformance({ self }: { self?: boolean }) {
  const me = useMe();
  const qc = useQueryClient();
  const params = useParams();
  const [search] = useSearchParams();
  const id = self ? 'me' : params.id!;
  const [days, setDays] = useState<'7' | '30' | '90'>((search.get('days') as '7' | '30' | '90') ?? '30');
  const [tab, setTab] = useState<'open' | 'done' | 'goals' | 'feedback' | 'logs'>('open');
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);

  const { data, isLoading } = useQuery({ queryKey: ['person-performance', id, days], queryFn: () => api.get<PersonPerformanceData>(`/performance/people/${id}`, { days }) });
  const { data: profile } = useQuery({
    queryKey: ['profile', data?.user.id],
    enabled: Boolean(data?.user.id),
    queryFn: () => api.get<{ scores: Record<ProfileKey, number>; primary: ProfileKey; secondary: ProfileKey } | null>(`/profiles/users/${data!.user.id}`),
  });

  if (isLoading || !data) return <PageLoader />;
  const m = data.metrics;
  const lvl = scoreLevel(data.score);
  const isMe = data.user.id === me.id;
  const delta = data.score !== null && data.prevScore !== null ? data.score - data.prevScore : null;

  const weekly = data.weekly.map((w) => ({
    ...w,
    label: fmtDayKey(w.weekStart, 'dd/MM'),
    onTime: w.onTimeRate === null ? null : Math.round(w.onTimeRate * 100),
  }));

  const removeFeedback = async (fid: string) => {
    if (!(await confirmDialog({ title: 'Excluir este registro?', description: 'O feedback some do histórico da pessoa. Não dá para desfazer.', confirmLabel: 'Excluir', tone: 'danger' }))) return;
    await api.del(`/performance/feedbacks/${fid}`);
    qc.invalidateQueries({ queryKey: ['person-performance'] });
  };

  return (
    <div className="space-y-5">
      {!self && (
        <Link to="/admin" className="inline-flex items-center gap-1 text-[13px] text-ink-500 hover:text-ink-900">
          <ArrowLeft className="h-4 w-4" /> Visão geral do time
        </Link>
      )}

      {/* Cabeçalho */}
      <div className="card flex flex-wrap items-center gap-5 p-5">
        <Avatar user={data.user} size={56} />
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold">{self ? 'Meu desempenho' : data.user.name}</h1>
          <p className="text-sm text-ink-500">
            {[data.user.jobTitle, data.user.department?.name, data.user.manager && `gestor: ${data.user.manager.name}`].filter(Boolean).join(' · ')}
          </p>
          {profile && (
            <p className="mt-1.5 flex items-center gap-1.5 text-xs text-ink-500">
              Perfil
              <Badge color={PROFILES[profile.primary].color}>{PROFILES[profile.primary].label}</Badge>
              <Badge color={PROFILES[profile.secondary].color}>{PROFILES[profile.secondary].label}</Badge>
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <ScoreRing score={data.score} size={64} color={lvl?.color ?? '#9AA1B5'} />
          <div>
            <p className="text-sm font-semibold" style={{ color: lvl?.color }}>
              {lvl?.label ?? 'Sem dados'}
            </p>
            <p className="num text-xs text-ink-500">
              {delta !== null ? `${delta >= 0 ? '+' : ''}${delta} vs. período anterior` : 'sem período anterior'}
            </p>
            {data.peerAvgScore !== null && <p className="num text-xs text-ink-500">média da área: {Math.round(data.peerAvgScore)}</p>}
          </div>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 border-t border-ink-100 pt-4 lg:w-auto lg:border-0 lg:pt-0">
          <Tabs
            size="sm"
            value={days}
            onChange={setDays}
            items={[
              { value: '7', label: '7d' },
              { value: '30', label: '30d' },
              { value: '90', label: '90d' },
            ]}
          />
          {data.canManage && !isMe && (
            <>
              <Button size="sm" variant="secondary" icon={<MessageSquarePlus className="h-3.5 w-3.5" />} onClick={() => setFeedbackOpen(true)}>
                Registrar 1:1
              </Button>
              <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setTaskOpen(true)}>
                Enviar demanda
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Indicadores */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard label="Entregas" value={m.tasksDone} delta={m.tasksDone - data.prevMetrics.tasksDone} hint={`${pct(m.onTimeRate)} no prazo`} />
        <StatCard label="Atrasadas" value={m.overdueOpen} tone={m.overdueOpen ? 'danger' : 'default'} hint={`${m.openTasks} em aberto · ${m.blocked} bloqueadas`} />
        <StatCard label="Pontualidade" value={pct(m.punctuality)} hint={`${m.lateDays} atraso(s) · ${m.absentDays} falta(s)`} />
        <StatCard label="Metas" value={pct(m.goalProgress)} hint={`${m.goalsCount} meta(s) no período`} />
      </div>

      {data.flags.length > 0 && (
        <Panel title="Pontos de atenção">
          <ul>
            {data.flags.map((f, i) => (
              <li key={i} className="flex items-center gap-3 border-b border-ink-100 px-4 py-2.5 text-sm last:border-0">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: FLAG_COLOR[f.severity] }} />
                <span className={clsx(f.severity === 'positive' ? 'text-ok' : 'text-ink-700')}>{f.message}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Panel title="Entregas por semana" subtitle="Demandas concluídas e % no prazo">
          <div className="h-56 px-2 py-3">
            <ResponsiveContainer>
              <ComposedChart data={weekly}>
                <CartesianGrid vertical={false} stroke="#EEF0F4" />
                <XAxis dataKey="label" tick={axis} axisLine={false} tickLine={false} />
                <YAxis yAxisId="l" tick={axis} axisLine={false} tickLine={false} width={24} allowDecimals={false} />
                <YAxis yAxisId="r" orientation="right" domain={[0, 100]} tick={axis} axisLine={false} tickLine={false} width={34} unit="%" />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: '#F6F7F9' }} />
                <Bar yAxisId="l" dataKey="done" name="Entregas" fill="#2D3FE0" radius={[4, 4, 0, 0]} barSize={22} />
                <Line yAxisId="r" dataKey="onTime" name="No prazo (%)" stroke="#1F9254" strokeWidth={2} dot={{ r: 3 }} connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Composição da nota">
          <table className="tbl">
            <thead>
              <tr>
                <th>Fator</th>
                <th className="text-right">Valor</th>
                <th className="text-right">Peso</th>
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ['onTime', 'Entregas no prazo'],
                  ['throughput', 'Volume entregue'],
                  ['goals', 'Metas'],
                  ['punctuality', 'Pontualidade'],
                ] as const
              ).map(([k, label]) => (
                <tr key={k}>
                  <td className="text-[13px]">{label}</td>
                  <td className="num text-right text-[13px]">{data.components[k] !== undefined ? `${Math.round(data.components[k]! * 100)}%` : <span className="text-ink-400">sem dado</span>}</td>
                  <td className="num text-right text-[13px] text-ink-500">{Math.round(SCORE_WEIGHTS[k] * 100)}%</td>
                </tr>
              ))}
              {m.overdueOpen > 0 && (
                <tr>
                  <td className="text-[13px]">Desconto por atrasos</td>
                  <td className="num text-right text-[13px] text-bad">−{Math.min(15, m.overdueOpen * 3)}</td>
                  <td />
                </tr>
              )}
            </tbody>
          </table>
        </Panel>
      </div>

      {/* Detalhes */}
      <div className="card">
        <div className="flex flex-wrap items-center gap-2 border-b border-ink-100 px-4 py-2.5">
          <Tabs
            size="sm"
            value={tab}
            onChange={setTab}
            items={[
              { value: 'open', label: 'Em aberto', count: data.openTasks.length },
              { value: 'done', label: 'Entregues', count: data.recentDone.length },
              { value: 'goals', label: 'Metas', count: data.goals.length },
              { value: 'feedback', label: '1:1 e feedbacks', count: data.feedbacks.length },
              { value: 'logs', label: 'Registros de horas', count: data.logs.length },
            ]}
          />
        </div>

        {tab === 'open' &&
          (data.openTasks.length ? (
            <table className="tbl">
              <tbody>
                {data.openTasks.map((t) => {
                  const due = dueLabel(t.dueAt);
                  return (
                    <tr key={t.id}>
                      <td>
                        <span className="flex items-center gap-2">
                          <span className="h-1.5 w-1.5 rounded-full" style={{ background: TASK_PRIORITY_COLOR[t.priority] }} />
                          <span className="font-medium">{t.title}</span>
                        </span>
                      </td>
                      <td className="text-[13px] text-ink-600">{TASK_STATUS_LABEL[t.status]}</td>
                      <td className={clsx('num text-[13px]', due?.tone === 'danger' ? 'font-medium text-bad' : 'text-ink-600')}>{due?.text ?? 'sem prazo'}</td>
                      <td className="text-[13px] text-ink-500">de {t.createdBy.name}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <EmptyState compact title="Nenhuma demanda em aberto" />
          ))}

        {tab === 'done' &&
          (data.recentDone.length ? (
            <table className="tbl">
              <tbody>
                {data.recentDone.map((t) => {
                  const late = t.dueAt && new Date(t.completedAt) > new Date(t.dueAt);
                  return (
                    <tr key={t.id}>
                      <td className="font-medium">{t.title}</td>
                      <td className="num text-[13px] text-ink-600">entregue {fmtDateTime(t.completedAt)}</td>
                      <td>{t.dueAt ? <Badge tone={late ? 'bad' : 'ok'}>{late ? 'Com atraso' : 'No prazo'}</Badge> : <Badge>Sem prazo</Badge>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <EmptyState compact title="Nenhuma entrega no período" />
          ))}

        {tab === 'goals' &&
          (data.goals.length ? (
            <ul>
              {data.goals.map((g) => {
                const behind = g.status === 'ACTIVE' && g.elapsed - g.progress > 0.2;
                return (
                  <li key={g.id} className="grid gap-2 border-b border-ink-100 px-4 py-3 last:border-0 sm:grid-cols-[1fr_260px_120px] sm:items-center">
                    <span>
                      <span className="block text-sm font-medium">{g.title}</span>
                      <span className="text-xs text-ink-500">até {fmtDate(g.dueDate)}</span>
                    </span>
                    <ProgressBar value={g.progress} marker={g.elapsed} color={g.status === 'COMPLETED' ? '#1F9254' : behind ? '#C77700' : '#2D3FE0'} />
                    <span className="num text-right text-[13px]">
                      {formatGoalValue(g.currentValue, g.unit)} / {formatGoalValue(g.targetValue, g.unit)}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState compact title="Nenhuma meta" />
          ))}

        {tab === 'feedback' && (
          <div>
            {data.canManage && !isMe && (
              <div className="border-b border-ink-100 px-4 py-2.5">
                <Button size="sm" variant="secondary" icon={<MessageSquarePlus className="h-3.5 w-3.5" />} onClick={() => setFeedbackOpen(true)}>
                  Novo registro
                </Button>
              </div>
            )}
            {data.feedbacks.length ? (
              <ul>
                {data.feedbacks.map((f) => (
                  <li key={f.id} className="border-b border-ink-100 px-4 py-3.5 last:border-0">
                    <div className="mb-1.5 flex items-center gap-2 text-xs text-ink-500">
                      <Badge tone={f.type === 'POSITIVO' ? 'ok' : f.type === 'MELHORIA' ? 'warn' : 'brand'}>{FEEDBACK_TYPE_LABEL[f.type]}</Badge>
                      {f.private && (
                        <span className="flex items-center gap-1">
                          <Lock className="h-3 w-3" /> privado
                        </span>
                      )}
                      <span>
                        {f.author.name} · {fromNow(f.createdAt)}
                      </span>
                      {f.author.id === me.id && (
                        <button onClick={() => removeFeedback(f.id)} className="ml-auto text-ink-400 hover:text-bad" aria-label="Excluir">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                    <p className="whitespace-pre-line text-sm text-ink-800">{f.body}</p>
                    {f.actionItems.length > 0 && (
                      <ul className="mt-2 list-disc pl-5 text-[13px] text-ink-600">
                        {f.actionItems.map((a, i) => (
                          <li key={i}>{a}</li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState compact title="Nenhum registro ainda" />
            )}
          </div>
        )}

        {tab === 'logs' &&
          (data.logs.length ? (
            <table className="tbl">
              <tbody>
                {data.logs.map((l) => (
                  <tr key={l.id}>
                    <td className="num w-40 text-[13px] text-ink-600">{fmtDateTime(l.startedAt)}</td>
                    <td>
                      <span className="flex items-center gap-2 text-[13px]">
                        <span className="h-2 w-2 rounded-full" style={{ background: TIMELOG_ACTIVITY_COLOR[l.activity] }} />
                        {TIMELOG_ACTIVITY_LABEL[l.activity]}
                      </span>
                    </td>
                    <td className="text-[13px]">{l.task?.title ?? l.description ?? '—'}</td>
                    <td className="num text-right text-[13px] font-medium">{l.endedAt ? formatMinutes(l.minutes) : 'rodando'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <EmptyState compact title="Nenhuma hora registrada no período" text={isMe ? 'Use o cronômetro nas demandas ou registre manualmente.' : undefined} />
          ))}
      </div>

      {feedbackOpen && <FeedbackModal userId={data.user.id} onClose={() => setFeedbackOpen(false)} />}
      {taskOpen && <NewTaskModal open onClose={() => setTaskOpen(false)} defaultAssignee={data.user.id} />}
    </div>
  );
}
