import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Award, Pin, PinOff, Plus, Trash2 } from 'lucide-react';
import { KUDOS_VALUES } from '@dumax/shared';
import { api, errorMessage } from '@/lib/api';
import { useAuth, useMe } from '@/lib/auth';
import { useUsers } from '@/lib/hooks';
import type { Announcement, Kudos, UserLite } from '@/lib/types';
import { fromNow } from '@/lib/format';
import { Avatar, Badge, Button, Checkbox, EmptyState, Field, Input, Modal, PageHeader, Panel, Select, Textarea, UserPicker } from '@/components/ui';

export default function Mural() {
  const me = useMe();
  const { isAdminPortal } = useAuth();
  const qc = useQueryClient();
  const { data: users = [] } = useUsers();
  const announcements = useQuery({ queryKey: ['announcements'], queryFn: () => api.get<Announcement[]>('/feed/announcements') });
  const kudos = useQuery({ queryKey: ['kudos'], queryFn: () => api.get<Kudos[]>('/feed/kudos') });
  const ranking = useQuery({ queryKey: ['kudos-ranking'], queryFn: () => api.get<{ user: UserLite; count: number }[]>('/feed/kudos/ranking') });

  const [annOpen, setAnnOpen] = useState(false);
  const [ann, setAnn] = useState({ title: '', body: '', pinned: false });
  const [kOpen, setKOpen] = useState(false);
  const [k, setK] = useState({ toId: null as string | null, value: KUDOS_VALUES[0] as string, message: '' });

  const postAnn = useMutation({
    mutationFn: () => api.post('/feed/announcements', ann),
    onSuccess: () => {
      toast.success('Comunicado publicado e todos notificados');
      setAnnOpen(false);
      setAnn({ title: '', body: '', pinned: false });
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

  const togglePin = async (a: Announcement) => {
    await api.patch(`/feed/announcements/${a.id}`, { pinned: !a.pinned });
    qc.invalidateQueries({ queryKey: ['announcements'] });
  };
  const removeAnn = async (a: Announcement) => {
    if (!confirm('Excluir comunicado?')) return;
    await api.del(`/feed/announcements/${a.id}`);
    qc.invalidateQueries({ queryKey: ['announcements'] });
  };

  const anns = [...(announcements.data ?? [])].sort((x, y) => Number(y.pinned) - Number(x.pinned));
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
                <li key={a.id} className="group px-5 py-4">
                  <div className="flex items-start gap-3">
                    <Avatar user={a.author} size={32} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold">{a.title}</h3>
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
            <ul className="scroll-thin max-h-[560px] divide-y divide-ink-100 overflow-y-auto">
              {(kudos.data ?? []).map((kd) => (
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
        </div>
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
