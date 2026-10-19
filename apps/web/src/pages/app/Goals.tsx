import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle2, MoreHorizontal, Plus, Target, TrendingUp, Trash2, XCircle } from 'lucide-react';
import { GOAL_UNITS, formatGoalValue } from '@dumax/shared';
import { api, errorMessage } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { useUsers } from '@/lib/hooks';
import type { Goal } from '@/lib/types';
import { fmtDate, fmtDateTime, todayKey } from '@/lib/format';
import { Avatar, Badge, Button, Drawer, EmptyState, Field, Input, Menu, Modal, PageHeader, PageLoader, ProgressBar, Select, Tabs, Textarea, UserPicker } from '@/components/ui';
import { confirmDialog } from '@/components/ConfirmDialog';

function goalState(g: Goal) {
  if (g.status === 'COMPLETED') return { label: 'Concluída', tone: 'ok' as const, color: '#1F9254' };
  if (g.status === 'CANCELED') return { label: 'Cancelada', tone: 'neutral' as const, color: '#9AA1B5' };
  if (new Date(g.dueDate) < new Date(todayKey()) && g.progress < 1) return { label: 'Prazo vencido', tone: 'bad' as const, color: '#D93036' };
  if (g.elapsed - g.progress > 0.2) return { label: 'Abaixo do ritmo', tone: 'warn' as const, color: '#C77700' };
  return { label: 'No ritmo', tone: 'brand' as const, color: '#2D3FE0' };
}

