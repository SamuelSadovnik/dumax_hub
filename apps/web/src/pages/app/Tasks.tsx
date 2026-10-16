import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import clsx from 'clsx';
import { toast } from 'sonner';
import { AlertTriangle, ArrowRightLeft, CalendarClock, Check, CheckSquare, ChevronRight, Clock, Columns3, List, Lock, MessageSquare, Plus, Search, Send, Trash2, X } from 'lucide-react';
import {
  BOARD_STATUSES, TASK_PRIORITIES, TASK_PRIORITY_COLOR, TASK_PRIORITY_LABEL, TASK_STATUSES, TASK_STATUS_COLOR, TASK_STATUS_LABEL,
  type TaskPriority, type TaskStatus,
} from '@dumax/shared';
import { api, errorMessage } from '@/lib/api';
import { useAuth, useMe } from '@/lib/auth';
import { useUsers } from '@/lib/hooks';
import { useSocketEvent } from '@/lib/socket';
import type { Task, TaskDetail, UserLite } from '@/lib/types';
import { dueLabel, fmtDateTime, fromNow, isoToLocalInput, localInputToIso } from '@/lib/format';
import { Avatar, Badge, Button, Drawer, EmptyState, Field, Input, Modal, PageHeader, PageLoader, Select, Tabs, Textarea, UserPicker } from '@/components/ui';

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
type ExtensionRequest = {
  id: string;
  requestedDueAt: string;
  previousDueAt: string | null;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  decisionNote: string | null;
  createdAt: string;
  decidedAt: string | null;
  requester: UserLite;
  decidedBy: UserLite | null;
};
type TaskDetailFull = Omit<TaskDetail, 'extensionRequests'> & { extensionRequests: ExtensionRequest[] };

