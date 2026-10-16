import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { toast } from 'sonner';
import {
  BarChart3, Bell, Briefcase, Building2, CalendarDays, CheckSquare, ChevronsLeft, ChevronsRight, Clock, FileSignature,
  Fingerprint, HeartPulse, Home, LogOut, Megaphone, Menu as MenuIcon, MessageCircle, Network, ShieldCheck, Smile, Sparkles,
  Target, User, Users, Volume2, VolumeX, X, Compass, ExternalLink,
} from 'lucide-react';
import { ROLE_LABEL } from '@dumax/shared';
import { useAuth, useMe } from '@/lib/auth';
import { api } from '@/lib/api';
import { useSocketEvent } from '@/lib/socket';
import { askNotificationPermission, browserNotify, playMessageSound, playNotificationSound, soundPrefs } from '@/lib/notifier';
import type { ChatMessage, ConversationSummary, Notification } from '@/lib/types';
import { fromNow } from '@/lib/format';
import { Avatar, Menu } from '../ui';
import { Logo, LogoMark } from '../brand';
import { AssistantPanel } from '../AssistantPanel';

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  badge?: number;
  end?: boolean;
  external?: boolean;
}

const COLLAPSE_KEY = 'dumax.sidebar';

function NavSection({ title, items, collapsed, onNavigate }: { title?: string; items: NavItem[]; collapsed: boolean; onNavigate: () => void }) {
  if (!items.length) return null;
  return (
    <div className="mb-4">
      {title && !collapsed && <p className="mb-1 px-3 text-xs font-medium text-ink-400">{title}</p>}
      {title && collapsed && <div className="mx-3 mb-2 h-px bg-white/10" />}
      {items.map((it) =>
        it.external ? (
          <a
            key={it.to}
            href={it.to}
            target="_blank"
            rel="noreferrer"
            title={collapsed ? it.label : undefined}
            className={clsx('mb-px flex h-9 items-center gap-3 rounded-lg text-sm text-ink-300 transition-colors hover:bg-white/[.05] hover:text-white', collapsed ? 'justify-center' : 'px-3')}
          >
            <span className="text-ink-400 [&>svg]:h-[18px] [&>svg]:w-[18px]">{it.icon}</span>
            {!collapsed && <span className="flex-1 truncate">{it.label}</span>}
          </a>
        ) : (
        <NavLink
          key={it.to}
          to={it.to}
          end={it.end}
          onClick={onNavigate}
          title={collapsed ? it.label : undefined}
          className={({ isActive }) =>
            clsx(
              'relative mb-px flex h-9 items-center gap-3 rounded-lg text-sm transition-colors',
              collapsed ? 'justify-center px-0' : 'px-3',
              isActive ? 'bg-white/[.08] font-medium text-white' : 'text-ink-300 hover:bg-white/[.05] hover:text-white',
            )
          }
        >
          {({ isActive }) => (
            <>
              {isActive && <span className="absolute left-0 top-2 h-5 w-[3px] rounded-r bg-brand-400" />}
              <span className={clsx('[&>svg]:h-[18px] [&>svg]:w-[18px]', isActive ? 'text-brand-300' : 'text-ink-400')}>{it.icon}</span>
              {!collapsed && <span className="flex-1 truncate">{it.label}</span>}
              {!!it.badge && (
                <span className={clsx('num rounded-full bg-brand-500 text-2xs font-semibold text-white', collapsed ? 'absolute right-1.5 top-1 h-4 min-w-4 px-1 text-center leading-4' : 'px-1.5 py-px')}>
                  {it.badge > 99 ? '99+' : it.badge}
                </span>
              )}
            </>
          )}
        </NavLink>
        ),
      )}
    </div>
  );
}

