import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { toast } from 'sonner';
import {
  Archive, ArchiveRestore, ArrowDown, ArrowLeft, BellOff, BellRing, Check, CheckCheck, ChevronDown, Copy, CornerUpLeft, FileText,
  Info, Loader2, LogOut, MailOpen, MessageCirclePlus, MoreVertical, Paperclip, Pencil, Pin, PinOff, Plus, Search, Send, Smile,
  SmilePlus, SquareCheck, Trash2, UserPlus, Users, Volume2, X,
} from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { useUsers } from '@/lib/hooks';
import { getSocket, useSocketEvent } from '@/lib/socket';
import { askNotificationPermission } from '@/lib/notifier';
import type { ChatMessage, ConversationSummary, DirectoryUser } from '@/lib/types';
import { chatStamp, dayDivider, fmtBytes, fmtTime, fromNow } from '@/lib/format';
import { Avatar, Button, Checkbox, Input, Menu, Spinner, UserPicker } from '@/components/ui';

const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
const EMOJI_GRID = [
  '😀', '😁', '😂', '🤣', '😊', '😍', '😘', '😎', '🤩', '🥳', '😅', '😉', '🙂', '🤔', '😐', '😴', '😮', '😢', '😭', '😡',
  '👍', '👎', '👏', '🙌', '🙏', '💪', '🤝', '👀', '👋', '✌️', '❤️', '🔥', '🎉', '✅', '❌', '⚠️', '🚀', '💡', '📌', '☕',
];

type Filter = 'all' | 'unread' | 'groups';
type BulkAction = 'archive' | 'unarchive' | 'read' | 'unread' | 'mute' | 'unmute' | 'pin' | 'unpin';

function useOnline() {
  const [online, setOnline] = useState<Set<string>>(new Set());
  useEffect(() => {
    api.get<{ online: string[] }>('/users/presence').then((r) => setOnline(new Set(r.online)));
  }, []);
  useSocketEvent<{ userId: string; online: boolean }>('presence', (p) =>
    setOnline((s) => {
      const n = new Set(s);
      if (p.online) n.add(p.userId);
      else n.delete(p.userId);
      return n;
    }),
  );
  return online;
}

function isUnread(c: ConversationSummary) {
  return c.unread > 0 || c.markedUnread;
}

// ═════════════════════ Nova conversa (painel sobre a lista) ═════════════════════
function NewChatPanel({ onClose, onOpen, online }: { onClose: () => void; onOpen: (c: ConversationSummary) => void; online: Set<string> }) {
  const me = useMe();
  const { data: users = [] } = useUsers();
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [groupName, setGroupName] = useState('');
  const [loading, setLoading] = useState(false);
  const people = users.filter((u) => u.id !== me.id && `${u.name} ${u.jobTitle ?? ''} ${u.department?.name ?? ''}`.toLowerCase().includes(q.toLowerCase()));

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const go = async () => {
    setLoading(true);
    try {
      if (selected.length === 1) onOpen(await api.post<ConversationSummary>('/chat/direct', { userId: selected[0] }));
      else onOpen(await api.post<ConversationSummary>('/chat/groups', { name: groupName.trim(), memberIds: selected }));
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="absolute inset-0 z-10 flex animate-fade-up flex-col bg-white">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-ink-100 px-3">
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Voltar">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <p className="font-semibold">Nova conversa</p>
      </div>
      <div className="p-3">
        <div className="flex items-center gap-2 rounded-lg bg-ink-100 px-3">
          <Search className="h-4 w-4 text-ink-400" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar pessoa, cargo ou área" className="h-9 w-full bg-transparent text-sm outline-none" />
        </div>
        <p className="mt-2 px-1 text-xs text-ink-500">Selecione uma pessoa para conversar ou várias para criar um grupo.</p>
      </div>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-3 pb-2">
          {selected.map((id) => {
            const u = users.find((x) => x.id === id)!;
            return (
              <button key={id} onClick={() => toggle(id)} className="flex items-center gap-1 rounded-full bg-brand-50 py-0.5 pl-0.5 pr-2 text-xs font-medium text-brand-700">
                <Avatar user={u} size={20} /> {u.name.split(' ')[0]} <X className="h-3 w-3" />
              </button>
            );
          })}
        </div>
      )}
      <div className="scroll-thin flex-1 overflow-y-auto overflow-x-hidden">
        {people.map((u) => (
          <button key={u.id} onClick={() => toggle(u.id)} className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-ink-50">
            <Checkbox checked={selected.includes(u.id)} onChange={() => toggle(u.id)} />
            <Avatar user={u} size={36} online={online.has(u.id)} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{u.name}</span>
              <span className="block truncate text-xs text-ink-500">{[u.jobTitle, u.department?.name].filter(Boolean).join(' · ')}</span>
            </span>
          </button>
        ))}
      </div>
      {selected.length > 0 && (
        <div className="space-y-2 border-t border-ink-100 p-3">
          {selected.length > 1 && <Input autoFocus placeholder="Nome do grupo" value={groupName} onChange={(e) => setGroupName(e.target.value)} />}
          <Button className="w-full" loading={loading} disabled={selected.length > 1 && groupName.trim().length < 2} onClick={go}>
            {selected.length === 1 ? 'Conversar' : `Criar grupo com ${selected.length} pessoas`}
          </Button>
        </div>
      )}
    </div>
  );
}

