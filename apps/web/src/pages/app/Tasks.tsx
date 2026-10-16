import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import clsx from 'clsx';
import { toast } from 'sonner';
import { AlertTriangle, ArrowRightLeft, CheckSquare, Clock, Columns3, List, MessageSquare, Plus, Search, Send, Trash2, X } from 'lucide-react';
import {
  BOARD_STATUSES, TASK_PRIORITIES, TASK_PRIORITY_COLOR, TASK_PRIORITY_LABEL, TASK_STATUSES, TASK_STATUS_COLOR, TASK_STATUS_LABEL,
  TIMELOG_ACTIVITY_LABEL, formatMinutes, type TaskPriority, type TaskStatus, type TimeLogActivity,
} from '@dumax/shared';
import { api, errorMessage } from '@/lib/api';
import { useAuth, useMe } from '@/lib/auth';
import { useUsers } from '@/lib/hooks';
import { useSocketEvent } from '@/lib/socket';
import type { Task, TaskDetail, UserLite } from '@/lib/types';
import { dueLabel, fmtDateTime, fromNow, isoToLocalInput, localInputToIso } from '@/lib/format';
import { Avatar, Badge, Button, Drawer, EmptyState, Field, Input, Modal, PageHeader, PageLoader, Select, Tabs, Textarea, UserPicker } from '@/components/ui';
import { TaskTimerButton } from '@/components/Timer';

type Scope = 'mine' | 'created' | 'team' | 'all';