function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data } = useQuery({ queryKey: ['notifications'], queryFn: () => api.get<{ items: Notification[]; unread: number }>('/feed/notifications') });

  useSocketEvent<Notification>('notification', (n) => {
    qc.invalidateQueries({ queryKey: ['notifications'] });
    qc.invalidateQueries({ queryKey: ['inbox'] });
    if (n.type.startsWith('task')) qc.invalidateQueries({ queryKey: ['tasks'] });
    if (n.type.startsWith('meeting')) qc.invalidateQueries({ queryKey: ['meetings'] });
    if (n.type.startsWith('document')) qc.invalidateQueries({ queryKey: ['documents'] });
    if (n.type.startsWith('license')) qc.invalidateQueries({ queryKey: ['licenses'] });
    if (n.type.startsWith('goal')) qc.invalidateQueries({ queryKey: ['goals'] });
    toast(n.title, { description: n.body ?? undefined, action: n.link ? { label: 'Abrir', onClick: () => navigate(n.link!) } : undefined });
    if (soundPrefs.enabled()) playNotificationSound();
    browserNotify(n.title, n.body ?? '', () => n.link && navigate(n.link), `dumax-${n.id}`);
  });

  const markAll = async () => {
    await api.post('/feed/notifications/read', {});
    qc.invalidateQueries({ queryKey: ['notifications'] });
  };

  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-label="Notificações" className="relative flex h-9 w-9 items-center justify-center rounded-lg text-ink-600 hover:bg-ink-100">
        <Bell className="h-[18px] w-[18px]" />
        {!!data?.unread && <span className="num absolute right-1 top-1 h-4 min-w-4 rounded-full bg-bad px-1 text-center text-2xs font-semibold leading-4 text-white">{data.unread}</span>}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-40 mt-2 w-[380px] max-w-[calc(100vw-24px)] animate-pop overflow-hidden rounded-xl border border-ink-200 bg-white shadow-pop">
            <div className="flex h-12 items-center justify-between border-b border-ink-100 px-4">
              <p className="text-sm font-semibold">Notificações</p>
              <button onClick={markAll} className="text-xs font-medium text-brand-600 hover:underline">
                Marcar todas como lidas
              </button>
            </div>
            <div className="scroll-thin max-h-[440px] overflow-y-auto">
              {data?.items.length ? (
                data.items.map((n) => (
                  <button
                    key={n.id}
                    onClick={async () => {
                      setOpen(false);
                      if (!n.readAt) {
                        await api.post('/feed/notifications/read', { ids: [n.id] });
                        qc.invalidateQueries({ queryKey: ['notifications'] });
                      }
                      if (n.link) navigate(n.link);
                    }}
                    className={clsx('flex w-full gap-3 border-b border-ink-100 px-4 py-3 text-left last:border-0 hover:bg-ink-50', !n.readAt && 'bg-brand-50/40')}
                  >
                    <span className={clsx('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.readAt ? 'bg-transparent' : 'bg-brand-500')} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-ink-800">{n.title}</span>
                      {n.body && <span className="line-clamp-2 block text-xs text-ink-500">{n.body}</span>}
                      <span className="mt-0.5 block text-2xs text-ink-400">{fromNow(n.createdAt)}</span>
                    </span>
                  </button>
                ))
              ) : (
                <p className="px-4 py-10 text-center text-sm text-ink-400">Nenhuma notificação</p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** Mensagem nova → aviso no canto + toque (exceto se a conversa já está aberta, arquivada ou silenciada) */
function ChatNotifier() {
  const me = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();

  useSocketEvent<ChatMessage>('chat:message', (m) => {
    qc.invalidateQueries({ queryKey: ['chat-unread'] });
    if (m.senderId === me.id || m.type === 'SYSTEM') return;
    const viewing = location.pathname === '/chat' && params.get('c') === m.conversationId && !document.hidden;
    if (viewing) return;
    const conv = qc.getQueryData<ConversationSummary[]>(['conversations'])?.find((c) => c.id === m.conversationId);
    if (conv?.muted || conv?.archived) return;

    const isGroup = conv?.type === 'GROUP';
    const who = m.sender?.name ?? 'Nova mensagem';
    const text = m.body ?? (m.attachmentName ? `📎 ${m.attachmentName}` : '');
    const open = () => navigate(`/chat?c=${m.conversationId}`);

    if (soundPrefs.enabled()) playMessageSound();
    browserNotify(isGroup ? `${who} · ${conv?.name}` : who, text, open);
    toast.custom(
      (id) => (
        <button
          onClick={() => {
            toast.dismiss(id);
            open();
          }}
          className="flex w-[356px] items-start gap-3 rounded-xl border border-ink-200 bg-white p-3 text-left shadow-pop"
        >
          {m.sender ? <Avatar user={m.sender} size={38} /> : <span className="h-[38px] w-[38px] rounded-full bg-ink-200" />}
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="truncate text-sm font-semibold text-ink-900">{who}</span>
              {isGroup && <span className="truncate text-xs text-ink-500">em {conv?.name}</span>}
            </span>
            <span className="line-clamp-2 text-sm text-ink-600">{text}</span>
          </span>
          <MessageCircle className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" />
        </button>
      ),
      { duration: 6000 },
    );
  });
  return null;
}

const PERM_KEY = 'dumax.notif-asked';
/** Faixa discreta pedindo permissão para notificações do sistema (aparece uma vez) */
function NotificationPermissionBar() {
  const [show, setShow] = useState(() => {
    try {
      return typeof Notification !== 'undefined' && Notification.permission === 'default' && localStorage.getItem(PERM_KEY) !== '1';
    } catch {
      return false;
    }
  });
  if (!show) return null;
  const dismiss = () => {
    try {
      localStorage.setItem(PERM_KEY, '1');
    } catch {
      /* ignore */
    }
    setShow(false);
  };
  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-brand-100 bg-brand-50 px-4 py-2 text-[13px] text-ink-700">
      <Bell className="h-4 w-4 shrink-0 text-brand-600" />
      <span className="flex-1">Ative as notificações do computador para receber mensagens e avisos mesmo com o Hub em segundo plano.</span>
      <button
        onClick={async () => {
          await askNotificationPermission();
          dismiss();
        }}
        className="rounded-md bg-brand-500 px-2.5 py-1 font-medium text-white hover:bg-brand-600"
      >
        Ativar notificações
      </button>
      <button onClick={dismiss} className="text-ink-500 hover:text-ink-800">
        Agora não
      </button>
    </div>
  );
}

/** Contador no título da aba: "(3) Dumax Hub" */
function TitleBadge({ count }: { count: number }) {
  useEffect(() => {
    document.title = count ? `(${count}) Dumax Hub` : 'Dumax Hub';
  }, [count]);
  return null;
}

export function AppShell({ portal }: { portal: 'colaborador' | 'admin' }) {
  const me = useMe();
  const { logout, isAdminPortal, isHR } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [sound, setSound] = useState(soundPrefs.enabled());
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const location = useLocation();
  const { data: unread } = useQuery({ queryKey: ['chat-unread'], queryFn: () => api.get<{ total: number }>('/chat/unread-count'), refetchInterval: 60_000 });
  const { data: docCounts } = useQuery({ queryKey: ['documents', 'counts'], queryFn: () => api.get<{ toSign: number }>('/documents/counts'), refetchInterval: 120_000 });

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  // ── Menus de cada portal
  const sections: { title?: string; items: NavItem[] }[] =
    portal === 'admin'
      ? [
          {
            items: [
              { to: '/admin', label: 'Visão geral', icon: <BarChart3 />, end: true },
              { to: '/admin/ponto', label: 'Ponto do time', icon: <Clock /> },
              { to: '/admin/metas', label: 'Metas do time', icon: <Target /> },
              { to: '/admin/perfis', label: 'Mapa de perfis', icon: <Compass /> },
              ...(isHR ? [{ to: '/admin/clima', label: 'Clima', icon: <HeartPulse /> }] : []),
            ],
          },
          {
            title: 'Recrutamento',
            items: [
              { to: '/admin/recrutamento', label: 'Vagas e candidatos', icon: <Briefcase /> },
              { to: '/vagas', label: 'Portal de vagas', icon: <ExternalLink />, external: true },
            ],
          },
          {
            title: 'Cadastros',
            items: [
              ...(isHR
                ? [
                    { to: '/admin/pessoas', label: 'Colaboradores', icon: <Users /> },
                    { to: '/admin/estrutura', label: 'Áreas e times', icon: <Building2 /> },
                  ]
                : []),
              { to: '/admin/organograma', label: 'Organograma', icon: <Network /> },
            ],
          },
          {
            title: 'Empresa',
            items: [
              { to: '/admin/licencas', label: 'Licenças', icon: <ShieldCheck /> },
              { to: '/admin/documentos', label: 'Documentos', icon: <FileSignature /> },
            ],
          },
        ]
      : [
          {
            items: [
              { to: '/inicio', label: 'Início', icon: <Home />, end: true },
              { to: '/demandas', label: 'Demandas', icon: <CheckSquare /> },
              { to: '/chat', label: 'Chat', icon: <MessageCircle />, badge: unread?.total },
              { to: '/agenda', label: 'Agenda', icon: <CalendarDays /> },
              { to: '/documentos', label: 'Documentos', icon: <FileSignature />, badge: docCounts?.toSign },
            ],
          },
          {
            title: 'Eu',
            items: [
              { to: '/desempenho', label: 'Meu desempenho', icon: <BarChart3 /> },
              { to: '/metas', label: 'Minhas metas', icon: <Target /> },
              { to: '/ponto', label: 'Meu ponto', icon: <Fingerprint /> },
              { to: '/perfil-comportamental', label: 'Meu perfil', icon: <Compass /> },
            ],
          },
          {
            title: 'Empresa',
            items: [
              { to: '/mural', label: 'Mural', icon: <Megaphone /> },
              { to: '/organograma', label: 'Organograma', icon: <Network /> },
              { to: '/perfis', label: 'Mapa de perfis', icon: <Users /> },
              { to: '/clima', label: 'Pulse da semana', icon: <Smile /> },
            ],
          },
        ];

  const fullBleed = location.pathname.startsWith('/chat');
  const isCollapsed = collapsed && !mobileOpen;
  const close = () => setMobileOpen(false);

  const sidebar = (
    <div className="flex h-full flex-col bg-ink-900">
      <div className={clsx('flex h-14 shrink-0 items-center', isCollapsed ? 'justify-center' : 'justify-between px-4')}>
        {isCollapsed ? (
          <LogoMark size={26} />
        ) : (
          <span className="flex items-center gap-2">
            <Logo light />
            {portal === 'admin' && <span className="rounded bg-brand-500/20 px-1.5 py-0.5 text-2xs font-semibold text-brand-200">ADMIN</span>}
          </span>
        )}
        <button className="text-ink-400 lg:hidden" onClick={close} aria-label="Fechar menu">
          <X className="h-5 w-5" />
        </button>
      </div>
      <nav className={clsx('scroll-thin flex-1 overflow-y-auto pb-3 pt-2', isCollapsed ? 'px-2' : 'px-2.5')}>
        {sections.map((sec, i) => (
          <NavSection key={i} title={sec.title} items={sec.items} collapsed={isCollapsed} onNavigate={close} />
        ))}
      </nav>
      <div className={clsx('shrink-0 border-t border-white/10 p-2', isCollapsed && 'flex flex-col items-center gap-1')}>
        <Menu
          align="left"
          trigger={() => (
            <button className={clsx('flex w-full items-center gap-2.5 rounded-lg p-1.5 text-left hover:bg-white/[.06]', isCollapsed && 'justify-center')}>
              <Avatar user={me} size={30} />
              {!isCollapsed && (
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-white">{me.name}</span>
                  <span className="block truncate text-xs text-ink-400">{me.jobTitle ?? ROLE_LABEL[me.role]}</span>
                </span>
              )}
            </button>
          )}
          items={[
            { label: 'Meu perfil', icon: <User />, onClick: () => navigate('/perfil') },
            {
              label: sound ? 'Desativar som de mensagens' : 'Ativar som de mensagens',
              icon: sound ? <VolumeX /> : <Volume2 />,
              onClick: () => {
                soundPrefs.set(!sound);
                setSound(!sound);
                if (!sound) playMessageSound();
              },
            },
            { label: 'Sair', icon: <LogOut />, onClick: logout, danger: true },
          ]}
        />
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="mt-1 hidden h-8 w-full items-center justify-center gap-2 rounded-lg text-xs text-ink-400 hover:bg-white/[.06] hover:text-white lg:flex"
        >
          {collapsed ? <ChevronsRight className="h-4 w-4" /> : (
            <>
              <ChevronsLeft className="h-4 w-4" /> Recolher menu
            </>
          )}
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className={clsx('hidden shrink-0 transition-[width] duration-200 lg:block', collapsed ? 'w-[60px]' : 'w-[232px]')}>{sidebar}</aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-50 bg-ink-900/50 lg:hidden" onClick={close}>
          <div className="h-full w-[260px]" onClick={(e) => e.stopPropagation()}>
            {sidebar}
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-ink-200 bg-white px-3 sm:px-5">
          <button className="rounded-lg p-1.5 hover:bg-ink-100 lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Abrir menu">
            <MenuIcon className="h-5 w-5" />
          </button>
          <div className="lg:hidden">
            <Logo size={22} />
          </div>
          {isAdminPortal && (
            <div className="ml-1 hidden rounded-lg border border-ink-200 bg-ink-50 p-0.5 sm:inline-flex">
              {(
                [
                  ['colaborador', 'Colaborador', '/inicio'],
                  ['admin', 'Admin', '/admin'],
                ] as const
              ).map(([key, label, to]) => (
                <button
                  key={key}
                  onClick={() => navigate(to)}
                  className={clsx('h-7 rounded-md px-3 text-[13px] font-medium transition', portal === key ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-800')}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          <div className="flex-1" />
          <button
            onClick={() => setAiOpen(true)}
            className="flex h-9 items-center gap-2 rounded-lg border border-ink-200 bg-white px-3 text-sm font-medium text-ink-700 transition hover:border-brand-300 hover:text-brand-700"
          >
            <Sparkles className="h-4 w-4 text-brand-500" />
            <span className="hidden sm:inline">Perguntar ao assistente</span>
          </button>
          <NotificationsBell />
        </header>
        <NotificationPermissionBar />
        <main className={clsx('min-h-0 flex-1', fullBleed ? 'overflow-hidden' : 'scroll-thin overflow-y-auto')}>
          {fullBleed ? (
            <Outlet />
          ) : (
            <div className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">
              <Outlet />
            </div>
          )}
        </main>
      </div>

      <ChatNotifier />
      <TitleBadge count={unread?.total ?? 0} />
      <AssistantPanel open={aiOpen} onClose={() => setAiOpen(false)} />
    </div>
  );
}
