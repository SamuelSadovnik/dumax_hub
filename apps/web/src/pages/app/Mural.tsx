import { useState } from 'react';
import clsx from 'clsx';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Award, BookOpenCheck, Check, Pin, PinOff, Plus, Trash2 } from 'lucide-react';
import { KUDOS_VALUES } from '@dumax/shared';
import { api, errorMessage } from '@/lib/api';
import { useAuth, useMe } from '@/lib/auth';
import { useUsers } from '@/lib/hooks';
import type { Announcement, Kudos, UserLite } from '@/lib/types';
import { fromNow } from '@/lib/format';
import { Avatar, Badge, Button, Checkbox, EmptyState, Field, Input, Modal, PageHeader, Panel, Select, Textarea, UserPicker } from '@/components/ui';
import { confirmDialog } from '@/components/ConfirmDialog';

export default function Mural() {
  const me = useMe();
  const { isAdminPortal } = useAuth();
  const qc = useQueryClient();
  const { data: users = [] } = useUsers();
  const announcements = useQuery({ queryKey: ['announcements'], queryFn: () => api.get<Announcement[]>('/feed/announcements') });
  const kudos = useQuery({ queryKey: ['kudos'], queryFn: () => api.get<Kudos[]>('/feed/kudos') });
  const ranking = useQuery({ queryKey: ['kudos-ranking'], queryFn: () => api.get<{ user: UserLite; count: number }[]>('/feed/kudos/ranking') });

  const [annOpen, setAnnOpen] = useState(false);
  const [allKudos, setAllKudos] = useState(false);
  const [ann, setAnn] = useState({ title: '', body: '', pinned: false, requiresAck: false });
  const [readsOf, setReadsOf] = useState<Announcement | null>(null);
  const [kOpen, setKOpen] = useState(false);
  const [k, setK] = useState({ toId: null as string | null, value: KUDOS_VALUES[0] as string, message: '' });

  const postAnn = useMutation({
    mutationFn: () => api.post('/feed/announcements', ann),
    onSuccess: () => {
      toast.success('Comunicado publicado e todos notificados');
      setAnnOpen(false);
      setAnn({ title: '', body: '', pinned: false, requiresAck: false });
      qc.invalidateQueries({ queryKey: ['announcements'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const postKudos = useMutation({
    mutationFn: () => api.post('/feed/kudos', k),
    onSuccess: () => {
      toast.success('Elogio enviado');
      setKOpen(false);
      setK({ toId: null, value: KUDOS_VALUES[0], message: '' });
      qc.invalidateQueries({ queryKey: ['kudos'] });
      qc.invalidateQueries({ queryKey: ['kudos-ranking'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const ack = useMutation({
    mutationFn: (a: Announcement) => api.post(`/feed/announcements/${a.id}/ack`),
    onSuccess: () => {
      toast.success('Leitura confirmada');
      qc.invalidateQueries({ queryKey: ['announcements'] });
      qc.invalidateQueries({ queryKey: ['inbox'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const reads = useQuery({
    queryKey: ['announcement-reads', readsOf?.id],
    enabled: Boolean(readsOf),
    queryFn: () => api.get<{ read: { user: UserLite; readAt: string }[]; pending: UserLite[] }>(`/feed/announcements/${readsOf!.id}/reads`),
  });

  const togglePin = async (a: Announcement) => {
    await api.patch(`/feed/announcements/${a.id}`, { pinned: !a.pinned });
    qc.invalidateQueries({ queryKey: ['announcements'] });
  };
  const removeAnn = async (a: Announcement) => {
    if (!(await confirmDialog({ title: `Excluir “${a.title}”?`, description: 'O comunicado sai do mural de todo mundo.', confirmLabel: 'Excluir', tone: 'danger' }))) return;
    await api.del(`/feed/announcements/${a.id}`);
    qc.invalidateQueries({ queryKey: ['announcements'] });
  };

  const mustRead = (a: Announcement) => a.requiresAck && !a.readByMe;
  const anns = [...(announcements.data ?? [])].sort((x, y) => Number(mustRead(y)) - Number(mustRead(x)) || Number(y.pinned) - Number(x.pinned));
  return (
    <div className="space-y-5">
      <PageHeader
        title="Mural"
        subtitle="Comunicados da empresa e reconhecimento entre colegas"
        actions={
          <>
            <Button variant="secondary" icon={<Award className="h-4 w-4" />} onClick={() => setKOpen(true)}>
              Elogiar alguém
            </Button>
            {isAdminPortal && (
              <Button icon={<Plus className="h-4 w-4" />} onClick={() => setAnnOpen(true)}>
                Novo comunicado
              </Button>
            )}
          </>
        }
      />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Panel title="Comunicados" subtitle={`${anns.length} publicados`}>
          {anns.length ? (
            <ul className="divide-y divide-ink-100">
              {anns.map((a) => (
                <li key={a.id} className={clsx('group px-5 py-4', mustRead(a) && 'bg-warn-soft/40 shadow-[inset_3px_0_0] shadow-warn')}>
                  <div className="flex items-start gap-3">
                    <Avatar user={a.author} size={32} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold">{a.title}</h3>
                        {a.requiresAck && (
                          <Badge tone="warn">
                            <BookOpenCheck className="h-3 w-3" /> Leitura obrigatória
                          </Badge>
                        )}
                        {a.pinned && (
                          <Badge tone="brand">
                            <Pin className="h-3 w-3" /> Fixado
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-ink-500">
                        {a.author.name} · {fromNow(a.createdAt)}
                      </p>
                      <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink-700">{a.body}</p>
                      {(a.requiresAck || (isAdminPortal && a.readCount > 0)) && (
                        <div className="mt-3 flex flex-wrap items-center gap-3">
                          {mustRead(a) ? (
                            <Button size="sm" icon={<Check className="h-3.5 w-3.5" />} loading={ack.isPending && ack.variables?.id === a.id} onClick={() => ack.mutate(a)}>
                              Li e entendi
                            </Button>
                          ) : a.requiresAck ? (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-ok">
                              <Check className="h-3.5 w-3.5" /> Você confirmou a leitura
                            </span>
                          ) : null}
                          {isAdminPortal && a.requiresAck && (
                            <button onClick={() => setReadsOf(a)} className="text-xs text-ink-500 underline-offset-2 hover:text-ink-900 hover:underline">
                              <span className="num font-medium text-ink-700">{a.readCount}</span> de <span className="num">{a.audience}</span> confirmaram
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                    {isAdminPortal && (
                      <div className="flex opacity-0 transition-opacity group-hover:opacity-100">
                        <Button size="icon-sm" variant="ghost" aria-label={a.pinned ? 'Desafixar' : 'Fixar'} onClick={() => togglePin(a)}>
                          {a.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
                        </Button>
                        <Button size="icon-sm" variant="ghost" aria-label="Excluir" onClick={() => removeAnn(a)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState compact title="Nenhum comunicado ainda" />
          )}
        </Panel>

        <div className="space-y-5">
          <Panel title="Mais elogiados" subtitle="Últimos 30 dias">
            <ol className="divide-y divide-ink-100">
              {(ranking.data ?? []).map((r, i) => (
                <li key={r.user.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="num w-4 text-xs text-ink-400">{i + 1}</span>
                  <Avatar user={r.user} size={26} />
                  <span className="flex-1 truncate text-sm">{r.user.name}</span>
                  <span className="num text-sm font-medium">{r.count}</span>
                </li>
              ))}
              {!ranking.data?.length && <li className="px-4 py-3 text-sm text-ink-500">Ninguém elogiado ainda.</li>}
            </ol>
          </Panel>
          <Panel title="Elogios recentes">
            <ul className="divide-y divide-ink-100">
              {(kudos.data ?? []).slice(0, allKudos ? undefined : 8).map((kd) => (
                <li key={kd.id} className="flex gap-3 px-4 py-3">
                  <Avatar user={kd.to} size={28} />
                  <div className="min-w-0 text-[13px]">
                    <p>
                      <span className="font-medium">{kd.from.id === me.id ? 'Você' : kd.from.name.split(' ')[0]}</span> elogiou{' '}
                      <span className="font-medium">{kd.to.id === me.id ? 'você' : kd.to.name.split(' ')[0]}</span>
                      <span className="text-ink-500"> · {kd.value}</span>
                    </p>
                    <p className="mt-0.5 text-ink-700">{kd.message}</p>
                    <p className="mt-0.5 text-2xs text-ink-400">{fromNow(kd.createdAt)}</p>
                  </div>
                </li>
              ))}
            </ul>
            {(kudos.data?.length ?? 0) > 8 && (
              <button onClick={() => setAllKudos((v) => !v)} className="w-full border-t border-ink-100 px-4 py-2.5 text-left text-[13px] font-medium text-brand-600 hover:bg-ink-50">
                {allKudos ? 'Mostrar menos' : `Ver todos os ${kudos.data!.length} elogios`}
              </button>
            )}
          </Panel>
        </div>
      </div>

      <Modal open={annOpen} onClose={() => setAnnOpen(false)} title="Novo comunicado" footer={<Button loading={postAnn.isPending} disabled={ann.title.length < 3 || ann.body.length < 3} onClick={() => postAnn.mutate()}>Publicar</Button>}>
        <div className="space-y-4">
          <Field label="Título">
            <Input value={ann.title} onChange={(e) => setAnn({ ...ann, title: e.target.value })} />
          </Field>
          <Field label="Mensagem">
            <Textarea rows={6} value={ann.body} onChange={(e) => setAnn({ ...ann, body: e.target.value })} />
          </Field>
          <Checkbox checked={ann.pinned} onChange={(v) => setAnn({ ...ann, pinned: v })} label="Fixar no topo" />
          <Checkbox
            checked={ann.requiresAck}
            onChange={(v) => setAnn({ ...ann, requiresAck: v })}
            label={
              <span>
                Leitura obrigatória
                <span className="block text-xs text-ink-500">Cada pessoa precisa clicar em “Li e entendi”. Fica na Dashboard de quem ainda não leu e você vê quem falta.</span>
              </span>
            }
          />
        </div>
      </Modal>

      <Modal open={Boolean(readsOf)} onClose={() => setReadsOf(null)} title={readsOf ? `Quem leu: ${readsOf.title}` : ''}>
        {!reads.data ? (
          <p className="text-sm text-ink-500">Carregando…</p>
        ) : (
          <div className="space-y-5">
            <div>
              <p className="mb-2 text-sm font-semibold text-ink-900">
                Faltam confirmar <span className="num text-ink-500">{reads.data.pending.length}</span>
              </p>
              {reads.data.pending.length === 0 ? (
                <p className="text-sm text-ok">Todo mundo já confirmou.</p>
              ) : (
                <ul className="flex flex-wrap gap-1.5">
                  {reads.data.pending.map((u) => (
                    <li key={u.id} className="inline-flex items-center gap-1.5 rounded-full bg-ink-100 py-0.5 pl-0.5 pr-2.5 text-xs text-ink-700">
                      <Avatar user={u} size={20} /> {u.name}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="mb-2 text-sm font-semibold text-ink-900">
                Confirmaram <span className="num text-ink-500">{reads.data.read.length}</span>
              </p>
              <ul className="max-h-60 divide-y divide-ink-100 overflow-y-auto">
                {reads.data.read.map((r) => (
                  <li key={r.user.id} className="flex items-center gap-2.5 py-1.5 text-sm">
                    <Avatar user={r.user} size={24} />
                    <span className="min-w-0 flex-1 truncate">{r.user.name}</span>
                    <span className="text-xs text-ink-500">{fromNow(r.readAt)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={kOpen} onClose={() => setKOpen(false)} title="Elogiar alguém" footer={<Button loading={postKudos.isPending} disabled={!k.toId || k.message.length < 3} onClick={() => postKudos.mutate()}>Enviar elogio</Button>}>
        <div className="space-y-4">
          <Field label="Quem?">
            <UserPicker users={users.filter((u) => u.id !== me.id)} value={k.toId} onChange={(v) => setK({ ...k, toId: v as string })} />
          </Field>
          <Field label="Valor">
            <Select value={k.value} onChange={(e) => setK({ ...k, value: e.target.value })}>
              {KUDOS_VALUES.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </Select>
          </Field>
          <Field label="Mensagem">
            <Textarea value={k.message} onChange={(e) => setK({ ...k, message: e.target.value })} placeholder="O que essa pessoa fez?" />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