const ACTIVITY_TEXT: Record<string, (d: Record<string, unknown> | null, names: (id: string) => string) => string> = {
  CREATED: () => 'criou a demanda',
  ASSIGNED: () => 'atribuiu',
  DELEGATED: (d, n) => `delegou de ${n(String(d?.from))} para ${n(String(d?.to))}`,
  STATUS_CHANGED: (d) => `mudou para "${TASK_STATUS_LABEL[d?.to as TaskStatus] ?? d?.to}"`,
  UPDATED: (d) =>
    d?.kind === 'EXTENSION_REQUESTED'
      ? `pediu prorrogação até ${fmtDateTime(String(d.to))}`
      : d?.kind === 'EXTENSION_APPROVED'
        ? 'aprovou a prorrogação do prazo'
        : d?.kind === 'EXTENSION_REJECTED'
          ? 'recusou a prorrogação do prazo'
          : 'editou a demanda',
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
  const [asking, setAsking] = useState(false);
  const [reviewNote, setReviewNote] = useState('');
  const [askDate, setAskDate] = useState('');
  const [askReason, setAskReason] = useState('');
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

  const askExtension = useMutation({
    mutationFn: () => api.post(`/tasks/${id}/extension`, { requestedDueAt: localInputToIso(askDate), reason: askReason }),
    onSuccess: () => {
      toast.success('Pedido enviado para quem criou a demanda');
      setAsking(false);
      setAskDate('');
      setAskReason('');
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const decide = useMutation({
    mutationFn: ({ requestId, approve }: { requestId: string; approve: boolean }) => api.post(`/tasks/${id}/extension/${requestId}/decide`, { approve }),
    onSuccess: (_r, v) => {
      toast.success(v.approve ? 'Prazo prorrogado' : 'Pedido recusado');
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const reviewTask = useMutation({
    mutationFn: (approve: boolean) => api.post(`/tasks/${id}/review`, { approve, note: reviewNote.trim() || undefined }),
    onSuccess: (_r, approve) => {
      toast.success(approve ? 'Entrega aprovada' : 'Ajustes pedidos');
      setReviewNote('');
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  // Prazo travado: quem recebeu de outra pessoa só pede prorrogação
  const dueLocked = Boolean(task && task.assigneeId === me.id && task.createdById !== task.assigneeId);
  const pendingExt = task?.extensionRequests.find((r) => r.status === 'PENDING') ?? null;
  const canDecide = Boolean(task && (task.createdById === me.id || me.role === 'ADMIN' || me.role === 'HR'));

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
                {dueLocked ? (
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-ink-50 px-3 text-sm font-medium text-ink-800" title="Definido por quem enviou a demanda">
                      <Lock className="h-3.5 w-3.5 text-ink-400" />
                      {task.dueAt ? fmtDateTime(task.dueAt) : 'Sem prazo'}
                    </span>
                    {!pendingExt && task.status !== 'DONE' && task.status !== 'CANCELED' && !asking && (
                      <Button variant="ghost" size="sm" icon={<CalendarClock className="h-3.5 w-3.5" />} onClick={() => setAsking(true)}>
                        Pedir mais prazo
                      </Button>
                    )}
                  </span>
                ) : (
                  <Input
                    key={task.dueAt ?? 'sem-prazo'}
                    type="datetime-local"
                    className="w-56"
                    defaultValue={isoToLocalInput(task.dueAt)}
                    onBlur={(e) => e.target.value !== isoToLocalInput(task.dueAt) && patch.mutate({ dueAt: e.target.value ? localInputToIso(e.target.value) : null })}
                  />
                )}
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
            </dl>

            {asking && (
              <div className="space-y-3 rounded-xl border border-ink-200 bg-ink-50 p-4">
                <p className="text-sm font-medium">Pedir mais prazo para {task.createdBy.name.split(' ')[0]}</p>
                <Field label="Nova data">
                  <Input type="datetime-local" value={askDate} onChange={(e) => setAskDate(e.target.value)} className="w-56" />
                </Field>
                <Field label="Motivo">
                  <Textarea rows={2} value={askReason} onChange={(e) => setAskReason(e.target.value)} placeholder="Ex.: o cliente só envia os dados na quinta." />
                </Field>
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setAsking(false)}>
                    Cancelar
                  </Button>
                  <Button size="sm" disabled={!askDate || askReason.trim().length < 3} loading={askExtension.isPending} onClick={() => askExtension.mutate()}>
                    Enviar pedido
                  </Button>
                </div>
              </div>
            )}

            {task.status === 'IN_REVIEW' && task.createdById !== task.assigneeId && (
              <div className="rounded-xl border border-brand-200 bg-brand-50 p-4 text-sm">
                <p className="font-medium text-ink-900">
                  {task.assigneeId === me.id ? `Você entregou. Aguardando aprovação de ${task.createdBy.name.split(' ')[0]}.` : `${task.assignee.name.split(' ')[0]} entregou esta demanda.`}
                </p>
                {canDecide && task.assigneeId !== me.id && (
                  <div className="mt-3 space-y-2">
                    <Textarea rows={2} value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} placeholder="Comentário (obrigatório para pedir ajustes)" />
                    <div className="flex gap-2">
                      <Button size="sm" loading={reviewTask.isPending} onClick={() => reviewTask.mutate(true)}>
                        Aprovar entrega
                      </Button>
                      <Button size="sm" variant="secondary" disabled={reviewTask.isPending || reviewNote.trim().length < 3} onClick={() => reviewTask.mutate(false)}>
                        Pedir ajustes
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {pendingExt && (
              <div className="rounded-xl border border-warn/30 bg-warn-soft p-4 text-sm">
                <p className="font-medium text-ink-900">
                  {pendingExt.requester.id === me.id ? 'Você pediu' : `${pendingExt.requester.name.split(' ')[0]} pediu`} mais prazo: até {fmtDateTime(pendingExt.requestedDueAt)}
                </p>
                <p className="mt-0.5 text-ink-700">“{pendingExt.reason}”</p>
                {canDecide && pendingExt.requester.id !== me.id ? (
                  <div className="mt-3 flex gap-2">
                    <Button size="sm" loading={decide.isPending} onClick={() => decide.mutate({ requestId: pendingExt.id, approve: true })}>
                      Aprovar novo prazo
                    </Button>
                    <Button size="sm" variant="secondary" disabled={decide.isPending} onClick={() => decide.mutate({ requestId: pendingExt.id, approve: false })}>
                      Recusar
                    </Button>
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-ink-500">Aguardando resposta de {task.createdBy.name.split(' ')[0]}.</p>
                )}
              </div>
            )}

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
    <div onClick={onOpen} className="cursor-pointer rounded-xl border border-ink-200/80 bg-white p-3 shadow-card transition hover:border-brand-200 hover:shadow-lift">
      <p className="text-sm font-medium leading-snug text-ink-900">{task.title}</p>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 whitespace-nowrap text-2xs text-ink-500">
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
        {!!task.extensionRequests?.length && (
          <span className="flex items-center gap-1 font-medium text-warn" title="Pedido de prorrogação aguardando resposta">
            <CalendarClock className="h-3 w-3" /> prazo
          </span>
        )}
        <span className="ml-auto flex items-center gap-1.5">
          <Avatar user={showAssignee ? task.assignee : task.createdBy} size={22} />
        </span>
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
    <div ref={setNodeRef} className={clsx('flex min-h-0 min-w-[184px] flex-1 basis-0 flex-col rounded-2xl border p-1.5 transition-colors', isOver ? 'border-brand-300 bg-brand-50' : 'border-transparent bg-ink-100/70')}>
      <div className="flex h-8 shrink-0 items-center gap-2 px-2">
        <span className="h-2 w-2 rounded-full" style={{ background: TASK_STATUS_COLOR[status] }} />
        <p className="text-[13px] font-semibold text-ink-800">{TASK_STATUS_LABEL[status]}</p>
        <span className="num text-xs text-ink-400">{tasks.length}</span>
      </div>
      <div className="scroll-thin flex min-h-[44px] flex-1 flex-col gap-1.5 overflow-y-auto p-0.5">
        {tasks.map((t) => (
          <DraggableCard key={t.id} task={t} onOpen={() => onOpen(t.id)} showAssignee={showAssignee} mine={t.assigneeId === meId} />
        ))}
        {!tasks.length && <div className="rounded-lg border border-dashed border-ink-200 py-3 text-center text-xs text-ink-400">Vazio</div>}
      </div>
    </div>
  );
}

// ───────────── Página ─────────────
// ───────────── Meu trabalho (lista por urgência) ─────────────
const DAY = 86400000;
const CLOSED: TaskStatus[] = ['DONE', 'CANCELED'];
const startOfToday = () => {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
};

/** Cor do prazo no padrão do Linear: vermelho atrasado, laranja nos próximos 7 dias, cinza depois */
function dueTone(t: Task) {
  if (!t.dueAt || CLOSED.includes(t.status)) return 'text-ink-400';
  const due = new Date(t.dueAt).getTime();
  if (due < Date.now()) return 'font-medium text-bad';
  if (due < startOfToday() + 7 * DAY) return 'font-medium text-warn';
  return 'text-ink-500';
}

function buckets(tasks: Task[]) {
  const today = startOfToday();
  const open = tasks.filter((t) => !CLOSED.includes(t.status));
  const prio = (t: Task) => TASK_PRIORITIES.length - TASK_PRIORITIES.indexOf(t.priority);
  const byDue = (a: Task, b: Task) => (a.dueAt ? +new Date(a.dueAt) : Infinity) - (b.dueAt ? +new Date(b.dueAt) : Infinity) || prio(a) - prio(b);
  const at = (t: Task) => (t.dueAt ? +new Date(t.dueAt) : null);
  const groups = [
    { key: 'late', label: 'Atrasadas', dot: '#D93036', items: open.filter((t) => at(t) !== null && at(t)! < Date.now()) },
    { key: 'today', label: 'Hoje', dot: '#C77700', items: open.filter((t) => at(t) !== null && at(t)! >= Date.now() && at(t)! < today + DAY) },
    { key: 'week', label: 'Próximos 7 dias', dot: '#2D3FE0', items: open.filter((t) => at(t) !== null && at(t)! >= today + DAY && at(t)! < today + 7 * DAY) },
    { key: 'later', label: 'Mais adiante', dot: '#8A93AD', items: open.filter((t) => at(t) !== null && at(t)! >= today + 7 * DAY) },
    { key: 'none', label: 'Sem prazo', dot: '#C5CAD6', items: open.filter((t) => at(t) === null) },
  ].map((g) => ({ ...g, items: g.items.sort(byDue) }));
  const done = tasks
    .filter((t) => t.status === 'DONE' && (!t.completedAt || Date.now() - +new Date(t.completedAt) < 14 * DAY))
    .sort((a, b) => +new Date(b.completedAt ?? b.createdAt) - +new Date(a.completedAt ?? a.createdAt));
  return { groups, done };
}

function WorkRow({ t, onOpen, onToggle, showAssignee, mine }: { t: Task; onOpen: () => void; onToggle: () => void; showAssignee: boolean; mine: boolean }) {
  const done = t.status === 'DONE';
  const review = t.status === 'IN_REVIEW';
  const due = dueLabel(t.dueAt);
  const doneItems = t.checklist.filter((c) => c.done).length;
  const who = showAssignee ? t.assignee : t.createdBy;
  return (
    <li className="group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-ink-50/70">
      <button
        onClick={onToggle}
        disabled={review}
        aria-label={review ? 'Aguardando aprovação' : done ? 'Reabrir demanda' : 'Concluir demanda'}
        title={review ? `Aguardando aprovação de ${t.createdBy.name.split(' ')[0]}` : done ? 'Reabrir' : 'Concluir'}
        className={clsx(
          'flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-[1.5px] transition',
          review ? 'cursor-default border-warn bg-warn-soft text-warn' : done ? 'border-ok bg-ok text-white' : 'border-ink-300 text-transparent hover:border-ok hover:bg-ok-soft hover:text-ok',
        )}
      >
        {review ? <Clock className="h-2.5 w-2.5" strokeWidth={3} /> : <Check className="h-3 w-3" strokeWidth={3} />}
      </button>
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: TASK_PRIORITY_COLOR[t.priority] }} title={`Prioridade ${TASK_PRIORITY_LABEL[t.priority].toLowerCase()}`} />
      <button onClick={onOpen} className="min-w-0 flex-1 text-left">
        <span className={clsx('block truncate text-sm', done ? 'text-ink-400 line-through' : 'font-medium text-ink-900 group-hover:text-brand-700')}>{t.title}</span>
      </button>
      <span className="hidden shrink-0 items-center gap-3 text-xs text-ink-500 md:flex">
        {(t.status === 'IN_PROGRESS' || t.status === 'BLOCKED' || t.status === 'IN_REVIEW') && (
          <Badge color={TASK_STATUS_COLOR[t.status]} dot>
            {TASK_STATUS_LABEL[t.status]}
          </Badge>
        )}
        {t.checklist.length > 0 && (
          <span className="num flex items-center gap-1">
            <CheckSquare className="h-3.5 w-3.5" /> {doneItems}/{t.checklist.length}
          </span>
        )}
        {t._count.comments > 0 && (
          <span className="num flex items-center gap-1">
            <MessageSquare className="h-3.5 w-3.5" /> {t._count.comments}
          </span>
        )}
        {!!t.extensionRequests?.length && (
          <span className="flex items-center gap-1 font-medium text-warn">
            <CalendarClock className="h-3.5 w-3.5" /> Pediu mais prazo
          </span>
        )}
      </span>
      <span className={clsx('w-24 shrink-0 text-right text-xs', dueTone(t))}>{due?.text ?? ''}</span>
      <span className="flex shrink-0 items-center justify-end" title={showAssignee ? `Com ${who.name}` : `Enviada por ${who.name}`}>
        <Avatar user={who} size={24} />
      </span>
    </li>
  );
}

/** Criação rápida: digita e aperta Enter (fica com você) */
function QuickAdd() {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [when, setWhen] = useState<'today' | 'tomorrow' | 'friday' | null>(null);
  const dueAt = () => {
    if (!when) return null;
    const d = new Date(startOfToday());
    if (when === 'tomorrow') d.setDate(d.getDate() + 1);
    if (when === 'friday') d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7 || 7));
    d.setHours(18, 0, 0, 0);
    return d.toISOString();
  };
  const create = useMutation({
    mutationFn: () => api.post<Task>('/tasks', { title: title.trim(), dueAt: dueAt() }),
    onSuccess: () => {
      setTitle('');
      setWhen(null);
      toast.success('Demanda criada');
      qc.invalidateQueries({ queryKey: ['tasks'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (title.trim().length >= 2) create.mutate();
      }}
      className="card flex flex-wrap items-center gap-2 px-3 py-2 focus-within:border-brand-300 focus-within:ring-4 focus-within:ring-brand-500/10"
    >
      <Plus className="h-4 w-4 shrink-0 text-ink-400" />
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Adicionar uma demanda para você e apertar Enter"
        className="h-8 min-w-[220px] flex-1 bg-transparent text-sm outline-none placeholder:text-ink-400"
        aria-label="Nova demanda"
      />
      <span className="flex gap-1">
        {(
          [
            ['today', 'Hoje'],
            ['tomorrow', 'Amanhã'],
            ['friday', 'Sexta'],
          ] as const
        ).map(([k, l]) => (
          <button
            key={k}
            type="button"
            onClick={() => setWhen(when === k ? null : k)}
            className={clsx('h-7 rounded-full px-2.5 text-xs font-medium transition', when === k ? 'bg-brand-600 text-white' : 'bg-ink-100 text-ink-600 hover:bg-ink-200')}
          >
            {l}
          </button>
        ))}
      </span>
      <Button type="submit" size="sm" loading={create.isPending} disabled={title.trim().length < 2}>
        Adicionar
      </Button>
    </form>
  );
}

function WorkList({ tasks, onOpen, onToggle, showAssignee, meId, quickAdd }: { tasks: Task[]; onOpen: (id: string) => void; onToggle: (t: Task) => void; showAssignee: boolean; meId: string; quickAdd: boolean }) {
  const { groups, done } = buckets(tasks);
  const [showDone, setShowDone] = useState(false);
  const empty = groups.every((g) => !g.items.length);
  return (
    <div className="scroll-thin -mx-1 min-h-0 flex-1 space-y-5 overflow-y-auto px-1 pb-4">
      {quickAdd && <QuickAdd />}
      {empty && (
        <div className="card">
          <EmptyState compact icon={<CheckSquare />} title="Tudo em dia" text="Nenhuma demanda aberta por aqui." />
        </div>
      )}
      {groups
        .filter((g) => g.items.length)
        .map((g) => (
          <section key={g.key}>
            <h2 className="mb-2 flex items-center gap-2 px-1 text-[13px] font-semibold text-ink-700">
              <span className="h-2 w-2 rounded-full" style={{ background: g.dot }} />
              {g.label}
              <span className="num font-normal text-ink-400">{g.items.length}</span>
            </h2>
            <ul className="card divide-y divide-ink-100 overflow-hidden">
              {g.items.map((t) => (
                <WorkRow key={t.id} t={t} onOpen={() => onOpen(t.id)} onToggle={() => onToggle(t)} showAssignee={showAssignee} mine={t.assigneeId === meId} />
              ))}
            </ul>
          </section>
        ))}
      {done.length > 0 && (
        <section>
          <button onClick={() => setShowDone((v) => !v)} className="mb-2 flex items-center gap-1.5 px-1 text-[13px] font-semibold text-ink-500 hover:text-ink-800">
            <ChevronRight className={clsx('h-4 w-4 transition-transform', showDone && 'rotate-90')} />
            Concluídas nos últimos 14 dias
            <span className="num font-normal text-ink-400">{done.length}</span>
          </button>
          {showDone && (
            <ul className="card divide-y divide-ink-100 overflow-hidden">
              {done.map((t) => (
                <WorkRow key={t.id} t={t} onOpen={() => onOpen(t.id)} onToggle={() => onToggle(t)} showAssignee={showAssignee} mine={t.assigneeId === meId} />
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

export default function Tasks() {
  const me = useMe();
  const { isHR } = useAuth();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [scope, setScope] = useState<Scope>('mine');
  const [view, setView] = useState<'board' | 'list'>('list');
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
  const openCount = (tasks ?? []).filter((t) => !CLOSED.includes(t.status)).length;
  // No quadro, a coluna Concluída mostra só os últimos 14 dias
  const boardTasks = filtered.filter((t) => t.status !== 'DONE' || !t.completedAt || Date.now() - +new Date(t.completedAt) < 14 * DAY);
  const toggleDone = (t: Task) => {
    if (t.status === 'IN_REVIEW') return;
    // Veio de outra pessoa: a entrega vai para aprovação de quem enviou
    const needsApproval = t.assigneeId === me.id && t.createdById !== t.assigneeId;
    const next: TaskStatus = t.status === 'DONE' ? 'TODO' : needsApproval ? 'IN_REVIEW' : 'DONE';
    move.mutate({ id: t.id, status: next });
    if (next === 'IN_REVIEW') toast.success(`Entrega enviada para ${t.createdBy.name.split(' ')[0]} aprovar`);
    else if (next === 'DONE') toast.success('Demanda concluída', { action: { label: 'Desfazer', onClick: () => move.mutate({ id: t.id, status: t.status }) } });
  };
  const showAssignee = scope !== 'mine';

  const scopes: { value: Scope; label: string }[] = [
    { value: 'mine', label: 'Comigo' },
    { value: 'created', label: 'Enviadas' },
    ...(me.role !== 'EMPLOYEE' ? [{ value: 'team' as Scope, label: 'Meu time' }] : []),
    ...(isHR ? [{ value: 'all' as Scope, label: 'Empresa' }] : []),
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Demandas"
        subtitle={`${openCount} ${openCount === 1 ? 'aberta' : 'abertas'}${overdueCount ? `, ${overdueCount} ${overdueCount === 1 ? 'atrasada' : 'atrasadas'}` : ''}`}
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
              {
                value: 'list',
                label: (
                  <span className="flex items-center gap-1.5">
                    <List className="h-4 w-4" /> Lista
                  </span>
                ),
              },
              {
                value: 'board',
                label: (
                  <span className="flex items-center gap-1.5">
                    <Columns3 className="h-4 w-4" /> Quadro
                  </span>
                ),
              },
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
          <div className="scroll-thin flex min-h-0 flex-1 items-stretch gap-3 overflow-x-auto pb-1">
            {BOARD_STATUSES.map((s) => (
              <Column key={s} status={s} tasks={boardTasks.filter((t) => t.status === s)} onOpen={(id) => setParams({ task: id })} showAssignee={showAssignee} meId={me.id} />
            ))}
          </div>
        </DndContext>
      ) : (
        <WorkList tasks={filtered} onOpen={(id) => setParams({ task: id })} onToggle={toggleDone} showAssignee={showAssignee} meId={me.id} quickAdd={scope === 'mine' && !search && !onlyOverdue} />
      )}

      <NewTaskModal open={creating} onClose={() => setCreating(false)} />
      <TaskDrawer id={openId} onClose={() => setParams({})} />
    </div>
  );
}
