import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { toast } from 'sonner';
import { ArrowLeft, CalendarPlus, Check, ChevronDown, CircleCheck, Handshake, ListChecks, MessageSquareText, Trash2 } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { OneOnOne, OneOnOneHome, OneOnOneItem, OneOnOnePair, OneOnOnePairSummary } from '@/lib/types';
import { fmtDateShort, fmtTime, fromNow, isoToLocalInput, localInputToIso } from '@/lib/format';
import { Avatar, Button, EmptyState, Input, Modal, PageHeader, PageLoader, Select, Textarea } from '@/components/ui';

const weekday = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
const when = (iso: string) => `${weekday(iso)}, ${fmtDateShort(iso)} · ${fmtTime(iso)}`;
const daysSince = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);

/** Próxima segunda-feira às 10h, sugestão padrão */
function suggestedSlot() {
  const d = new Date();
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
  d.setHours(10, 0, 0, 0);
  return isoToLocalInput(d.toISOString());
}

function PairRow({ p, active, onClick, role }: { p: OneOnOnePairSummary; active: boolean; onClick: () => void; role: string }) {
  const stale = !p.next && (!p.last || daysSince(p.last.scheduledAt) > 30);
  return (
    <button
      onClick={onClick}
      className={clsx('flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition', active ? 'bg-brand-50 ring-1 ring-brand-200' : 'hover:bg-ink-50')}
      aria-current={active ? 'true' : undefined}
    >
      <Avatar user={p.user} size={36} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-ink-900">{p.user.name}</span>
        <span className={clsx('block truncate text-xs', p.next ? 'text-ink-500' : stale ? 'text-warn' : 'text-ink-400')}>
          {p.next ? `Próximo: ${when(p.next.scheduledAt)}` : p.last ? `Último ${fromNow(p.last.scheduledAt)}` : `Nenhum 1:1 com ${role}`}
        </span>
      </span>
      {p.openActions > 0 && (
        <span className="num shrink-0 rounded-full bg-ink-100 px-1.5 text-xs font-medium text-ink-600" title="Ações em aberto">
          {p.openActions}
        </span>
      )}
    </button>
  );
}