// ───────────── Criar demanda ─────────────
export function NewTaskModal({ open, onClose, defaultAssignee }: { open: boolean; onClose: () => void; defaultAssignee?: string }) {
  const me = useMe();
  const qc = useQueryClient();
  const { data: users = [] } = useUsers();
  const empty = { title: '', description: '', assigneeId: defaultAssignee ?? me.id, priority: 'MEDIUM' as TaskPriority, dueAt: '', checklist: '' };
  const [form, setForm] = useState(empty);
  const [tried, setTried] = useState(false);
  const titleError = form.title.trim().length < 2 ? 'Descreva a demanda' : null;

  const create = useMutation({
    mutationFn: () =>
      api.post<Task>('/tasks', {
        title: form.title.trim(),
        description: form.description || null,
        assigneeId: form.assigneeId,
        priority: form.priority,
        dueAt: form.dueAt ? localInputToIso(form.dueAt) : null,
        checklist: form.checklist.split('\n').map((s) => s.trim()).filter(Boolean),
      }),
    onSuccess: (t) => {
      toast.success(t.assigneeId === me.id ? 'Demanda criada' : `Demanda enviada para ${t.assignee.name}`);
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['inbox'] });
      setForm(empty);
      setTried(false);
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const submit = () => {
    setTried(true);
    if (!titleError) create.mutate();
  };
  const setDue = (d: Date) => setForm((f) => ({ ...f, dueAt: isoToLocalInput(d.toISOString()) }));
  const quick: [string, () => Date][] = [
    ['Hoje 18h', () => { const d = new Date(); d.setHours(18, 0, 0, 0); return d; }],
    ['Amanhã 18h', () => { const d = new Date(Date.now() + 86400000); d.setHours(18, 0, 0, 0); return d; }],
    ['Em 3 dias', () => { const d = new Date(Date.now() + 3 * 86400000); d.setHours(18, 0, 0, 0); return d; }],
    ['Em 1 semana', () => { const d = new Date(Date.now() + 7 * 86400000); d.setHours(18, 0, 0, 0); return d; }],
  ];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nova demanda"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={create.isPending} onClick={submit} icon={<Send className="h-4 w-4" />}>
            {form.assigneeId === me.id ? 'Criar demanda' : 'Enviar demanda'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="O que precisa ser feito" required error={tried ? titleError : null}>
          <Input autoFocus invalid={tried && !!titleError} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && submit()} placeholder="Ex.: Enviar relatório de vendas de outubro" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Responsável">
            <UserPicker users={users} value={form.assigneeId} onChange={(v) => setForm({ ...form, assigneeId: v as string })} />
          </Field>
          <Field label="Prioridade">
            <Select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as TaskPriority })}>
              {TASK_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {TASK_PRIORITY_LABEL[p]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Prazo">
          <Input type="datetime-local" value={form.dueAt} onChange={(e) => setForm({ ...form, dueAt: e.target.value })} />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {quick.map(([label, fn]) => (
              <button key={label} type="button" onClick={() => setDue(fn())} className="rounded-md border border-ink-200 px-2 py-0.5 text-xs text-ink-600 hover:border-brand-300 hover:text-brand-700">
                {label}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Detalhes">
          <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Contexto, links e o que define a entrega como pronta" />
        </Field>
        <Field label="Checklist" hint="Um item por linha">
          <Textarea rows={3} value={form.checklist} onChange={(e) => setForm({ ...form, checklist: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}

// ───────────── Detalhe ─────────────
type TaskDetailFull = TaskDetail & { timeLogs: { id: string; minutes: number; startedAt: string; endedAt: string | null; activity: TimeLogActivity; user: UserLite }[] };

const ACTIVITY_TEXT: Record<string, (d: Record<string, unknown> | null, names: (id: string) => string) => string> = {
  CREATED: () => 'criou a demanda',
  ASSIGNED: () => 'atribuiu',
  DELEGATED: (d, n) => `delegou de ${n(String(d?.from))} para ${n(String(d?.to))}`,
  STATUS_CHANGED: (d) => `mudou para "${TASK_STATUS_LABEL[d?.to as TaskStatus] ?? d?.to}"`,
  UPDATED: () => 'editou a demanda',
  COMMENTED: () => 'comentou',
};

function TaskDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const me = useMe();
  const qc = useQueryClient();
  const { data: users = [] } = useUsers();
  const { data: task, isLoading } = useQuery({ queryKey: ['task', id], queryFn: () => api.get<TaskDetailFull>(`/tasks/${id}`), enabled: Boolean(id) });
  const [comment, setComment] = useState('');
  const [delegating, setDelegating] = useState(false);
  const [delegateTo, setDelegateTo] = useState<string | null>(null);
  const [delegateNote, setDelegateNote] = useState('');
  const [newItem, setNewItem] = useState('');
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['task', id] });
    qc.invalidateQueries({ queryKey: ['tasks'] });
    qc.invalidateQueries({ queryKey: ['inbox'] });
  };
  const nameOf = (uid: string) => users.find((u) => u.id === uid)?.name ?? 'alguém';

  const patch = useMutation({ mutationFn: (body: Record<string, unknown>) => api.patch(`/tasks/${id}`, body), onSuccess: refresh, onError: (e) => toast.error(errorMessage(e)) });
  const addComment = useMutation({
    mutationFn: () => api.post(`/tasks/${id}/comments`, { body: comment }),
    onSuccess: () => {
      setComment('');
      refresh();
    },
  });
  const delegate = useMutation({
    mutationFn: () => api.post<Task>(`/tasks/${id}/delegate`, { assigneeId: delegateTo, note: delegateNote || undefined }),
    onSuccess: (t) => {
      toast.success(`Delegada para ${t.assignee.name}`);
      setDelegating(false);
      setDelegateNote('');
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const toggleItem = (itemId: string, done: boolean) => api.patch(`/tasks/${id}/checklist/${itemId}`, { done }).then(refresh);
  const addItem = async () => {
    if (!newItem.trim()) return;
    await api.post(`/tasks/${id}/checklist`, { title: newItem });
    setNewItem('');
    refresh();
  };
  const remove = async () => {
    if (!confirm('Excluir esta demanda?')) return;
    await api.del(`/tasks/${id}`);
    refresh();
    onClose();
  };

  const totalMinutes = task?.timeLogs.reduce((a, l) => a + l.minutes, 0) ?? 0;

  return (
    <Drawer open={Boolean(id)} onClose={onClose} width={620}>
      {isLoading || !task ? (
        <PageLoader />
      ) : (
        <>
          <div className="flex items-start gap-3 border-b border-ink-100 px-5 py-4">
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-semibold leading-snug">{task.title}</h2>
              <p className="mt-0.5 text-xs text-ink-500">
                Criada por {task.createdBy.name} {fromNow(task.createdAt)}
              </p>
            </div>
            {task.assigneeId === me.id && <TaskTimerButton taskId={task.id} />}
            {(task.createdById === me.id || me.role === 'ADMIN' || me.role === 'HR') && (
              <Button variant="ghost" size="icon-sm" onClick={remove} title="Excluir">
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
            <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Fechar">
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="scroll-thin flex-1 space-y-6 overflow-y-auto px-5 py-5">
            <dl className="grid grid-cols-[120px_1fr] items-center gap-x-4 gap-y-3 text-sm">
              <dt className="text-ink-500">Status</dt>
              <dd>
                <Select value={task.status} onChange={(e) => patch.mutate({ status: e.target.value })} className="w-48">
                  {TASK_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {TASK_STATUS_LABEL[s]}
                    </option>
                  ))}
                </Select>
              </dd>
              <dt className="text-ink-500">Prioridade</dt>
              <dd>
                <Select value={task.priority} onChange={(e) => patch.mutate({ priority: e.target.value })} className="w-48">
                  {TASK_PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {TASK_PRIORITY_LABEL[p]}
                    </option>
                  ))}
                </Select>
              </dd>
              <dt className="text-ink-500">Prazo</dt>
              <dd>
                <Input
                  key={task.dueAt ?? 'sem-prazo'}
                  type="datetime-local"
                  className="w-56"
                  defaultValue={isoToLocalInput(task.dueAt)}
                  onBlur={(e) => e.target.value !== isoToLocalInput(task.dueAt) && patch.mutate({ dueAt: e.target.value ? localInputToIso(e.target.value) : null })}
                />
              </dd>
              <dt className="text-ink-500">Responsável</dt>
              <dd className="flex items-center gap-2">
                <Avatar user={task.assignee} size={24} />
                <span className="font-medium">{task.assignee.name}</span>
                {!delegating && (
                  <Button variant="ghost" size="sm" icon={<ArrowRightLeft className="h-3.5 w-3.5" />} onClick={() => setDelegating(true)} className="ml-auto">
                    Delegar
                  </Button>
                )}
              </dd>
              <dt className="text-ink-500">Tempo registrado</dt>
              <dd className="num font-medium">{totalMinutes ? formatMinutes(totalMinutes) : <span className="font-normal text-ink-400">nenhum</span>}</dd>
            </dl>

            {delegating && (
              <div className="space-y-3 rounded-lg border border-ink-200 bg-ink-50 p-4">
                <p className="text-sm font-medium">Delegar para</p>
                <UserPicker users={users.filter((u) => u.id !== task.assigneeId)} value={delegateTo} onChange={(v) => setDelegateTo(v as string)} />
                <Input placeholder="Recado para a pessoa (opcional)" value={delegateNote} onChange={(e) => setDelegateNote(e.target.value)} />
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setDelegating(false)}>
                    Cancelar
                  </Button>
                  <Button size="sm" disabled={!delegateTo} loading={delegate.isPending} onClick={() => delegate.mutate()}>
                    Delegar demanda
                  </Button>
                </div>
              </div>
            )}

            {task.description && (
              <section>
                <h3 className="mb-1.5 text-[13px] font-medium text-ink-500">Detalhes</h3>
                <p className="whitespace-pre-line text-sm text-ink-800">{task.description}</p>
              </section>
            )}

            <section>
              <h3 className="mb-1.5 text-[13px] font-medium text-ink-500">
                Checklist {task.checklist.length > 0 && <span className="num">({task.checklist.filter((c) => c.done).length}/{task.checklist.length})</span>}
              </h3>
              <div>
                {task.checklist.map((c) => (
                  <label key={c.id} className="flex cursor-pointer items-center gap-2.5 rounded-md px-1 py-1.5 text-sm hover:bg-ink-50">
                    <input type="checkbox" className="h-4 w-4 accent-brand-500" checked={c.done} onChange={(e) => toggleItem(c.id, e.target.checked)} />
                    <span className={clsx(c.done && 'text-ink-400 line-through')}>{c.title}</span>
                  </label>
                ))}
                <Input className="mt-1.5" placeholder="Adicionar item e apertar Enter" value={newItem} onChange={(e) => setNewItem(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addItem()} />
              </div>
            </section>

            <section>
              <h3 className="mb-2 text-[13px] font-medium text-ink-500">Comentários</h3>
              <div className="space-y-3">
                {task.comments.map((c) => (
                  <div key={c.id} className="flex gap-2.5">
                    <Avatar user={c.author} size={26} />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs">
                        <span className="font-medium">{c.author.name}</span> <span className="text-ink-400">{fromNow(c.createdAt)}</span>
                      </p>
                      <p className="whitespace-pre-line text-sm text-ink-800">{c.body}</p>
                    </div>
                  </div>
                ))}
                <div className="flex gap-2">
                  <Input placeholder="Escreva um comentário" value={comment} onChange={(e) => setComment(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && comment.trim() && addComment.mutate()} />
                  <Button size="icon" disabled={!comment.trim()} loading={addComment.isPending} onClick={() => addComment.mutate()} aria-label="Enviar comentário">
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </section>

            {task.timeLogs.length > 0 && (
              <section>
                <h3 className="mb-1.5 text-[13px] font-medium text-ink-500">Registros de tempo</h3>
                <ul className="divide-y divide-ink-100 rounded-lg border border-ink-200 text-sm">
                  {task.timeLogs.map((l) => (
                    <li key={l.id} className="flex items-center gap-3 px-3 py-2">
                      <span className="flex-1 text-ink-600">{fmtDateTime(l.startedAt)} · {TIMELOG_ACTIVITY_LABEL[l.activity]}</span>
                      <span className="num font-medium">{l.endedAt ? formatMinutes(l.minutes) : 'em andamento'}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section>
              <h3 className="mb-2 text-[13px] font-medium text-ink-500">Histórico</h3>
              <ol className="space-y-2.5 border-l border-ink-200 pl-4">
                {task.activities.map((a) => (
                  <li key={a.id} className="relative text-xs text-ink-600">
                    <span className="absolute -left-[21px] top-1 h-2 w-2 rounded-full border-2 border-white bg-ink-300" />
                    <span className="font-medium text-ink-800">{a.actor.name}</span> {ACTIVITY_TEXT[a.type]?.(a.data, nameOf) ?? a.type}
                    {a.type === 'DELEGATED' && typeof a.data?.note === 'string' && <span className="block italic text-ink-500">"{a.data.note}"</span>}
                    <span className="block text-ink-400">{fmtDateTime(a.createdAt)}</span>
                  </li>
                ))}
              </ol>
            </section>
          </div>
        </>
      )}
    </Drawer>
  );
}

// ───────────── Quadro ─────────────
function TaskCard({ task, onOpen, showAssignee, mine }: { task: Task; onOpen: () => void; showAssignee: boolean; mine: boolean }) {
  const due = dueLabel(task.dueAt);
  const doneItems = task.checklist.filter((c) => c.done).length;
  const late = due?.tone === 'danger' && task.status !== 'DONE';
  return (
    <div onClick={onOpen} className="cursor-pointer rounded-lg border border-ink-200 bg-white p-3 transition hover:border-ink-300 hover:shadow-sm">
      <p className="text-sm font-medium leading-snug text-ink-900">{task.title}</p>
      <div className="mt-2.5 flex items-center gap-2.5 text-2xs text-ink-500">
        <span className="flex items-center gap-1" title={`Prioridade ${TASK_PRIORITY_LABEL[task.priority].toLowerCase()}`}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: TASK_PRIORITY_COLOR[task.priority] }} />
          {TASK_PRIORITY_LABEL[task.priority]}
        </span>
        {due && (
          <span className={clsx('flex items-center gap-1', late && 'font-medium text-bad', due.tone === 'warn' && 'font-medium text-warn')}>
            <Clock className="h-3 w-3" /> {due.text}
          </span>
        )}
        {task.checklist.length > 0 && (
          <span className="num flex items-center gap-1">
            <CheckSquare className="h-3 w-3" /> {doneItems}/{task.checklist.length}
          </span>
        )}
        {task._count.comments > 0 && (
          <span className="num flex items-center gap-1">
            <MessageSquare className="h-3 w-3" /> {task._count.comments}
          </span>
        )}
        <span className="flex-1" />
        {mine && task.status !== 'DONE' && <TaskTimerButton taskId={task.id} compact />}
        <Avatar user={showAssignee ? task.assignee : task.createdBy} size={20} />
      </div>
    </div>
  );
}

function DraggableCard(props: { task: Task; onOpen: () => void; showAssignee: boolean; mine: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: props.task.id });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={transform ? { transform: `translate(${transform.x}px, ${transform.y}px)`, zIndex: 50 } : undefined}
      className={clsx(isDragging && 'rotate-1 opacity-90 shadow-pop')}
    >
      <TaskCard {...props} />
    </div>
  );
}

function Column({ status, tasks, onOpen, showAssignee, meId }: { status: TaskStatus; tasks: Task[]; onOpen: (id: string) => void; showAssignee: boolean; meId: string }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <div ref={setNodeRef} className={clsx('flex max-h-full w-[288px] shrink-0 flex-col rounded-xl border p-1.5 transition-colors', isOver ? 'border-brand-300 bg-brand-50' : 'border-transparent bg-ink-100/70')}>
      <div className="flex h-8 shrink-0 items-center gap-2 px-2">
        <span className="h-2 w-2 rounded-full" style={{ background: TASK_STATUS_COLOR[status] }} />
        <p className="text-[13px] font-semibold text-ink-800">{TASK_STATUS_LABEL[status]}</p>
        <span className="num text-xs text-ink-400">{tasks.length}</span>
      </div>
      <div className="scroll-thin flex min-h-[44px] flex-col gap-1.5 overflow-y-auto p-0.5">
        {tasks.map((t) => (
          <DraggableCard key={t.id} task={t} onOpen={() => onOpen(t.id)} showAssignee={showAssignee} mine={t.assigneeId === meId} />
        ))}
        {!tasks.length && <div className="rounded-lg border border-dashed border-ink-200 py-3 text-center text-xs text-ink-400">Vazio</div>}
      </div>
    </div>
  );
}

// ───────────── Página ─────────────
export default function Tasks() {
  const me = useMe();
  const { isHR } = useAuth();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [scope, setScope] = useState<Scope>('mine');
  const [view, setView] = useState<'board' | 'list'>('board');
  const [search, setSearch] = useState('');
  const [onlyOverdue, setOnlyOverdue] = useState(false);
  const [creating, setCreating] = useState(false);
  const openId = params.get('task');

  const { data: tasks, isLoading } = useQuery({ queryKey: ['tasks', scope], queryFn: () => api.get<Task[]>('/tasks', { scope }) });
  useSocketEvent('task:update', () => qc.invalidateQueries({ queryKey: ['tasks'] }));

  const move = useMutation({
    mutationFn: ({ id, status }: { id: string; status: TaskStatus }) => api.patch(`/tasks/${id}`, { status }),
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: ['tasks', scope] });
      qc.setQueryData<Task[]>(['tasks', scope], (old) => old?.map((t) => (t.id === id ? { ...t, status } : t)));
    },
    onError: (e) => toast.error(errorMessage(e)),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['timer'] });
    },
  });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over) return;
    const t = tasks?.find((x) => x.id === e.active.id);
    const status = e.over.id as TaskStatus;
    if (t && t.status !== status) move.mutate({ id: t.id, status });
  };

  const isOverdue = (t: Task) => Boolean(t.dueAt && new Date(t.dueAt) < new Date() && !['DONE', 'CANCELED'].includes(t.status));
  const filtered = useMemo(
    () =>
      (tasks ?? []).filter(
        (t) => (!search || `${t.title} ${t.assignee.name}`.toLowerCase().includes(search.toLowerCase())) && (!onlyOverdue || isOverdue(t)),
      ),
    [tasks, search, onlyOverdue],
  );
  const overdueCount = (tasks ?? []).filter(isOverdue).length;
  const showAssignee = scope !== 'mine';

  const scopes: { value: Scope; label: string }[] = [
    { value: 'mine', label: 'Comigo' },
    { value: 'created', label: 'Enviadas' },
    ...(me.role !== 'EMPLOYEE' ? [{ value: 'team' as Scope, label: 'Meu time' }] : []),
    ...(isHR ? [{ value: 'all' as Scope, label: 'Empresa' }] : []),
  ];

  return (
    <div className="flex h-[calc(100vh-56px-48px)] flex-col">
      <PageHeader
        title="Demandas"
        actions={
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
            Nova demanda
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Tabs size="sm" value={scope} onChange={setScope} items={scopes} />
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <Input className="h-8 pl-8" placeholder="Buscar demanda ou pessoa" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <button
          onClick={() => setOnlyOverdue((v) => !v)}
          className={clsx(
            'flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[13px] font-medium transition',
            onlyOverdue ? 'border-bad/40 bg-bad-soft text-bad' : 'border-ink-200 bg-white text-ink-600 hover:border-ink-300',
          )}
        >
          <AlertTriangle className="h-3.5 w-3.5" /> Atrasadas <span className="num">{overdueCount}</span>
        </button>
        <div className="ml-auto">
          <Tabs
            size="sm"
            value={view}
            onChange={setView}
            items={[
              { value: 'board', label: <Columns3 className="h-4 w-4" aria-label="Quadro" /> },
              { value: 'list', label: <List className="h-4 w-4" aria-label="Lista" /> },
            ]}
          />
        </div>
      </div>

      {isLoading ? (
        <PageLoader />
      ) : !(tasks ?? []).length ? (
        <div className="card">
          <EmptyState icon={<CheckSquare />} title="Nenhuma demanda aqui" text="Crie uma demanda para você ou envie para alguém do time." action={<Button onClick={() => setCreating(true)}>Nova demanda</Button>} />
        </div>
      ) : view === 'board' ? (
        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
          <div className="scroll-thin -mx-4 flex min-h-0 flex-1 items-start gap-3 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
            {BOARD_STATUSES.map((s) => (
              <Column key={s} status={s} tasks={filtered.filter((t) => t.status === s)} onOpen={(id) => setParams({ task: id })} showAssignee={showAssignee} meId={me.id} />
            ))}
          </div>
        </DndContext>
      ) : (
        <div className="card scroll-thin min-h-0 overflow-auto">
          <table className="tbl min-w-[760px]">
            <thead>
              <tr>
                <th>Demanda</th>
                <th>Status</th>
                <th>Prioridade</th>
                <th>Prazo</th>
                <th>{showAssignee ? 'Responsável' : 'Enviada por'}</th>
                <th className="w-24" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => {
                const due = dueLabel(t.dueAt);
                const who = showAssignee ? t.assignee : t.createdBy;
                return (
                  <tr key={t.id} onClick={() => setParams({ task: t.id })} className="clickable">
                    <td className="font-medium">{t.title}</td>
                    <td>
                      <Badge color={TASK_STATUS_COLOR[t.status]} dot>
                        {TASK_STATUS_LABEL[t.status]}
                      </Badge>
                    </td>
                    <td>
                      <span className="flex items-center gap-1.5 text-[13px]">
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: TASK_PRIORITY_COLOR[t.priority] }} />
                        {TASK_PRIORITY_LABEL[t.priority]}
                      </span>
                    </td>
                    <td className={clsx('num text-[13px]', isOverdue(t) && 'font-medium text-bad')}>{due?.text ?? '—'}</td>
                    <td>
                      <span className="flex items-center gap-2 text-[13px]">
                        <Avatar user={who} size={22} /> {who.name}
                      </span>
                    </td>
                    <td className="text-right">{t.assigneeId === me.id && t.status !== 'DONE' && <TaskTimerButton taskId={t.id} compact />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <NewTaskModal open={creating} onClose={() => setCreating(false)} />
      <TaskDrawer id={openId} onClose={() => setParams({})} />
    </div>
  );
}
