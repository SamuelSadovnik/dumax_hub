import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { toast } from 'sonner';
import { ArrowLeft, Check, ChevronDown, MoreHorizontal, Plus, Sprout, Trash2, X } from 'lucide-react';
import { DEV_ACTION_KINDS, DEV_ACTION_LABEL, type DevActionKind } from '@dumax/shared';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { DevelopmentPlan, UserLite } from '@/lib/types';
import { fmtDateShort } from '@/lib/format';
import { Avatar, Button, EmptyState, Field, Input, Menu, Modal, PageHeader, PageLoader, ProgressBar, Select, Tabs } from '@/components/ui';

const FOCUS_SUGGESTIONS = ['Liderança', 'Comunicação', 'Técnico', 'Vendas', 'Atendimento', 'Organização', 'Ferramentas'];
const KIND_TONE: Record<DevActionKind, string> = { CURSO: 'bg-brand-50 text-brand-700', PRATICA: 'bg-ok-soft text-ok', MENTORIA: 'bg-warn-soft text-warn', LEITURA: 'bg-ink-100 text-ink-600', OUTRO: 'bg-ink-100 text-ink-600' };
const dateToIso = (v: string) => (v ? new Date(`${v}T12:00:00`).toISOString() : null);

type TeamRow = { user: UserLite & { department: { name: string } | null }; activePlans: number; actions: number; done: number };