function ItemRow({ item, meId, onToggle, onDelete }: { item: OneOnOneItem; meId: string; onToggle: () => void; onDelete: () => void }) {
  const overdue = item.kind === 'ACTION' && !item.done && item.dueAt && new Date(item.dueAt) < new Date();
  return (
    <li className="group flex items-start gap-2.5 py-2">
      <button
        onClick={onToggle}
        className={clsx('mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-md border transition', item.done ? 'border-ok bg-ok text-white' : 'border-ink-300 hover:border-brand-500')}
        aria-label={item.done ? 'Desmarcar' : 'Marcar como feito'}
      >
        {item.done && <Check className="h-3 w-3" strokeWidth={3} />}
      </button>
      <span className="min-w-0 flex-1">
        <span className={clsx('block text-sm', item.done ? 'text-ink-400 line-through' : 'text-ink-800')}>{item.text}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-ink-400">
          {item.kind === 'ACTION' && item.owner && <span>Com {item.owner.id === meId ? 'você' : item.owner.name.split(' ')[0]}</span>}
          {item.kind === 'ACTION' && item.dueAt && <span className={clsx(overdue && 'font-medium text-bad')}>até {fmtDateShort(item.dueAt)}</span>}
          {item.kind === 'TOPIC' && <span>{item.author.id === meId ? 'Você' : item.author.name.split(' ')[0]} adicionou</span>}
        </span>
      </span>
      {item.author.id === meId && (
        <button onClick={onDelete} className="rounded p-1 text-ink-300 opacity-0 transition hover:text-bad group-hover:opacity-100 focus:opacity-100" aria-label="Remover">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </li>
  );
}

function Meeting({ m, pair, meId, isManager, current, refresh }: { m: OneOnOne; pair: OneOnOnePair; meId: string; isManager: boolean; current: boolean; refresh: () => void }) {
  const [topic, setTopic] = useState('');
  const [action, setAction] = useState({ text: '', ownerId: pair.report.id, dueAt: '' });
  const [notes, setNotes] = useState(m.notes ?? '');
  const savedNotes = useRef(m.notes ?? '');
  useEffect(() => {
    setNotes(m.notes ?? '');
    savedNotes.current = m.notes ?? '';
  }, [m.id, m.notes]);

  const onErr = (e: unknown) => toast.error(errorMessage(e));
  const addItem = useMutation({ mutationFn: (body: object) => api.post(`/one-on-ones/${m.id}/items`, body), onSuccess: refresh, onError: onErr });
  const toggle = useMutation({ mutationFn: (i: OneOnOneItem) => api.patch(`/one-on-ones/items/${i.id}`, { done: !i.done }), onSuccess: refresh, onError: onErr });
  const del = useMutation({ mutationFn: (i: OneOnOneItem) => api.del(`/one-on-ones/items/${i.id}`), onSuccess: refresh, onError: onErr });
  const patch = useMutation({ mutationFn: (body: object) => api.patch(`/one-on-ones/${m.id}`, body), onSuccess: refresh, onError: onErr });

  const topics = m.items.filter((i) => i.kind === 'TOPIC');
  const actions = m.items.filter((i) => i.kind === 'ACTION');
  const saveNotes = () => {
    if (notes === savedNotes.current) return;
    savedNotes.current = notes;
    patch.mutate({ notes }, { onSuccess: () => toast.success('Anotações salvas') });
  };

  return (
    <div className="grid gap-5 p-5 lg:grid-cols-2">
      <section>
        <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-ink-900">
          <MessageSquareText className="h-4 w-4 text-ink-400" /> Pauta
        </h3>
        <p className="mb-2 text-xs text-ink-500">Os dois adicionam assuntos antes da conversa.</p>
        {topics.length > 0 ? (
          <ul className="divide-y divide-ink-100">
            {topics.map((i) => (
              <ItemRow key={i.id} item={i} meId={meId} onToggle={() => toggle.mutate(i)} onDelete={() => del.mutate(i)} />
            ))}
          </ul>
        ) : (
          <p className="py-2 text-sm text-ink-400">Nenhum assunto ainda.</p>
        )}
        {current && (
          <form
            className="mt-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (topic.trim().length < 2) return;
              addItem.mutate({ kind: 'TOPIC', text: topic.trim() }, { onSuccess: () => setTopic('') });
            }}
          >
            <Input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Adicionar assunto e Enter" />
          </form>
        )}
      </section>

      <section>
        <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-ink-900">
          <ListChecks className="h-4 w-4 text-ink-400" /> Combinados
        </h3>
        <p className="mb-2 text-xs text-ink-500">O que cada um vai fazer até a próxima conversa.</p>
        {actions.length > 0 ? (
          <ul className="divide-y divide-ink-100">
            {actions.map((i) => (
              <ItemRow key={i.id} item={i} meId={meId} onToggle={() => toggle.mutate(i)} onDelete={() => del.mutate(i)} />
            ))}
          </ul>
        ) : (
          <p className="py-2 text-sm text-ink-400">Nenhum combinado ainda.</p>
        )}
        {current && (
          <form
            className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-2 sm:grid-cols-[minmax(0,1fr)_130px_140px]"
            onSubmit={(e) => {
              e.preventDefault();
              if (action.text.trim().length < 2) return;
              addItem.mutate(
                { kind: 'ACTION', text: action.text.trim(), ownerId: action.ownerId, dueAt: action.dueAt ? new Date(`${action.dueAt}T12:00:00`).toISOString() : null },
                { onSuccess: () => setAction((a) => ({ ...a, text: '', dueAt: '' })) },
              );
            }}
          >
            <Input value={action.text} onChange={(e) => setAction((a) => ({ ...a, text: e.target.value }))} placeholder="Novo combinado e Enter" className="col-span-2 sm:col-span-1" />
            <Select value={action.ownerId} onChange={(e) => setAction((a) => ({ ...a, ownerId: e.target.value }))} aria-label="Responsável">
              {[pair.report, pair.manager].map((u) => (
                <option key={u.id} value={u.id}>
                  {u.id === meId ? 'Eu' : u.name.split(' ')[0]}
                </option>
              ))}
            </Select>
            <Input type="date" value={action.dueAt} onChange={(e) => setAction((a) => ({ ...a, dueAt: e.target.value }))} aria-label="Prazo" />
          </form>
        )}
      </section>

      <section className="lg:col-span-2">
        <h3 className="mb-2 text-sm font-semibold text-ink-900">Anotações</h3>
        {current ? (
          <Textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={saveNotes} placeholder="O que foi conversado. Salva sozinho quando você sai do campo. Os dois veem." />
        ) : m.notes ? (
          <p className="whitespace-pre-wrap text-sm text-ink-700">{m.notes}</p>
        ) : (
          <p className="text-sm text-ink-400">Sem anotações.</p>
        )}
      </section>

      {current && isManager && (
        <div className="flex flex-wrap justify-end gap-2 border-t border-ink-100 pt-4 lg:col-span-2">
          <Button
            variant="ghost"
            className="text-ink-500"
            onClick={() => patch.mutate({ status: 'DONE', notes }, { onSuccess: () => toast.success('1:1 encerrado. Os combinados em aberto seguem para o próximo.') })}
            icon={<CircleCheck className="h-4 w-4" />}
          >
            Encerrar 1:1
          </Button>
        </div>
      )}
    </div>
  );
}