// ═════════════════════ Bolha ═════════════════════
function ReactionPicker({ onPick, onClose, align }: { onPick: (e: string) => void; onClose: () => void; align: 'left' | 'right' }) {
  const [more, setMore] = useState(false);
  useEffect(() => {
    const fn = () => onClose();
    const t = setTimeout(() => window.addEventListener('click', fn), 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener('click', fn);
    };
  }, [onClose]);
  return (
    <div onClick={(e) => e.stopPropagation()} className={clsx('absolute bottom-full z-20 mb-1 animate-pop rounded-2xl border border-ink-200 bg-white p-1 shadow-pop', align === 'right' ? 'right-0' : 'left-0')}>
      {more ? (
        <div className="grid w-[280px] grid-cols-8 gap-0.5 p-1">
          {EMOJI_GRID.map((e) => (
            <button key={e} onClick={() => onPick(e)} className="rounded-md p-1 text-lg hover:bg-ink-100">
              {e}
            </button>
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-0.5">
          {QUICK_REACTIONS.map((e) => (
            <button key={e} onClick={() => onPick(e)} className="flex h-9 w-9 items-center justify-center rounded-full text-xl transition hover:scale-110 hover:bg-ink-100">
              {e}
            </button>
          ))}
          <button onClick={() => setMore(true)} aria-label="Mais emojis" className="flex h-9 w-9 items-center justify-center rounded-full text-ink-500 hover:bg-ink-100">
            <Plus className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}

function Bubble({
  m, mine, first, readByAll, isGroup, meId, onReply, onReact, onEdit, onDelete, highlight,
}: {
  m: ChatMessage; mine: boolean; first: boolean; readByAll: boolean; isGroup: boolean; meId: string; highlight: boolean;
  onReply: () => void; onReact: (e: string) => void; onEdit: () => void; onDelete: () => void;
}) {
  const [picker, setPicker] = useState(false);
  if (m.type === 'SYSTEM') {
    return (
      <div className="my-2 flex justify-center">
        <span className="rounded-md bg-white/90 px-2.5 py-1 text-xs text-ink-500 shadow-sm">{m.body}</span>
      </div>
    );
  }
  const deleted = Boolean(m.deletedAt);
  const grouped = Object.entries(
    m.reactions.reduce<Record<string, { count: number; names: string[]; mine: boolean }>>((acc, r) => {
      acc[r.emoji] ??= { count: 0, names: [], mine: false };
      acc[r.emoji].count++;
      acc[r.emoji].names.push(r.userId === meId ? 'Você' : r.user?.name ?? '');
      if (r.userId === meId) acc[r.emoji].mine = true;
      return acc;
    }, {}),
  );
  const isImage = m.attachmentMime?.startsWith('image/');
  const canEdit = mine && m.type === 'TEXT' && Date.now() - new Date(m.createdAt).getTime() < 15 * 60000;

  return (
    <div className={clsx('group flex items-end gap-1', mine ? 'flex-row-reverse' : 'flex-row', first ? 'mt-2' : 'mt-0.5', grouped.length > 0 && 'mb-3.5')}>
      {!mine && isGroup && <div className="w-7 shrink-0">{first && m.sender && <Avatar user={m.sender} size={28} />}</div>}

      <div className={clsx('relative max-w-[78%] sm:max-w-[62%]', highlight && 'rounded-xl ring-2 ring-brand-300')}>
        <div
          className={clsx(
            'relative rounded-xl px-2.5 pb-1.5 pt-1.5 text-[14px] leading-[1.45] shadow-[0_1px_0.5px_rgba(13,19,48,.08)]',
            mine ? 'bg-chat-out' : 'bg-chat-in',
            first && (mine ? 'rounded-tr-sm' : 'rounded-tl-sm'),
          )}
        >
          {!deleted && (
            <Menu
              align={mine ? 'right' : 'left'}
              trigger={(open) => (
                <button
                  aria-label="Opções da mensagem"
                  className={clsx(
                    'absolute right-1 top-1 z-10 flex h-5 w-5 items-center justify-center rounded-full text-ink-500 transition',
                    mine ? 'bg-chat-out' : 'bg-chat-in',
                    open ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                  )}
                >
                  <ChevronDown className="h-4 w-4" />
                </button>
              )}
              items={[
                { label: 'Responder', icon: <CornerUpLeft />, onClick: onReply },
                { label: 'Reagir', icon: <SmilePlus />, onClick: () => setPicker(true) },
                { label: 'Copiar texto', icon: <Copy />, onClick: () => navigator.clipboard.writeText(m.body ?? '').then(() => toast.success('Copiado')), hidden: !m.body },
                { label: 'Editar', icon: <Pencil />, onClick: onEdit, hidden: !canEdit },
                { label: 'Apagar para todos', icon: <Trash2 />, onClick: onDelete, danger: true, hidden: !mine },
              ]}
            />
          )}

          {!mine && isGroup && first && <p className="mb-0.5 pr-5 text-xs font-semibold text-brand-600">{m.sender?.name}</p>}
          {m.replyTo && !deleted && (
            <div className="mb-1 rounded-md border-l-[3px] border-brand-500 bg-ink-900/[.05] px-2 py-1 text-xs">
              <p className="font-semibold text-brand-700">{m.replyTo.sender?.id === meId ? 'Você' : m.replyTo.sender?.name}</p>
              <p className="line-clamp-2 text-ink-600">{m.replyTo.deletedAt ? 'Mensagem apagada' : m.replyTo.body ?? `📎 ${m.replyTo.attachmentName}`}</p>
            </div>
          )}
          {deleted ? (
            <p className="pr-12 italic text-ink-400">Mensagem apagada</p>
          ) : (
            <>
              {m.attachmentUrl &&
                (isImage ? (
                  <a href={m.attachmentUrl} target="_blank" rel="noreferrer" className="-mx-1 -mt-0.5 mb-1 block">
                    <img src={m.attachmentUrl} alt={m.attachmentName ?? ''} className="max-h-72 rounded-lg object-cover" />
                  </a>
                ) : (
                  <a href={m.attachmentUrl} target="_blank" rel="noreferrer" className="mb-1 flex items-center gap-2.5 rounded-lg bg-ink-900/[.05] px-2.5 py-2 hover:bg-ink-900/[.08]">
                    <FileText className="h-7 w-7 shrink-0 text-brand-500" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{m.attachmentName}</span>
                      <span className="block text-2xs text-ink-500">{m.attachmentSize ? fmtBytes(m.attachmentSize) : ''}</span>
                    </span>
                  </a>
                ))}
              {m.body && <span className="whitespace-pre-wrap break-words">{m.body}</span>}
            </>
          )}
          <span className="float-right ml-2 mt-1.5 flex translate-y-0.5 items-center gap-0.5 text-[10.5px] text-ink-400">
            {m.editedAt && !deleted && <span className="mr-0.5">editada</span>}
            <span className="num">{fmtTime(m.createdAt)}</span>
            {mine && !deleted && (readByAll ? <CheckCheck className="h-3.5 w-3.5 text-brand-500" /> : <Check className="h-3.5 w-3.5" />)}
          </span>
        </div>

        {grouped.length > 0 && (
          <div className={clsx('absolute -bottom-3.5 z-[1] flex', mine ? 'right-2' : 'left-2')}>
            <div className="flex items-center gap-0.5 rounded-full border border-ink-100 bg-white px-1.5 py-0.5 shadow-sm">
              {grouped.map(([emoji, g]) => (
                <button key={emoji} title={g.names.join(', ')} onClick={() => onReact(emoji)} className={clsx('text-[13px] leading-none', g.mine && 'drop-shadow-[0_0_1px_rgba(45,63,224,.6)]')}>
                  {emoji}
                </button>
              ))}
              {m.reactions.length > 1 && <span className="num ml-0.5 text-2xs text-ink-500">{m.reactions.length}</span>}
            </div>
          </div>
        )}

        {picker && (
          <ReactionPicker
            align={mine ? 'right' : 'left'}
            onClose={() => setPicker(false)}
            onPick={(e) => {
              setPicker(false);
              onReact(e);
            }}
          />
        )}
      </div>

      {!deleted && (
        <button
          onClick={() => setPicker((p) => !p)}
          aria-label="Reagir"
          className="mb-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ink-400 opacity-0 transition hover:bg-white/80 hover:text-ink-700 group-hover:opacity-100"
        >
          <Smile className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

// ═════════════════════ Painel de informações ═════════════════════
function InfoPanel({ conv, onClose, online }: { conv: ConversationSummary; onClose: () => void; online: Set<string> }) {
  const me = useMe();
  const qc = useQueryClient();
  const [, setParams] = useSearchParams();
  const { data: users = [] } = useUsers();
  const [adding, setAdding] = useState<string[]>([]);
  const amAdmin = conv.members.find((m) => m.id === me.id)?.isAdmin;
  const other = conv.type === 'DIRECT' ? (users.find((u) => u.id === conv.otherUserId) as DirectoryUser | undefined) : null;
  const refresh = () => qc.invalidateQueries({ queryKey: ['conversations'] });

  const add = async () => {
    await api.patch(`/chat/groups/${conv.id}`, { addMemberIds: adding });
    setAdding([]);
    refresh();
  };
  const removeMember = async (id: string) => {
    await api.patch(`/chat/groups/${conv.id}`, { removeMemberIds: [id] });
    refresh();
  };
  const leave = async () => {
    if (!confirm('Sair do grupo?')) return;
    await api.post(`/chat/conversations/${conv.id}/leave`);
    refresh();
    setParams({});
  };

  return (
    <aside className="flex w-full shrink-0 flex-col border-l border-ink-200 bg-white sm:w-[320px]">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-ink-100 px-3">
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Fechar">
          <X className="h-4 w-4" />
        </Button>
        <p className="font-semibold">{conv.type === 'GROUP' ? 'Dados do grupo' : 'Dados do contato'}</p>
      </div>
      <div className="scroll-thin flex-1 overflow-y-auto overflow-x-hidden">
        <div className="flex flex-col items-center border-b border-ink-100 px-4 py-6 text-center">
          {conv.type === 'GROUP' ? (
            <span className="flex h-20 w-20 items-center justify-center rounded-full bg-ink-900 text-white">
              <Users className="h-8 w-8" />
            </span>
          ) : (
            other && <Avatar user={other} size={80} />
          )}
          <p className="mt-3 text-lg font-semibold">{conv.name}</p>
          {conv.type === 'GROUP' ? (
            <p className="text-sm text-ink-500">{conv.members.length} participantes</p>
          ) : (
            other && (
              <>
                <p className="text-sm text-ink-500">{[other.jobTitle, other.department?.name].filter(Boolean).join(' · ')}</p>
                <p className={clsx('mt-1 text-xs', online.has(other.id) ? 'text-ok' : 'text-ink-400')}>
                  {online.has(other.id) ? 'online' : other.lastSeenAt ? `visto ${fromNow(other.lastSeenAt)}` : ''}
                </p>
              </>
            )
          )}
        </div>
        {other && (
          <dl className="space-y-3 border-b border-ink-100 px-4 py-4 text-sm">
            <div>
              <dt className="text-xs text-ink-500">E-mail</dt>
              <dd>{other.email}</dd>
            </div>
            {other.phone && (
              <div>
                <dt className="text-xs text-ink-500">Telefone</dt>
                <dd>{other.phone}</dd>
              </div>
            )}
          </dl>
        )}
        {conv.type === 'GROUP' && (
          <div className="px-2 py-3">
            <p className="px-2 pb-2 text-xs font-medium text-ink-500">Participantes</p>
            {amAdmin && (
              <div className="mb-2 space-y-2 px-2">
                <UserPicker multiple users={users.filter((u) => !conv.members.some((m) => m.id === u.id))} value={adding} onChange={(v) => setAdding(v as string[])} placeholder="Adicionar pessoas" />
                {adding.length > 0 && (
                  <Button size="sm" icon={<UserPlus className="h-3.5 w-3.5" />} onClick={add}>
                    Adicionar {adding.length}
                  </Button>
                )}
              </div>
            )}
            {conv.members.map((m) => (
              <div key={m.id} className="group/m flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-ink-50">
                <Avatar user={m} size={32} online={online.has(m.id)} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{m.id === me.id ? 'Você' : m.name}</span>
                  <span className="block truncate text-xs text-ink-500">{m.jobTitle}</span>
                </span>
                {m.isAdmin && <span className="rounded bg-ink-100 px-1.5 text-2xs text-ink-500">admin</span>}
                {amAdmin && m.id !== me.id && (
                  <button onClick={() => removeMember(m.id)} title="Remover" className="hidden rounded p-1 text-ink-400 hover:text-bad group-hover/m:block">
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
            <button onClick={leave} className="mt-3 flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm text-bad hover:bg-bad-soft">
              <LogOut className="h-4 w-4" /> Sair do grupo
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}

// ═════════════════════ Conversa aberta ═════════════════════
function ConversationView({ conv, online, onBack, typing }: { conv: ConversationSummary; online: Set<string>; onBack: () => void; typing: string[] }) {
  const me = useMe();
  const qc = useQueryClient();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [uploading, setUploading] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [members, setMembers] = useState(conv.members);
  const [atBottom, setAtBottom] = useState(true);
  const [newBelow, setNewBelow] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const stickBottom = useRef(true);
  const lastTyping = useRef(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // marcador "mensagens não lidas": calculado ao abrir
  const unreadFrom = useRef<string | null>(conv.members.find((m) => m.id === me.id)?.lastReadAt ?? null);

  const markRead = useCallback(() => {
    api.post(`/chat/conversations/${conv.id}/read`).then(() => {
      qc.invalidateQueries({ queryKey: ['conversations'] });
      qc.invalidateQueries({ queryKey: ['chat-unread'] });
    });
  }, [conv.id, qc]);

  useEffect(() => {
    api.get<{ items: ChatMessage[]; nextCursor: string | null }>(`/chat/conversations/${conv.id}/messages`).then((r) => {
      setMessages(r.items);
      setCursor(r.nextCursor);
      setLoading(false);
      markRead();
    });
    inputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conv.id]);

  useEffect(() => setMembers(conv.members), [conv.members]);

  useLayoutEffect(() => {
    if (stickBottom.current && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [messages]);

  // auto-altura do campo de texto
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [text]);

  useSocketEvent<ChatMessage>('chat:message', (m) => {
    if (m.conversationId !== conv.id) return;
    const el = scroller.current;
    const near = !el || el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    stickBottom.current = near || m.senderId === me.id;
    if (!stickBottom.current) setNewBelow((n) => n + 1);
    setMessages((ms) => (ms.some((x) => x.id === m.id) ? ms : [...ms, m]));
    if (m.senderId !== me.id && !document.hidden) markRead();
  });
  useSocketEvent<ChatMessage>('chat:message:update', (m) => {
    if (m.conversationId !== conv.id) return;
    stickBottom.current = false;
    setMessages((ms) => ms.map((x) => (x.id === m.id ? m : x)));
  });
  useSocketEvent<{ conversationId: string; userId: string; lastReadAt: string }>('chat:read', (r) => {
    if (r.conversationId !== conv.id) return;
    setMembers((ms) => ms.map((m) => (m.id === r.userId ? { ...m, lastReadAt: r.lastReadAt } : m)));
  });
  useEffect(() => {
    const fn = () => !document.hidden && markRead();
    document.addEventListener('visibilitychange', fn);
    return () => document.removeEventListener('visibilitychange', fn);
  }, [markRead]);

  const onScroll = () => {
    const el = scroller.current!;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    setAtBottom(bottom);
    if (bottom) setNewBelow(0);
    if (el.scrollTop < 80) void loadMore();
  };
  const scrollToBottom = () => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    setNewBelow(0);
  };

  const loadMore = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    const el = scroller.current!;
    const prevHeight = el.scrollHeight;
    const r = await api.get<{ items: ChatMessage[]; nextCursor: string | null }>(`/chat/conversations/${conv.id}/messages`, { before: cursor });
    stickBottom.current = false;
    setMessages((ms) => [...r.items, ...ms]);
    setCursor(r.nextCursor);
    setLoadingMore(false);
    requestAnimationFrame(() => (el.scrollTop = el.scrollHeight - prevHeight));
  };

  const send = async () => {
    const body = text.trim();
    if (!body) return;
    setText('');
    setShowEmoji(false);
    try {
      if (editing) {
        await api.patch(`/chat/messages/${editing.id}`, { body });
        setEditing(null);
      } else {
        stickBottom.current = true;
        unreadFrom.current = null;
        await api.post(`/chat/conversations/${conv.id}/messages`, { body, replyToId: replyTo?.id });
        setReplyTo(null);
      }
      qc.invalidateQueries({ queryKey: ['conversations'] });
    } catch (e) {
      setText(body);
      toast.error(errorMessage(e));
    }
  };

  const upload = async (file: File) => {
    if (file.size > 10 * 1024 * 1024) return toast.error('Arquivo maior que 10 MB');
    setUploading(true);
    try {
      const fd = new FormData();
      if (text.trim()) fd.append('body', text.trim());
      if (replyTo) fd.append('replyToId', replyTo.id);
      fd.append('file', file);
      stickBottom.current = true;
      await api.upload(`/chat/conversations/${conv.id}/messages`, fd);
      setText('');
      setReplyTo(null);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setUploading(false);
    }
  };

  const onType = (v: string) => {
    setText(v);
    if (Date.now() - lastTyping.current > 2000) {
      lastTyping.current = Date.now();
      getSocket()?.emit('chat:typing', { conversationId: conv.id });
    }
  };

  const others = members.filter((m) => m.id !== me.id);
  const otherOnline = conv.otherUserId ? online.has(conv.otherUserId) : false;
  const typingNames = typing.map((id) => members.find((m) => m.id === id)?.name.split(' ')[0]).filter(Boolean);
  const subtitle = typingNames.length
    ? `${conv.type === 'GROUP' ? typingNames.join(', ') + ' ' : ''}digitando…`
    : conv.type === 'DIRECT'
      ? otherOnline
        ? 'online'
        : others[0]?.lastSeenAt
          ? `visto por último ${fromNow(others[0].lastSeenAt)}`
          : others[0]?.jobTitle ?? ''
      : others.map((m) => m.name.split(' ')[0]).join(', ');
  const isReadByAll = (m: ChatMessage) => others.length > 0 && others.every((o) => new Date(o.lastReadAt) >= new Date(m.createdAt));

  const firstUnreadId = useMemo(() => {
    const from = unreadFrom.current;
    if (!from) return null;
    return messages.find((m) => m.senderId !== me.id && m.type !== 'SYSTEM' && new Date(m.createdAt) > new Date(from))?.id ?? null;
  }, [messages, me.id]);
  const matches = query.trim() ? messages.filter((m) => m.body?.toLowerCase().includes(query.toLowerCase())).map((m) => m.id) : [];

  return (
    <div className="flex h-full">
      <div
        className="relative flex min-w-0 flex-1 flex-col"
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files')) {
            e.preventDefault();
            setDragOver(true);
          }
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) void upload(f);
        }}
      >
        <div className="flex h-14 shrink-0 items-center gap-3 border-b border-ink-200 bg-white px-3">
          <Button variant="ghost" size="icon-sm" onClick={onBack} className="md:hidden" aria-label="Voltar">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <button onClick={() => setShowInfo(true)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
            {conv.type === 'DIRECT' && others[0] ? (
              <Avatar user={others[0]} size={38} online={otherOnline} />
            ) : (
              <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full bg-ink-900 text-white">
                <Users className="h-4 w-4" />
              </span>
            )}
            <span className="min-w-0">
              <span className="block truncate text-[15px] font-semibold">{conv.name}</span>
              <span className={clsx('block truncate text-xs', typingNames.length || otherOnline ? 'text-ok' : 'text-ink-500')}>{subtitle}</span>
            </span>
          </button>
          {searching ? (
            <div className="flex items-center gap-1">
              <Input autoFocus className="h-8 w-44" placeholder="Buscar na conversa" value={query} onChange={(e) => setQuery(e.target.value)} />
              <span className="num w-10 text-center text-xs text-ink-500">{query ? matches.length : ''}</span>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => {
                  setSearching(false);
                  setQuery('');
                }}
                aria-label="Fechar busca"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <Button variant="ghost" size="icon" onClick={() => setSearching(true)} aria-label="Buscar mensagens">
              <Search className="h-[18px] w-[18px]" />
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={() => setShowInfo((s) => !s)} aria-label="Informações">
            <Info className="h-[18px] w-[18px]" />
          </Button>
        </div>

        <div ref={scroller} onScroll={onScroll} className="chat-wallpaper scroll-thin flex-1 overflow-y-auto px-3 pb-3 pt-2 sm:px-[6%]">
          {loading ? (
            <div className="flex h-full items-center justify-center">
              <Spinner />
            </div>
          ) : (
            <>
              {loadingMore && <Loader2 className="mx-auto my-2 h-5 w-5 animate-spin text-ink-400" />}
              {!cursor && messages.length === 0 && (
                <div className="mt-10 flex justify-center">
                  <span className="rounded-lg bg-white px-3 py-2 text-center text-xs text-ink-500 shadow-sm">Nenhuma mensagem ainda. Diga oi.</span>
                </div>
              )}
              {messages.map((m, i) => {
                const prev = messages[i - 1];
                const newDay = !prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
                const first = !prev || prev.senderId !== m.senderId || newDay || prev.type === 'SYSTEM' || new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() > 5 * 60000;
                return (
                  <Fragment key={m.id}>
                    {newDay && (
                      <div className="sticky top-1 z-[2] my-3 flex justify-center">
                        <span className="rounded-md bg-white px-2.5 py-1 text-xs font-medium capitalize text-ink-500 shadow-sm">{dayDivider(m.createdAt)}</span>
                      </div>
                    )}
                    {m.id === firstUnreadId && (
                      <div className="my-3 flex justify-center">
                        <span className="rounded-md bg-white/90 px-3 py-1 text-xs font-medium text-brand-700 shadow-sm">Mensagens não lidas</span>
                      </div>
                    )}
                    <Bubble
                      m={m}
                      meId={me.id}
                      mine={m.senderId === me.id}
                      first={first}
                      isGroup={conv.type === 'GROUP'}
                      readByAll={isReadByAll(m)}
                      highlight={matches.includes(m.id)}
                      onReply={() => {
                        setEditing(null);
                        setReplyTo(m);
                        inputRef.current?.focus();
                      }}
                      onReact={(e) => api.post(`/chat/messages/${m.id}/reactions`, { emoji: e })}
                      onEdit={() => {
                        setReplyTo(null);
                        setEditing(m);
                        setText(m.body ?? '');
                        inputRef.current?.focus();
                      }}
                      onDelete={() => confirm('Apagar esta mensagem para todos?') && api.del(`/chat/messages/${m.id}`)}
                    />
                  </Fragment>
                );
              })}
            </>
          )}
        </div>

        {!atBottom && (
          <button onClick={scrollToBottom} aria-label="Ir para o fim" className="absolute bottom-20 right-5 z-10 flex h-10 w-10 items-center justify-center rounded-full border border-ink-200 bg-white text-ink-600 shadow-pop hover:text-ink-900">
            <ArrowDown className="h-4 w-4" />
            {newBelow > 0 && <span className="num absolute -right-1 -top-1 h-5 min-w-5 rounded-full bg-brand-500 px-1 text-center text-2xs font-semibold leading-5 text-white">{newBelow}</span>}
          </button>
        )}

        {dragOver && (
          <div className="pointer-events-none absolute inset-2 z-20 flex items-center justify-center rounded-xl border-2 border-dashed border-brand-400 bg-brand-50/80 text-sm font-medium text-brand-700">
            Solte o arquivo para enviar
          </div>
        )}

        <div className="shrink-0 border-t border-ink-200 bg-ink-50 px-3 py-2">
          {(replyTo || editing) && (
            <div className="mb-2 flex items-center gap-2 rounded-lg border-l-[3px] border-brand-500 bg-white px-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-brand-700">{editing ? 'Editando mensagem' : `Respondendo a ${replyTo!.senderId === me.id ? 'você' : replyTo!.sender?.name}`}</p>
                <p className="truncate text-ink-600">{(editing ?? replyTo)!.body ?? `📎 ${(editing ?? replyTo)!.attachmentName}`}</p>
              </div>
              <button
                onClick={() => {
                  setReplyTo(null);
                  if (editing) setText('');
                  setEditing(null);
                }}
                aria-label="Cancelar"
                className="text-ink-400 hover:text-ink-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
          <div className="relative flex items-end gap-1.5">
            {showEmoji && (
              <div className="absolute bottom-full left-0 mb-2 grid w-[300px] animate-pop grid-cols-8 gap-0.5 rounded-xl border border-ink-200 bg-white p-2 shadow-pop">
                {EMOJI_GRID.map((e) => (
                  <button key={e} onClick={() => setText((t) => t + e)} className="rounded-md p-1 text-lg hover:bg-ink-100">
                    {e}
                  </button>
                ))}
              </div>
            )}
            <Button variant="ghost" size="icon" onClick={() => setShowEmoji((v) => !v)} aria-label="Emojis">
              <Smile className="h-5 w-5" />
            </Button>
            <label className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-ink-600 hover:bg-ink-100" aria-label="Anexar arquivo">
              {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Paperclip className="h-5 w-5" />}
              <input type="file" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
            </label>
            <textarea
              ref={inputRef}
              rows={1}
              value={text}
              onChange={(e) => onType(e.target.value)}
              onPaste={(e) => {
                const f = e.clipboardData.files?.[0];
                if (f) {
                  e.preventDefault();
                  void upload(f);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
                if (e.key === 'Escape') {
                  setReplyTo(null);
                  setEditing(null);
                }
              }}
              placeholder="Digite uma mensagem"
              className="min-h-[38px] flex-1 resize-none rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-300"
            />
            <button onClick={send} disabled={!text.trim()} aria-label="Enviar" className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-lg bg-brand-500 text-white transition hover:bg-brand-600 disabled:bg-ink-300">
              {editing ? <Check className="h-5 w-5" /> : <Send className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </div>
      {showInfo && <InfoPanel conv={{ ...conv, members }} online={online} onClose={() => setShowInfo(false)} />}
    </div>
  );
}

// ═════════════════════ Página ═════════════════════
export default function Chat() {
  const me = useMe();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const activeId = params.get('c');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [archivedView, setArchivedView] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [typing, setTyping] = useState<Record<string, string[]>>({});
  const [notifPerm, setNotifPerm] = useState(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);
  const online = useOnline();
  const { data: convs = [], isLoading } = useQuery({ queryKey: ['conversations'], queryFn: () => api.get<ConversationSummary[]>('/chat/conversations') });

  useSocketEvent<ChatMessage>('chat:message', () => qc.invalidateQueries({ queryKey: ['conversations'] }));
  useSocketEvent('chat:conversation', () => qc.invalidateQueries({ queryKey: ['conversations'] }));
  useSocketEvent<{ conversationId: string }>('chat:removed', (p) => {
    qc.invalidateQueries({ queryKey: ['conversations'] });
    if (p.conversationId === activeId) setParams({});
  });
  useSocketEvent<{ conversationId: string; userId: string }>('chat:typing', ({ conversationId, userId }) => {
    setTyping((t) => ({ ...t, [conversationId]: [...new Set([...(t[conversationId] ?? []), userId])] }));
    setTimeout(() => setTyping((t) => ({ ...t, [conversationId]: (t[conversationId] ?? []).filter((u) => u !== userId) })), 3000);
  });

  const archivedCount = convs.filter((c) => c.archived).length;
  const archivedUnread = convs.filter((c) => c.archived && isUnread(c)).length;
  const visible = useMemo(
    () =>
      convs.filter((c) => {
        if (c.archived !== archivedView) return false;
        if (search && !(c.name ?? '').toLowerCase().includes(search.toLowerCase())) return false;
        if (!archivedView && filter === 'unread' && !isUnread(c)) return false;
        if (!archivedView && filter === 'groups' && c.type !== 'GROUP') return false;
        return true;
      }),
    [convs, archivedView, search, filter],
  );
  const unreadTotal = convs.filter((c) => !c.archived && isUnread(c)).length;
  const active = convs.find((c) => c.id === activeId) ?? null;

  const act = async (ids: string[], action: BulkAction) => {
    await api.post('/chat/conversations/bulk', { ids, action });
    qc.invalidateQueries({ queryKey: ['conversations'] });
    qc.invalidateQueries({ queryKey: ['chat-unread'] });
    const msg = { archive: 'Arquivada', unarchive: 'Desarquivada', read: 'Marcada como lida', unread: 'Marcada como não lida', mute: 'Notificações silenciadas', unmute: 'Notificações ativadas', pin: 'Fixada', unpin: 'Desafixada' }[action];
    toast.success(ids.length > 1 ? `${ids.length} conversas: ${msg.toLowerCase()}` : msg);
    if (action === 'archive' && ids.includes(activeId ?? '')) setParams({});
  };
  const exitSelect = () => {
    setSelecting(false);
    setSelected([]);
  };
  const allSelectedArchived = selected.length > 0 && selected.every((id) => convs.find((c) => c.id === id)?.archived);

  return (
    <div className="flex h-full bg-white">
      {/* ── Lista ── */}
      <div className={clsx('relative flex w-full flex-col border-r border-ink-200 md:w-[380px] md:shrink-0', active && 'hidden md:flex')}>
        {newOpen && (
          <NewChatPanel
            online={online}
            onClose={() => setNewOpen(false)}
            onOpen={(c) => {
              qc.invalidateQueries({ queryKey: ['conversations'] });
              setArchivedView(false);
              setParams({ c: c.id });
            }}
          />
        )}

        <div className="flex h-14 shrink-0 items-center gap-1 px-3">
          {archivedView ? (
            <>
              <Button variant="ghost" size="icon-sm" onClick={() => setArchivedView(false)} aria-label="Voltar">
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <h1 className="flex-1 text-lg font-semibold">Arquivadas</h1>
            </>
          ) : selecting ? (
            <>
              <Button variant="ghost" size="icon-sm" onClick={exitSelect} aria-label="Cancelar seleção">
                <X className="h-4 w-4" />
              </Button>
              <h1 className="flex-1 text-[15px] font-semibold">{selected.length} selecionada(s)</h1>
            </>
          ) : (
            <>
              <h1 className="flex-1 text-lg font-semibold">Conversas</h1>
              <Button variant="ghost" size="icon" onClick={() => setNewOpen(true)} title="Nova conversa">
                <MessageCirclePlus className="h-5 w-5" />
              </Button>
              <Menu
                trigger={() => (
                  <Button variant="ghost" size="icon" aria-label="Mais opções">
                    <MoreVertical className="h-5 w-5" />
                  </Button>
                )}
                items={[
                  { label: 'Nova conversa ou grupo', icon: <Users />, onClick: () => setNewOpen(true) },
                  { label: 'Selecionar conversas', icon: <SquareCheck />, onClick: () => setSelecting(true) },
                  { label: 'Marcar todas como lidas', icon: <MailOpen />, onClick: () => act(convs.filter(isUnread).map((c) => c.id), 'read'), hidden: !unreadTotal },
                  {
                    label: 'Avisar no navegador',
                    icon: <BellRing />,
                    hidden: notifPerm === 'granted' || notifPerm === 'unsupported',
                    onClick: async () => setNotifPerm(await askNotificationPermission()),
                  },
                ]}
              />
            </>
          )}
        </div>

        <div className="space-y-2 px-3 pb-2">
          <div className="flex items-center gap-2 rounded-lg bg-ink-100 px-3">
            <Search className="h-4 w-4 text-ink-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Pesquisar conversa" className="h-9 w-full bg-transparent text-sm outline-none" />
          </div>
          {!archivedView && (
            <div className="flex gap-1.5">
              {(
                [
                  ['all', 'Tudo'],
                  ['unread', `Não lidas${unreadTotal ? ` ${unreadTotal}` : ''}`],
                  ['groups', 'Grupos'],
                ] as const
              ).map(([v, label]) => (
                <button
                  key={v}
                  onClick={() => setFilter(v)}
                  className={clsx('h-7 rounded-full px-3 text-[13px] font-medium transition', filter === v ? 'bg-brand-50 text-brand-700' : 'bg-ink-100 text-ink-600 hover:bg-ink-200')}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="scroll-thin flex-1 overflow-y-auto overflow-x-hidden">
          {!archivedView && archivedCount > 0 && (
            <button onClick={() => setArchivedView(true)} className="flex w-full items-center gap-4 px-4 py-2.5 text-left hover:bg-ink-50">
              <span className="flex w-10 justify-center text-ink-500">
                <Archive className="h-5 w-5" />
              </span>
              <span className="flex-1 text-sm font-medium">Arquivadas</span>
              <span className={clsx('num text-xs', archivedUnread ? 'font-semibold text-brand-600' : 'text-ink-400')}>{archivedUnread || archivedCount}</span>
            </button>
          )}
          {isLoading && <Spinner className="mx-auto mt-10" />}
          {!isLoading && !visible.length && (
            <p className="px-6 py-10 text-center text-sm text-ink-500">
              {archivedView ? 'Nenhuma conversa arquivada.' : filter === 'unread' ? 'Nenhuma conversa não lida.' : 'Nenhuma conversa encontrada.'}
            </p>
          )}
          {visible.map((c) => {
            const typingHere = (typing[c.id] ?? []).length > 0;
            const lm = c.lastMessage;
            const mineLast = lm?.senderId === me.id;
            const preview = lm
              ? lm.deleted
                ? 'Mensagem apagada'
                : `${c.type === 'GROUP' && lm.senderName && !mineLast ? `${lm.senderName.split(' ')[0]}: ` : ''}${lm.body ?? (lm.attachmentName ? `📎 ${lm.attachmentName}` : '')}`
              : 'Nenhuma mensagem ainda';
            const readByAll = mineLast && lm && c.members.filter((m) => m.id !== me.id).every((m) => new Date(m.lastReadAt) >= new Date(lm.createdAt));
            const other = c.members.find((m) => m.id === c.otherUserId);
            const isSel = selected.includes(c.id);
            const unread = isUnread(c);
            return (
              <div
                key={c.id}
                onClick={() => (selecting ? setSelected((s) => (isSel ? s.filter((x) => x !== c.id) : [...s, c.id])) : setParams({ c: c.id }))}
                className={clsx('group relative flex cursor-pointer items-center gap-3 px-3 py-2 transition-colors', c.id === activeId && !selecting ? 'bg-ink-100' : isSel ? 'bg-brand-50' : 'hover:bg-ink-50')}
              >
                {selecting && <Checkbox checked={isSel} onChange={() => setSelected((s) => (isSel ? s.filter((x) => x !== c.id) : [...s, c.id]))} />}
                {c.type === 'DIRECT' && other ? (
                  <Avatar user={other} size={46} online={online.has(other.id)} />
                ) : (
                  <span className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-full bg-ink-900 text-white">
                    <Users className="h-5 w-5" />
                  </span>
                )}
                <div className="min-w-0 flex-1 border-b border-ink-100 py-1.5 group-last:border-0">
                  <div className="flex items-center gap-2">
                    <span className={clsx('flex-1 truncate text-[15px]', unread ? 'font-semibold' : 'font-medium')}>{c.name}</span>
                    <span className={clsx('num shrink-0 text-xs', unread ? 'font-semibold text-brand-600' : 'text-ink-400')}>{lm ? chatStamp(lm.createdAt) : ''}</span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    {mineLast && !lm?.deleted && !typingHere && (readByAll ? <CheckCheck className="h-3.5 w-3.5 shrink-0 text-brand-500" /> : <Check className="h-3.5 w-3.5 shrink-0 text-ink-400" />)}
                    <span className={clsx('flex-1 truncate text-[13px]', typingHere ? 'font-medium text-ok' : unread ? 'text-ink-800' : 'text-ink-500')}>{typingHere ? 'digitando…' : preview}</span>
                    {c.muted && <BellOff className="h-3.5 w-3.5 shrink-0 text-ink-400" />}
                    {c.pinned && <Pin className="h-3.5 w-3.5 shrink-0 text-ink-400" />}
                    {c.unread > 0 ? (
                      <span className={clsx('num h-5 min-w-5 shrink-0 rounded-full px-1.5 text-center text-2xs font-semibold leading-5 text-white', c.muted ? 'bg-ink-400' : 'bg-brand-500')}>{c.unread}</span>
                    ) : (
                      c.markedUnread && <span className="h-3 w-3 shrink-0 rounded-full bg-brand-500" />
                    )}
                    {!selecting && (
                      <Menu
                        trigger={(open) => (
                          <button onClick={(e) => e.stopPropagation()} aria-label="Opções da conversa" className={clsx('-mr-1 rounded p-0.5 text-ink-400 transition hover:text-ink-700', open ? 'opacity-100' : 'w-0 opacity-0 group-hover:w-auto group-hover:opacity-100')}>
                            <ChevronDown className="h-4 w-4" />
                          </button>
                        )}
                        items={[
                          { label: c.archived ? 'Desarquivar' : 'Arquivar', icon: c.archived ? <ArchiveRestore /> : <Archive />, onClick: () => act([c.id], c.archived ? 'unarchive' : 'archive') },
                          { label: c.pinned ? 'Desafixar' : 'Fixar no topo', icon: c.pinned ? <PinOff /> : <Pin />, onClick: () => act([c.id], c.pinned ? 'unpin' : 'pin'), hidden: c.archived },
                          { label: c.muted ? 'Reativar notificações' : 'Silenciar', icon: c.muted ? <Volume2 /> : <BellOff />, onClick: () => act([c.id], c.muted ? 'unmute' : 'mute') },
                          { label: unread ? 'Marcar como lida' : 'Marcar como não lida', icon: <MailOpen />, onClick: () => act([c.id], unread ? 'read' : 'unread') },
                          {
                            label: 'Selecionar',
                            icon: <SquareCheck />,
                            onClick: () => {
                              setSelecting(true);
                              setSelected([c.id]);
                            },
                          },
                        ]}
                      />
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {selecting && (
          <div className="flex shrink-0 items-center justify-around border-t border-ink-200 bg-white px-2 py-2">
            {(
              [
                { label: allSelectedArchived ? 'Desarquivar' : 'Arquivar', icon: allSelectedArchived ? <ArchiveRestore /> : <Archive />, action: allSelectedArchived ? 'unarchive' : 'archive' },
                { label: 'Lidas', icon: <MailOpen />, action: 'read' },
                { label: 'Silenciar', icon: <BellOff />, action: 'mute' },
                { label: 'Fixar', icon: <Pin />, action: 'pin' },
              ] as { label: string; icon: ReactNode; action: BulkAction }[]
            ).map((b) => (
              <button
                key={b.label}
                disabled={!selected.length}
                onClick={async () => {
                  await act(selected, b.action);
                  exitSelect();
                }}
                className="flex flex-col items-center gap-0.5 rounded-lg px-3 py-1 text-2xs font-medium text-ink-600 hover:bg-ink-100 disabled:opacity-40 [&>svg]:h-5 [&>svg]:w-5"
              >
                {b.icon}
                {b.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Conversa ── */}
      <div className={clsx('min-w-0 flex-1', !active && 'hidden md:block')}>
        {active ? (
          <ConversationView key={active.id} conv={active} online={online} onBack={() => setParams({})} typing={typing[active.id] ?? []} />
        ) : (
          <div className="chat-wallpaper flex h-full flex-col items-center justify-center p-6 text-center">
            <div className="max-w-sm rounded-xl bg-white px-8 py-7 shadow-card">
              <MessageCirclePlus className="mx-auto h-8 w-8 text-brand-500" />
              <h2 className="mt-3 text-lg font-semibold">Selecione uma conversa</h2>
              <p className="mt-1 text-sm text-ink-500">Ou comece uma nova com qualquer pessoa da empresa.</p>
              <Button className="mt-4" onClick={() => setNewOpen(true)}>
                Nova conversa
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