function NewPlanModal({ userId, name, onClose }: { userId: string; name: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [focus, setFocus] = useState('');
  const [due, setDue] = useState('');
  const [actions, setActions] = useState<{ text: string; kind: DevActionKind; dueDate: string }[]>([{ text: '', kind: 'CURSO', dueDate: '' }]);
  const save = useMutation({
    mutationFn: () =>
      api.post('/pdi', {
        userId,
        title: title.trim(),
        focus: focus.trim() || null,
        dueDate: dateToIso(due),
        actions: actions.filter((a) => a.text.trim().length >= 2).map((a) => ({ text: a.text.trim(), kind: a.kind, dueDate: dateToIso(a.dueDate) })),
      }),
    onSuccess: () => {
      toast.success(name ? `Plano criado. Avisamos ${name.split(' ')[0]}.` : 'Plano criado');
      qc.invalidateQueries({ queryKey: ['pdi'] });
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const setAction = (i: number, patch: Partial<(typeof actions)[number]>) => setActions((list) => list.map((a, j) => (j === i ? { ...a, ...patch } : a)));

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={name ? `Novo PDI para ${name.split(' ')[0]}` : 'Novo plano de desenvolvimento'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={save.isPending} disabled={title.trim().length < 3} onClick={() => save.mutate()}>
            Criar plano
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Objetivo" required>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Assumir a coordenação do turno até junho" autoFocus />
        </Field>
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_170px]">
          <Field label="Competência">
            <Input value={focus} onChange={(e) => setFocus(e.target.value)} placeholder="Ex.: Liderança" list="pdi-focus" />
            <datalist id="pdi-focus">
              {FOCUS_SUGGESTIONS.map((f) => (
                <option key={f} value={f} />
              ))}
            </datalist>
          </Field>
          <Field label="Prazo">
            <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
        </div>
        <div>
          <p className="mb-1 text-[13px] font-medium text-ink-700">Ações</p>
          <p className="mb-2 text-xs text-ink-500">O que fazer para chegar lá. Uma boa regra: pouco curso, bastante prática no dia a dia.</p>
          <ul className="space-y-2">
            {actions.map((a, i) => (
              <li key={i} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 sm:grid-cols-[minmax(0,1fr)_150px_140px_auto]">
                <Input value={a.text} onChange={(e) => setAction(i, { text: e.target.value })} placeholder="Ex.: Conduzir a reunião semanal do time" className="col-span-2 sm:col-span-1" />
                <Select value={a.kind} onChange={(e) => setAction(i, { kind: e.target.value as DevActionKind })} aria-label="Tipo">
                  {DEV_ACTION_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {DEV_ACTION_LABEL[k]}
                    </option>
                  ))}
                </Select>
                <Input type="date" value={a.dueDate} onChange={(e) => setAction(i, { dueDate: e.target.value })} aria-label="Prazo da ação" />
                <button onClick={() => setActions((l) => l.filter((_, j) => j !== i))} className="rounded-lg p-2 text-ink-400 hover:bg-ink-50 hover:text-bad" aria-label="Remover ação">
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
          <Button size="sm" variant="ghost" className="mt-2" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setActions((l) => [...l, { text: '', kind: 'PRATICA', dueDate: '' }])}>
            Adicionar ação
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function PlanCard({ plan }: { plan: DevelopmentPlan }) {
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [kind, setKind] = useState<DevActionKind>('PRATICA');
  const [due, setDue] = useState('');
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['pdi'] });
  };
  const onErr = (e: unknown) => toast.error(errorMessage(e));
  const toggle = useMutation({ mutationFn: (a: { id: string; done: boolean }) => api.patch(`/pdi/actions/${a.id}`, { done: !a.done }), onSuccess: refresh, onError: onErr });
  const delAction = useMutation({ mutationFn: (id: string) => api.del(`/pdi/actions/${id}`), onSuccess: refresh, onError: onErr });
  const add = useMutation({
    mutationFn: () => api.post(`/pdi/${plan.id}/actions`, { text: text.trim(), kind, dueDate: dateToIso(due) }),
    onSuccess: () => {
      setText('');
      setDue('');
      refresh();
    },
    onError: onErr,
  });
  const patch = useMutation({ mutationFn: (body: object) => api.patch(`/pdi/${plan.id}`, body), onSuccess: refresh, onError: onErr });
  const remove = useMutation({ mutationFn: () => api.del(`/pdi/${plan.id}`), onSuccess: refresh, onError: onErr });

  const done = plan.actions.filter((a) => a.done).length;
  const total = plan.actions.length;
  const active = plan.status === 'ACTIVE';
  const allDone = total > 0 && done === total;

  return (
    <section className="card overflow-hidden">
      <header className="flex items-start gap-3 px-5 pb-3 pt-4">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            {plan.focus && <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">{plan.focus}</span>}
            {plan.dueDate && <span className="text-xs text-ink-500">até {fmtDateShort(plan.dueDate)}</span>}
            {plan.status !== 'ACTIVE' && <span className="rounded-full bg-ink-100 px-2 py-0.5 text-xs font-medium text-ink-600">{plan.status === 'DONE' ? 'Concluído' : 'Cancelado'}</span>}
          </div>
          <h3 className="text-base font-semibold text-ink-900">{plan.title}</h3>
          <div className="mt-2.5 flex items-center gap-3">
            <ProgressBar value={total ? done / total : 0} color={allDone ? '#1F9254' : '#2D3FE0'} className="max-w-[240px]" />
            <span className="num shrink-0 text-xs text-ink-500">
              {done} de {total} ações
            </span>
          </div>
        </div>
        <Menu
          trigger={() => (
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-ink-400 hover:bg-ink-50 hover:text-ink-700" aria-label="Mais opções">
              <MoreHorizontal className="h-4 w-4" />
            </span>
          )}
          items={[
            ...(active ? [{ label: 'Marcar como concluído', icon: <Check />, onClick: () => patch.mutate({ status: 'DONE' }) }] : [{ label: 'Reabrir plano', icon: <Sprout />, onClick: () => patch.mutate({ status: 'ACTIVE' }) }]),
            { label: 'Excluir plano', icon: <Trash2 />, danger: true, onClick: () => remove.mutate() },
          ]}
        />
      </header>
      {allDone && active && (
        <div className="mx-5 mb-3 flex flex-wrap items-center gap-2 rounded-xl bg-ok-soft px-3 py-2 text-sm text-ok">
          <span className="flex-1">Todas as ações concluídas. Combine com o gestor se o objetivo foi atingido.</span>
          <Button size="sm" variant="secondary" onClick={() => patch.mutate({ status: 'DONE' })}>
            Concluir plano
          </Button>
        </div>
      )}
      <ul className="divide-y divide-ink-100 border-t border-ink-100">
        {plan.actions.map((a) => {
          const late = !a.done && a.dueDate && new Date(a.dueDate) < new Date();
          return (
            <li key={a.id} className="group flex items-center gap-3 px-5 py-2.5">
              <button
                onClick={() => toggle.mutate(a)}
                className={clsx('flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-md border transition', a.done ? 'border-ok bg-ok text-white' : 'border-ink-300 hover:border-brand-500')}
                aria-label={a.done ? 'Desmarcar' : 'Concluir ação'}
              >
                {a.done && <Check className="h-3 w-3" strokeWidth={3} />}
              </button>
              <span className={clsx('min-w-0 flex-1 text-sm', a.done ? 'text-ink-400 line-through' : 'text-ink-800')}>{a.text}</span>
              <span className={clsx('hidden shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium sm:inline', KIND_TONE[a.kind])}>{DEV_ACTION_LABEL[a.kind]}</span>
              <span className={clsx('w-16 shrink-0 text-right text-xs', late ? 'font-medium text-bad' : 'text-ink-500')}>{a.dueDate ? fmtDateShort(a.dueDate) : ''}</span>
              <button onClick={() => delAction.mutate(a.id)} className="rounded p-1 text-ink-300 opacity-0 transition hover:text-bad group-hover:opacity-100 focus:opacity-100" aria-label="Remover ação">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          );
        })}
      </ul>
      {active && (
        <form
          className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 border-t border-ink-100 bg-ink-50/40 px-5 py-3 sm:grid-cols-[minmax(0,1fr)_150px_140px]"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim().length >= 2) add.mutate();
          }}
        >
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Nova ação e Enter" className="col-span-2 sm:col-span-1" />
          <Select value={kind} onChange={(e) => setKind(e.target.value as DevActionKind)} aria-label="Tipo">
            {DEV_ACTION_KINDS.map((k) => (
              <option key={k} value={k}>
                {DEV_ACTION_LABEL[k]}
              </option>
            ))}
          </Select>
          <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Prazo" />
        </form>
      )}
    </section>
  );
}

function PersonPlans({ userId, self }: { userId?: string; self: boolean }) {
  const [creating, setCreating] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  const { data, isLoading, error } = useQuery({
    queryKey: ['pdi', userId ?? 'me'],
    queryFn: () => api.get<{ user: UserLite; plans: DevelopmentPlan[] }>(`/pdi${userId ? `?userId=${userId}` : ''}`),
  });
  if (isLoading) return <PageLoader />;
  if (error || !data) return <EmptyState title="Não foi possível abrir este PDI" text={errorMessage(error)} />;
  const active = data.plans.filter((p) => p.status === 'ACTIVE');
  const closed = data.plans.filter((p) => p.status !== 'ACTIVE');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        {!self && (
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <Avatar user={data.user} size={40} />
            <div className="min-w-0">
              <p className="truncate font-semibold text-ink-900">{data.user.name}</p>
              <p className="truncate text-xs text-ink-500">{data.user.jobTitle}</p>
            </div>
          </div>
        )}
        {self && <p className="flex-1 text-sm text-ink-500">{active.length ? `${active.length} plano${active.length > 1 ? 's' : ''} em andamento` : ''}</p>}
        <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
          Novo plano
        </Button>
      </div>

      {active.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<Sprout />}
            title={self ? 'Você ainda não tem um PDI' : `${data.user.name.split(' ')[0]} ainda não tem um PDI`}
            text="Um objetivo claro e poucas ações com prazo. Combine com o gestor no próximo 1:1 e acompanhe por aqui."
            action={
              <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
                Criar plano
              </Button>
            }
          />
        </div>
      ) : (
        active.map((p) => <PlanCard key={p.id} plan={p} />)
      )}

      {closed.length > 0 && (
        <div>
          <button onClick={() => setShowClosed((v) => !v)} className="flex items-center gap-1 text-sm font-medium text-ink-500 hover:text-ink-900" aria-expanded={showClosed}>
            <ChevronDown className={clsx('h-4 w-4 transition', showClosed && 'rotate-180')} /> Planos encerrados ({closed.length})
          </button>
          {showClosed && <div className="mt-3 space-y-4">{closed.map((p) => <PlanCard key={p.id} plan={p} />)}</div>}
        </div>
      )}
      {creating && <NewPlanModal userId={userId ?? data.user.id} name={self ? null : data.user.name} onClose={() => setCreating(false)} />}
    </div>
  );
}