function PairView({ otherId, meId, onBack }: { otherId: string; meId: string; onBack: () => void }) {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ['one-on-one', otherId], queryFn: () => api.get<OneOnOnePair>(`/one-on-ones/with/${otherId}`) });
  const [scheduling, setScheduling] = useState(false);
  const [slot, setSlot] = useState(suggestedSlot);
  const [openPast, setOpenPast] = useState<string | null>(null);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['one-on-one', otherId] });
    qc.invalidateQueries({ queryKey: ['one-on-ones'] });
    qc.invalidateQueries({ queryKey: ['inbox'] });
  };
  const schedule = useMutation({
    mutationFn: () => api.post(`/one-on-ones/with/${otherId}`, { scheduledAt: localInputToIso(slot) }),
    onSuccess: () => {
      toast.success('1:1 marcado. Avisamos a outra pessoa.');
      setScheduling(false);
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (isLoading) return <PageLoader />;
  if (error || !data) return <EmptyState title="Não foi possível abrir este 1:1" text={errorMessage(error)} />;

  const isManager = data.manager.id === meId;
  const other = isManager ? data.report : data.manager;
  const open = data.meetings.filter((m) => m.status === 'OPEN').sort((a, b) => +new Date(a.scheduledAt) - +new Date(b.scheduledAt));
  const current = open[0];
  const past = data.meetings.filter((m) => m.id !== current?.id);
  const carried = data.openActions.filter((i) => i.oneOnOneId !== current?.id);

  return (
    <div className="space-y-5">
      <div className="card flex flex-wrap items-center gap-4 p-5">
        <button onClick={onBack} className="rounded-lg p-1.5 text-ink-500 hover:bg-ink-50 lg:hidden" aria-label="Voltar">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <Avatar user={other} size={48} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-display text-xl font-bold text-ink-900">{other.name}</h2>
          <p className="truncate text-sm text-ink-500">
            {other.jobTitle ?? ''} · {isManager ? 'faz parte do seu time' : 'seu gestor'}
          </p>
        </div>
        <Button variant={current ? 'secondary' : 'primary'} icon={<CalendarPlus className="h-4 w-4" />} onClick={() => setScheduling(true)}>
          Marcar 1:1
        </Button>
      </div>

      {current ? (
        <section className="card overflow-hidden">
          <header className="flex flex-wrap items-center gap-3 border-b border-ink-100 px-5 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium uppercase tracking-wide text-brand-600">{new Date(current.scheduledAt) < new Date() ? 'Em andamento' : 'Próximo 1:1'}</p>
              <h3 className="text-base font-semibold capitalize text-ink-900">{when(current.scheduledAt)}</h3>
            </div>
            <span className="text-xs text-ink-500">{fromNow(current.scheduledAt)}</span>
          </header>
          {carried.length > 0 && (
            <div className="border-b border-ink-100 bg-warn-soft/40 px-5 py-3">
              <p className="mb-1 text-xs font-semibold text-ink-700">Combinados de conversas anteriores ainda em aberto</p>
              <ul className="space-y-0.5 text-sm text-ink-700">
                {carried.map((i) => (
                  <li key={i.id} className="flex gap-2">
                    <span className="text-ink-400">•</span>
                    <span className="min-w-0 flex-1">{i.text}</span>
                    <span className="shrink-0 text-xs text-ink-500">{i.owner?.id === meId ? 'você' : i.owner?.name.split(' ')[0]}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <Meeting m={current} pair={data} meId={meId} isManager={isManager} current refresh={refresh} />
        </section>
      ) : (
        <div className="card">
          <EmptyState
            icon={<Handshake />}
            title="Nenhum 1:1 marcado"
            text={isManager ? 'Uma conversa curta a cada uma ou duas semanas evita surpresas. Marque o próximo e os dois montam a pauta.' : `Marque uma conversa com ${other.name.split(' ')[0]} e adicione os assuntos que quer tratar.`}
            action={
              <Button icon={<CalendarPlus className="h-4 w-4" />} onClick={() => setScheduling(true)}>
                Marcar 1:1
              </Button>
            }
          />
        </div>
      )}

      {past.length > 0 && (
        <section className="card overflow-hidden">
          <h3 className="border-b border-ink-100 px-5 py-3 text-base font-semibold text-ink-900">Conversas anteriores</h3>
          <ul className="divide-y divide-ink-100">
            {past.map((m) => {
              const isOpen = openPast === m.id;
              const t = m.items.filter((i) => i.kind === 'TOPIC').length;
              const a = m.items.filter((i) => i.kind === 'ACTION').length;
              return (
                <li key={m.id}>
                  <button className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-ink-50/60" onClick={() => setOpenPast(isOpen ? null : m.id)} aria-expanded={isOpen}>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium capitalize text-ink-900">{when(m.scheduledAt)}</span>
                      <span className="block text-xs text-ink-500">
                        {t} assunto{t === 1 ? '' : 's'} · {a} combinado{a === 1 ? '' : 's'}
                        {m.status === 'OPEN' && ' · não encerrado'}
                      </span>
                    </span>
                    <ChevronDown className={clsx('h-4 w-4 text-ink-400 transition', isOpen && 'rotate-180')} />
                  </button>
                  {isOpen && (
                    <div className="border-t border-ink-100 bg-ink-50/40">
                      <Meeting m={m} pair={data} meId={meId} isManager={isManager} current={false} refresh={refresh} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <Modal
        open={scheduling}
        onClose={() => setScheduling(false)}
        size="sm"
        title={`Marcar 1:1 com ${other.name.split(' ')[0]}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setScheduling(false)}>
              Cancelar
            </Button>
            <Button loading={schedule.isPending} disabled={!slot} onClick={() => schedule.mutate()}>
              Marcar
            </Button>
          </>
        }
      >
        <Input type="datetime-local" value={slot} onChange={(e) => setSlot(e.target.value)} aria-label="Data e hora" />
        <p className="mt-2 text-xs text-ink-500">{other.name.split(' ')[0]} recebe um aviso e pode adicionar assuntos à pauta.</p>
      </Modal>
    </div>
  );
}

export default function OneOnOnes() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const { data, isLoading } = useQuery({ queryKey: ['one-on-ones'], queryFn: () => api.get<OneOnOneHome>('/one-on-ones') });
  const all = useMemo(() => [...(data?.manager ? [data.manager] : []), ...(data?.reports ?? [])], [data]);
  const isDesktop = typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches;
  const selected = params.get('com') ?? (isDesktop ? all[0]?.user.id : undefined);
  const select = (id: string | null) => setParams(id ? { com: id } : {}, { replace: true });

  if (isLoading || !user) return <PageLoader />;

  if (!all.length)
    return (
      <div>
        <PageHeader title="1:1" subtitle="Conversas recorrentes entre a pessoa e o gestor direto" />
        <div className="card">
          <EmptyState icon={<Handshake />} title="Você ainda não tem com quem fazer 1:1" text="O 1:1 aparece quando você tem um gestor direto ou pessoas no seu time. Peça ao RH para ajustar no cadastro." action={<Link to="/organograma" className="text-sm text-brand-600 hover:underline">Ver organograma</Link>} />
        </div>
      </div>
    );

  return (
    <div>
      <PageHeader title="1:1" subtitle="Pauta compartilhada, combinados e histórico de cada conversa com o gestor" />
      <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className={clsx('card h-fit space-y-4 p-3', selected && 'hidden lg:block')}>
          {data?.manager && (
            <div>
              <p className="px-3 pb-1 pt-1 text-xs font-semibold uppercase tracking-wide text-ink-400">Meu gestor</p>
              <PairRow p={data.manager} role="seu gestor" active={selected === data.manager.user.id} onClick={() => select(data.manager!.user.id)} />
            </div>
          )}
          {(data?.reports.length ?? 0) > 0 && (
            <div>
              <p className="px-3 pb-1 pt-1 text-xs font-semibold uppercase tracking-wide text-ink-400">Meu time · {data!.reports.length}</p>
              <div className="space-y-0.5">
                {data!.reports.map((p) => (
                  <PairRow key={p.user.id} p={p} role="essa pessoa" active={selected === p.user.id} onClick={() => select(p.user.id)} />
                ))}
              </div>
            </div>
          )}
        </aside>
        <div className={clsx('min-w-0', !selected && 'hidden lg:block')}>
          {selected ? <PairView key={selected} otherId={selected} meId={user.id} onBack={() => select(null)} /> : null}
        </div>
      </div>
    </div>
  );
}