function GoalModal({ goal, onClose, defaultOwner }: { goal?: Goal; onClose: () => void; defaultOwner: string }) {
  const qc = useQueryClient();
  const me = useMe();
  const { data: users = [] } = useUsers();
  const today = todayKey();
  const end = new Date();
  end.setMonth(end.getMonth() + 3);
  const [f, setF] = useState({
    title: goal?.title ?? '',
    description: goal?.description ?? '',
    ownerId: goal?.ownerId ?? defaultOwner,
    unit: goal?.unit ?? 'un',
    startValue: String(goal?.startValue ?? 0),
    targetValue: goal ? String(goal.targetValue) : '',
    startDate: goal?.startDate.slice(0, 10) ?? today,
    dueDate: goal?.dueDate.slice(0, 10) ?? end.toLocaleDateString('en-CA'),
  });
  const [tried, setTried] = useState(false);
  const errors = {
    title: f.title.trim().length < 3 ? 'Descreva a meta' : null,
    target: f.targetValue === '' || Number.isNaN(Number(f.targetValue)) ? 'Informe o alvo' : null,
    due: f.dueDate < f.startDate ? 'O prazo precisa ser depois do início' : null,
  };
  const save = useMutation({
    mutationFn: () => {
      const body = { ...f, description: f.description || null, startValue: Number(f.startValue || 0), targetValue: Number(f.targetValue) };
      return goal ? api.patch(`/goals/${goal.id}`, body) : api.post('/goals', body);
    },
    onSuccess: () => {
      toast.success(goal ? 'Meta atualizada' : 'Meta criada');
      qc.invalidateQueries({ queryKey: ['goals'] });
      qc.invalidateQueries({ queryKey: ['inbox'] });
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const submit = () => {
    setTried(true);
    if (!errors.title && !errors.target && !errors.due) save.mutate();
  };
  return (
    <Modal open onClose={onClose} title={goal ? 'Editar meta' : 'Nova meta'} footer={<Button loading={save.isPending} onClick={submit}>{goal ? 'Salvar' : 'Criar meta'}</Button>}>
      <div className="space-y-4">
        <Field label="Meta" required error={tried ? errors.title : null}>
          <Input autoFocus invalid={tried && !!errors.title} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Ex.: Fechar R$ 300 mil em novos contratos no trimestre" />
        </Field>
        {me.role !== 'EMPLOYEE' && (
          <Field label="Responsável">
            <UserPicker users={users} value={f.ownerId} onChange={(v) => setF({ ...f, ownerId: v as string })} />
          </Field>
        )}
        <div className="grid grid-cols-3 gap-3">
          <Field label="Unidade">
            <Select value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })}>
              {GOAL_UNITS.map((u) => (
                <option key={u.value} value={u.value}>
                  {u.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Valor inicial">
            <Input type="number" value={f.startValue} onChange={(e) => setF({ ...f, startValue: e.target.value })} />
          </Field>
          <Field label="Alvo" required error={tried ? errors.target : null}>
            <Input type="number" invalid={tried && !!errors.target} value={f.targetValue} onChange={(e) => setF({ ...f, targetValue: e.target.value })} />
          </Field>
        </div>
        <p className="-mt-2 text-xs text-ink-500">Para metas de redução (ex.: retrabalho de 20 para 5), coloque o alvo menor que o valor inicial.</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Início">
            <Input type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} />
          </Field>
          <Field label="Prazo" error={tried ? errors.due : null}>
            <Input type="date" invalid={tried && !!errors.due} value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} />
          </Field>
        </div>
        <Field label="Como medir">
          <Textarea rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Fonte do número, critérios" />
        </Field>
      </div>
    </Modal>
  );
}

function CheckinModal({ goal, onClose }: { goal: Goal; onClose: () => void }) {
  const qc = useQueryClient();
  const [value, setValue] = useState(String(goal.currentValue));
  const [note, setNote] = useState('');
  const save = useMutation({
    mutationFn: () => api.post(`/goals/${goal.id}/checkins`, { value: Number(value), note: note || undefined }),
    onSuccess: () => {
      toast.success('Progresso atualizado');
      qc.invalidateQueries({ queryKey: ['goals'] });
      qc.invalidateQueries({ queryKey: ['inbox'] });
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Modal open onClose={onClose} title="Atualizar progresso" size="sm" footer={<Button loading={save.isPending} disabled={value === '' || Number.isNaN(Number(value))} onClick={() => save.mutate()}>Salvar</Button>}>
      <p className="mb-4 text-sm font-medium">{goal.title}</p>
      <Field label={`Valor atual (alvo: ${formatGoalValue(goal.targetValue, goal.unit)})`}>
        <Input autoFocus type="number" value={value} onChange={(e) => setValue(e.target.value)} />
      </Field>
      <Field label="Comentário" className="mt-4">
        <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="O que avançou, o que está travando" />
      </Field>
    </Modal>
  );
}

export default function Goals({ scope }: { scope: 'mine' | 'team' }) {
  const me = useMe();
  const qc = useQueryClient();
  const [status, setStatus] = useState<'ACTIVE' | 'COMPLETED'>('ACTIVE');
  const [editing, setEditing] = useState<Goal | null | undefined>(undefined);
  const [checkin, setCheckin] = useState<Goal | null>(null);
  const [detail, setDetail] = useState<Goal | null>(null);
  const { data: goals, isLoading } = useQuery({ queryKey: ['goals', scope, status], queryFn: () => api.get<Goal[]>('/goals', { scope, status }) });

  const setGoalStatus = async (g: Goal, s: 'COMPLETED' | 'CANCELED' | 'ACTIVE') => {
    await api.patch(`/goals/${g.id}`, { status: s });
    qc.invalidateQueries({ queryKey: ['goals'] });
  };
  const remove = async (g: Goal) => {
    if (!(await confirmDialog({ title: `Excluir a meta “${g.title}”?`, description: 'O histórico de atualizações vai junto. Se ela só não faz mais sentido, prefira cancelar.', confirmLabel: 'Excluir meta', tone: 'danger' }))) return;
    await api.del(`/goals/${g.id}`);
    qc.invalidateQueries({ queryKey: ['goals'] });
  };

  const list = goals ?? [];
  const behind = list.filter((g) => goalState(g).tone === 'warn' || goalState(g).tone === 'bad').length;
  const avg = list.length ? list.reduce((a, g) => a + g.progress, 0) / list.length : null;

  return (
    <div>
      <PageHeader
        title={scope === 'mine' ? 'Minhas metas' : 'Metas do time'}
        subtitle={list.length ? `${list.length} meta(s) · progresso médio ${avg !== null ? Math.round(avg * 100) : 0}%${behind ? ` · ${behind} abaixo do ritmo` : ''}` : undefined}
        actions={
          <>
            <Tabs
              size="sm"
              value={status}
              onChange={setStatus}
              items={[
                { value: 'ACTIVE', label: 'Ativas' },
                { value: 'COMPLETED', label: 'Concluídas' },
              ]}
            />
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing(null)}>
              Nova meta
            </Button>
          </>
        }
      />
      {isLoading ? (
        <PageLoader />
      ) : !list.length ? (
        <div className="card">
          <EmptyState icon={<Target />} title={status === 'ACTIVE' ? 'Nenhuma meta ativa' : 'Nenhuma meta concluída'} text="Metas com número e prazo entram na nota de desempenho." action={status === 'ACTIVE' && <Button onClick={() => setEditing(null)}>Criar meta</Button>} />
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="tbl min-w-[860px]">
            <thead>
              <tr>
                <th>Meta</th>
                {scope === 'team' && <th>Responsável</th>}
                <th className="w-[240px]">Progresso</th>
                <th className="text-right">Atual / alvo</th>
                <th>Prazo</th>
                <th>Situação</th>
                <th className="w-28" />
              </tr>
            </thead>
            <tbody>
              {list.map((g) => {
                const st = goalState(g);
                const canEdit = g.ownerId === me.id || g.createdBy.id === me.id || me.role !== 'EMPLOYEE';
                return (
                  <tr key={g.id} className="clickable" onClick={() => setDetail(g)}>
                    <td>
                      <span className="block font-medium">{g.title}</span>
                      {g.team && <span className="text-xs text-ink-500">{g.team.name}</span>}
                    </td>
                    {scope === 'team' && (
                      <td>
                        <span className="flex items-center gap-2 text-[13px]">
                          <Avatar user={g.owner} size={22} /> {g.owner.name}
                        </span>
                      </td>
                    )}
                    <td>
                      <div className="flex items-center gap-2">
                        <ProgressBar value={g.progress} marker={g.status === 'ACTIVE' ? g.elapsed : undefined} color={st.color} />
                        <span className="num w-9 text-right text-xs text-ink-600">{Math.round(g.progress * 100)}%</span>
                      </div>
                    </td>
                    <td className="num text-right text-[13px]">
                      {formatGoalValue(g.currentValue, g.unit)} <span className="text-ink-400">/ {formatGoalValue(g.targetValue, g.unit)}</span>
                    </td>
                    <td className="num text-[13px] text-ink-600">{fmtDate(g.dueDate)}</td>
                    <td>
                      <Badge tone={st.tone}>{st.label}</Badge>
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {canEdit && (
                        <div className="flex justify-end gap-1">
                          {g.status === 'ACTIVE' && (
                            <Button size="sm" variant="secondary" icon={<TrendingUp className="h-3.5 w-3.5" />} onClick={() => setCheckin(g)}>
                              Atualizar
                            </Button>
                          )}
                          <Menu
                            trigger={() => (
                              <Button variant="ghost" size="icon-sm" aria-label="Mais ações">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            )}
                            items={[
                              { label: 'Editar', onClick: () => setEditing(g) },
                              { label: 'Marcar como concluída', icon: <CheckCircle2 />, onClick: () => setGoalStatus(g, 'COMPLETED'), hidden: g.status !== 'ACTIVE' },
                              { label: 'Reabrir', onClick: () => setGoalStatus(g, 'ACTIVE'), hidden: g.status === 'ACTIVE' },
                              { label: 'Cancelar meta', icon: <XCircle />, onClick: () => setGoalStatus(g, 'CANCELED'), hidden: g.status !== 'ACTIVE' },
                              { label: 'Excluir', icon: <Trash2 />, onClick: () => remove(g), danger: true },
                            ]}
                          />
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Drawer open={Boolean(detail)} onClose={() => setDetail(null)} width={480}>
        {detail && (
          <div className="flex h-full flex-col">
            <div className="border-b border-ink-100 px-5 py-4">
              <p className="text-lg font-semibold">{detail.title}</p>
              <p className="text-sm text-ink-500">
                {detail.owner.name} · até {fmtDate(detail.dueDate)}
              </p>
            </div>
            <div className="scroll-thin flex-1 space-y-5 overflow-y-auto px-5 py-4">
              <div>
                <div className="mb-1.5 flex justify-between text-sm">
                  <span className="num font-medium">
                    {formatGoalValue(detail.currentValue, detail.unit)} de {formatGoalValue(detail.targetValue, detail.unit)}
                  </span>
                  <span className="num text-ink-500">{Math.round(detail.progress * 100)}%</span>
                </div>
                <ProgressBar value={detail.progress} marker={detail.elapsed} color={goalState(detail).color} />
                <p className="mt-1.5 text-xs text-ink-500">O traço mostra onde a meta deveria estar hoje ({Math.round(detail.elapsed * 100)}% do prazo).</p>
              </div>
              {detail.description && <p className="whitespace-pre-line text-sm text-ink-700">{detail.description}</p>}
              <div>
                <p className="mb-2 text-[13px] font-medium text-ink-500">Atualizações</p>
                {detail.checkins.length ? (
                  <ol className="space-y-3 border-l border-ink-200 pl-4">
                    {detail.checkins.map((c) => (
                      <li key={c.id} className="relative text-sm">
                        <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full border-2 border-white bg-brand-500" />
                        <p className="num font-medium">{formatGoalValue(c.value, detail.unit)}</p>
                        {c.note && <p className="text-ink-600">{c.note}</p>}
                        <p className="text-xs text-ink-400">
                          {c.author.name} · {fmtDateTime(c.createdAt)}
                        </p>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-sm text-ink-500">Nenhuma atualização ainda.</p>
                )}
              </div>
            </div>
          </div>
        )}
      </Drawer>

      {editing !== undefined && <GoalModal goal={editing ?? undefined} defaultOwner={me.id} onClose={() => setEditing(undefined)} />}
      {checkin && <CheckinModal goal={checkin} onClose={() => setCheckin(null)} />}
    </div>
  );
}