function TeamView({ onOpen }: { onOpen: (id: string) => void }) {
  const { data, isLoading } = useQuery({ queryKey: ['pdi', 'team'], queryFn: () => api.get<TeamRow[]>('/pdi/team') });
  const [onlyMissing, setOnlyMissing] = useState(false);
  if (isLoading || !data) return <PageLoader />;
  const withPlan = data.filter((r) => r.activePlans > 0).length;
  const rows = onlyMissing ? data.filter((r) => !r.activePlans) : data;
  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-ink-100 px-5 py-3">
        <p className="flex-1 text-sm text-ink-600">
          <span className="num font-semibold text-ink-900">{withPlan}</span> de <span className="num">{data.length}</span> pessoas com PDI ativo
        </p>
        <Tabs
          size="sm"
          value={onlyMissing ? 'sem' : 'todos'}
          onChange={(v) => setOnlyMissing(v === 'sem')}
          items={[
            { value: 'todos', label: 'Todos', count: data.length },
            { value: 'sem', label: 'Sem PDI', count: data.length - withPlan },
          ]}
        />
      </div>
      {rows.length === 0 ? (
        <EmptyState compact title="Todo mundo tem PDI ativo" />
      ) : (
        <ul className="divide-y divide-ink-100">
          {rows.map((r) => (
            <li key={r.user.id}>
              <button onClick={() => onOpen(r.user.id)} className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-5 py-3 text-left hover:bg-ink-50/60 sm:grid-cols-[minmax(0,1fr)_200px_90px]">
                <span className="flex min-w-0 items-center gap-3">
                  <Avatar user={r.user} size={32} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-ink-900">{r.user.name}</span>
                    <span className="block truncate text-xs text-ink-500">{[r.user.jobTitle, r.user.department?.name].filter(Boolean).join(' · ')}</span>
                  </span>
                </span>
                <span className="hidden items-center gap-2 sm:flex">
                  {r.activePlans ? (
                    <>
                      <ProgressBar value={r.actions ? r.done / r.actions : 0} />
                      <span className="num w-12 shrink-0 text-right text-xs text-ink-500">
                        {r.done}/{r.actions}
                      </span>
                    </>
                  ) : (
                    <span className="text-xs text-ink-400">Sem PDI</span>
                  )}
                </span>
                <span className={clsx('justify-self-end text-xs font-medium', r.activePlans ? 'text-ink-500' : 'text-brand-600')}>{r.activePlans ? `${r.activePlans} plano${r.activePlans > 1 ? 's' : ''}` : 'Criar'}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function Development() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const person = params.get('pessoa');
  const leads = user?.role !== 'EMPLOYEE';
  const tab = person || params.get('aba') === 'time' ? 'time' : 'meu';
  if (!user) return <PageLoader />;

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="PDI"
        subtitle="Plano de desenvolvimento individual: um objetivo, ações práticas e prazo"
        actions={
          leads ? (
            <Tabs
              value={tab}
              onChange={(v) => setParams(v === 'time' ? { aba: 'time' } : {}, { replace: true })}
              items={[
                { value: 'meu', label: 'Meu PDI' },
                { value: 'time', label: 'Do time' },
              ]}
            />
          ) : undefined
        }
      />
      {person ? (
        <div className="space-y-4">
          {leads && (
            <Link to="?aba=time" className="inline-flex items-center gap-1 text-[13px] text-ink-500 hover:text-ink-900">
              <ArrowLeft className="h-4 w-4" /> PDI do time
            </Link>
          )}
          <PersonPlans key={person} userId={person} self={person === user.id} />
        </div>
      ) : tab === 'time' && leads ? (
        <TeamView onOpen={(id) => setParams({ pessoa: id })} />
      ) : (
        <PersonPlans self />
      )}
    </div>
  );
}
