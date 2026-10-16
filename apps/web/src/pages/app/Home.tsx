import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { AlertTriangle, ArrowUpRight, BookOpenCheck, CalendarClock, Handshake, CalendarDays, Camera, CheckCircle2, FileSignature, Heart, ListChecks, MessageCircle, ShieldAlert, Smile, Target, Video } from 'lucide-react';
import { FLAG_COLOR, LICENSE_STATE_COLOR, TASK_PRIORITY_COLOR, formatGoalValue, type FlagSeverity } from '@dumax/shared';
import { api } from '@/lib/api';
import { useMe } from '@/lib/auth';
import type { Announcement, Inbox } from '@/lib/types';
import { dueLabel, fmtDateShort, fmtTime, fmtWeekday, fromNow } from '@/lib/format';
import { Avatar, Badge, Panel, PageLoader, ProgressBar, StatCard } from '@/components/ui';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
}

interface Pending {
  key: string;
  icon: ReactNode;
  tone: 'bad' | 'warn' | 'brand';
  text: ReactNode;
  to: string;
  cta: string;
}


export default function Home() {
  const me = useMe();
  const navigate = useNavigate();
  const congratulate = async (userId: string) => {
    const conv = await api.post<{ id: string }>('/chat/direct', { userId });
    navigate(`/chat?c=${conv.id}`);
  };
  const { data: inbox, isLoading } = useQuery({ queryKey: ['inbox'], queryFn: () => api.get<Inbox>('/inbox'), refetchInterval: 60_000 });
  const { data: announcements } = useQuery({ queryKey: ['announcements'], queryFn: () => api.get<Announcement[]>('/feed/announcements') });

  if (isLoading || !inbox) return <PageLoader />;

  const pending: Pending[] = [
    ...(inbox.mustRead ?? []).map((a) => ({
      key: `read-${a.id}`,
      icon: <BookOpenCheck />,
      tone: 'warn' as const,
      text: (
        <>
          Leitura obrigatória: <strong className="font-medium text-ink-900">{a.title}</strong>
        </>
      ),
      to: '/mural',
      cta: 'Ler',
    })),
    ...inbox.reviews.map((r) => ({
      key: `rev-${r.id}`,
      icon: <CheckCircle2 />,
      tone: 'brand' as const,
      text: (
        <>
          <strong className="font-medium text-ink-900">{r.assignee.name.split(' ')[0]}</strong> entregou <strong className="font-medium text-ink-900">{r.title}</strong>
        </>
      ),
      to: `/demandas?task=${r.id}`,
      cta: 'Aprovar',
    })),
    ...inbox.extensionRequests.map((r) => ({
      key: `ext-${r.id}`,
      icon: <CalendarClock />,
      tone: 'warn' as const,
      text: (
        <>
          <strong className="font-medium text-ink-900">{r.requester.name.split(' ')[0]}</strong> pediu mais prazo em <strong className="font-medium text-ink-900">{r.task.title}</strong>, até {fmtDateShort(r.requestedDueAt)}
        </>
      ),
      to: `/demandas?task=${r.task.id}`,
      cta: 'Responder',
    })),
    ...(inbox.oneOnOneActions ?? []).map((a) => ({
      key: `oo-${a.id}`,
      icon: <Handshake />,
      tone: (a.dueAt && new Date(a.dueAt) < new Date() ? 'bad' : 'brand') as 'bad' | 'brand',
      text: (
        <>
          Combinado do 1:1: <strong className="font-medium text-ink-900">{a.text}</strong>
          {a.dueAt && <> · até {fmtDateShort(a.dueAt)}</>}
        </>
      ),
      to: `/1-1?com=${a.withUserId}`,
      cta: 'Abrir',
    })),
    ...inbox.documentsToSign.map((d) => ({
      key: `doc-${d.id}`,
      icon: <FileSignature />,
      tone: 'brand' as const,
      text: (
        <>
          <strong className="font-medium text-ink-900">{d.title}</strong> aguarda sua assinatura · enviado por {d.from}
        </>
      ),
      to: `/assinar/${d.token}`,
      cta: 'Assinar',
    })),
    ...(inbox.tasks.overdue
      ? [{ key: 'overdue', icon: <AlertTriangle />, tone: 'bad' as const, text: <>{inbox.tasks.overdue} demanda(s) atrasada(s)</>, to: '/demandas', cta: 'Ver demandas' }]
      : []),
    ...inbox.licenses.map((l) => ({
      key: `lic-${l.id}`,
      icon: <ShieldAlert />,
      tone: (l.state === 'EXPIRED' ? 'bad' : 'warn') as 'bad' | 'warn',
      text: (
        <>
          <strong className="font-medium text-ink-900">{l.name}</strong> {l.daysLeft < 0 ? `venceu há ${-l.daysLeft} dia(s)` : l.daysLeft === 0 ? 'vence hoje' : `vence em ${l.daysLeft} dia(s)`} · você é responsável
        </>
      ),
      to: `/licencas?id=${l.id}`,
      cta: 'Renovar',
    })),
    ...(!me.avatarUrl
      ? [{ key: 'photo', icon: <Camera />, tone: 'brand' as const, text: <>Adicione sua foto de perfil para o time te reconhecer no chat e no organograma</>, to: '/perfil', cta: 'Adicionar' }]
      : []),
    ...(inbox.pulse && !inbox.pulse.answered
      ? [{ key: 'pulse', icon: <Smile />, tone: 'brand' as const, text: <>Pulse da semana: {inbox.pulse.question}</>, to: '/clima', cta: 'Responder' }]
      : []),
  ];
  const toneCls = { bad: 'bg-bad-soft text-bad', warn: 'bg-warn-soft text-warn', brand: 'bg-brand-50 text-brand-600' };

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm capitalize text-ink-500">{fmtWeekday(new Date())}</p>
          <h1 className="text-[30px] font-bold leading-tight">
            {greeting()}, {me.name.split(' ')[0]}
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ['/demandas', 'Demandas', <ListChecks key="d" />],
              ['/chat', 'Chat', <MessageCircle key="c" />],
              ['/agenda', 'Agenda', <CalendarDays key="a" />],
              ['/mural', 'Elogiar alguém', <Heart key="m" />],
            ] as const
          ).map(([to, label, icon]) => (
            <Link key={to} to={to} className="inline-flex h-9 items-center gap-2 rounded-lg border border-ink-200 bg-white px-3 text-sm font-medium text-ink-700 transition hover:border-brand-300 hover:text-brand-700 [&>svg]:h-4 [&>svg]:w-4 [&>svg]:text-ink-400">
              {icon}
              {label}
            </Link>
          ))}
        </div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {(
          [
            ['/demandas', 'Demandas abertas', inbox.tasks.open, 'default'],
            ['/demandas', 'Atrasadas', inbox.tasks.overdue, inbox.tasks.overdue ? 'danger' : 'default'],
            ['/demandas', 'Vencem hoje', inbox.tasks.dueToday, inbox.tasks.dueToday ? 'warn' : 'default'],
            ['/agenda', 'Reuniões hoje', inbox.meetingsToday.length, 'default'],
          ] as const
        ).map(([to, label, value, tone]) => (
          <Link key={label} to={to} className="rounded-2xl transition hover:shadow-lift focus-visible:ring-2 focus-visible:ring-brand-400">
            <StatCard label={label} value={value} tone={tone} />
          </Link>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-6">
          <Panel title="Pendências" subtitle={pending.length ? `${pending.length} item(ns) pedindo sua ação` : undefined}>
            {pending.length ? (
              <ul>
                {pending.map((p) => (
                  <li key={p.key} className="flex items-center gap-3 border-b border-ink-100 px-4 py-3 last:border-0">
                    <span className={clsx('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg [&>svg]:h-4 [&>svg]:w-4', toneCls[p.tone])}>{p.icon}</span>
                    <span className="min-w-0 flex-1 text-sm text-ink-600">{p.text}</span>
                    <Link to={p.to} className="shrink-0 rounded-md border border-ink-200 px-2.5 py-1 text-[13px] font-medium text-ink-700 hover:border-ink-300 hover:bg-ink-50">
                      {p.cta}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="flex items-center gap-3 px-4 py-5 text-sm text-ink-500">
                <CheckCircle2 className="h-5 w-5 text-ok" /> Nada pendente com você agora.
              </div>
            )}
          </Panel>

          <Panel
            title="Minhas demandas"
            actions={
              <Link to="/demandas" className="flex items-center gap-1 text-[13px] font-medium text-brand-600 hover:underline">
                Abrir quadro <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            }
          >
            {inbox.tasks.top.length ? (
              <ul>
                {inbox.tasks.top.map((t) => {
                  const due = dueLabel(t.dueAt);
                  return (
                    <li key={t.id} className="flex items-center gap-3 border-b border-ink-100 px-4 py-2.5 last:border-0 hover:bg-ink-50/60">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: TASK_PRIORITY_COLOR[t.priority] }} />
                      <Link to={`/demandas?task=${t.id}`} className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink-900">{t.title}</span>
                        <span className="block text-xs text-ink-500">de {t.createdBy.name}</span>
                      </Link>
                      {due && <Badge tone={due.tone === 'danger' ? 'bad' : due.tone === 'warn' ? 'warn' : 'neutral'}>{due.text}</Badge>}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="px-4 py-5 text-sm text-ink-500">Nenhuma demanda aberta com você.</p>
            )}
          </Panel>

          {inbox.team && inbox.team.alerts.length > 0 && (
            <Panel
              title="Atenção no time"
              subtitle="Alertas de desempenho dos últimos 14 dias"
              actions={
                <Link to="/admin" className="flex items-center gap-1 text-[13px] font-medium text-brand-600 hover:underline">
                  Ver desempenho <ArrowUpRight className="h-3.5 w-3.5" />
                </Link>
              }
            >
              <ul>
                {inbox.team.alerts.map((a, i) => (
                  <li key={i}>
                    <Link to={`/admin/desempenho/${a.user.id}`} className="flex items-center gap-3 border-b border-ink-100 px-4 py-2.5 last:border-0 hover:bg-ink-50/60">
                      <Avatar user={a.user} size={28} />
                      <span className="w-36 shrink-0 truncate text-sm font-medium">{a.user.name}</span>
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: FLAG_COLOR[a.severity as FlagSeverity] }} />
                      <span className="min-w-0 flex-1 truncate text-sm text-ink-600">{a.message}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>

        <aside className="space-y-6">
          {inbox.celebrations.length > 0 && (
            <Panel title="Celebrações" subtitle="Aniversários e tempo de casa da semana">
              <ul className="divide-y divide-ink-100">
                {inbox.celebrations.map((c) => (
                  <li key={`${c.kind}-${c.user.id}`} className="flex items-center gap-3 px-4 py-2.5">
                    <Avatar user={c.user} size={34} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{c.user.id === me.id ? 'Você' : c.user.name}</span>
                      <span className="block text-xs text-ink-500">
                        {c.kind === 'BIRTHDAY' ? '🎂 Aniversário' : `🎉 ${c.years} ${c.years === 1 ? 'ano' : 'anos'} de casa`} {c.inDays === 0 ? 'hoje' : c.inDays === 1 ? 'amanhã' : `em ${c.inDays} dias`}
                      </span>
                    </span>
                    {c.user.id !== me.id && (
                      <button onClick={() => congratulate(c.user.id)} className="shrink-0 rounded-lg px-2.5 py-1 text-xs font-medium text-brand-600 hover:bg-brand-50">
                        Parabenizar
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          <Panel title="Hoje" actions={<CalendarDays className="h-4 w-4 text-ink-400" />}>
            {inbox.meetingsToday.length ? (
              <ul className="px-4 py-2">
                {inbox.meetingsToday.map((m) => (
                  <li key={m.id} className="flex gap-3 py-2">
                    <span className="num w-12 shrink-0 pt-0.5 text-sm font-semibold text-ink-900">{fmtTime(m.startsAt)}</span>
                    <span className="min-w-0 flex-1 border-l-2 border-brand-400 pl-3">
                      <Link to={`/agenda?meeting=${m.id}`} className="block truncate text-sm font-medium hover:text-brand-700">
                        {m.title}
                      </Link>
                      <span className="block text-xs text-ink-500">até {fmtTime(m.endsAt)}</span>
                    </span>
                    {m.videoUrl && (
                      <a href={m.videoUrl} target="_blank" rel="noreferrer" title="Entrar na chamada" className="self-center rounded-md p-1.5 text-brand-600 hover:bg-brand-50">
                        <Video className="h-4 w-4" />
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 py-4 text-sm text-ink-500">Sem reuniões hoje.</p>
            )}
          </Panel>

          <Panel
            title="Minhas metas"
            actions={
              <Link to="/metas" className="text-ink-400 hover:text-ink-700">
                <Target className="h-4 w-4" />
              </Link>
            }
          >
            {inbox.goals.length ? (
              <ul className="space-y-4 px-4 py-3.5">
                {inbox.goals.map((g) => {
                  const behind = g.elapsed - g.progress > 0.2;
                  return (
                    <li key={g.id}>
                      <div className="mb-1.5 flex items-baseline justify-between gap-2">
                        <span className="truncate text-sm font-medium">{g.title}</span>
                        <span className="num shrink-0 text-xs text-ink-500">
                          {formatGoalValue(g.currentValue, g.unit)} / {formatGoalValue(g.targetValue, g.unit)}
                        </span>
                      </div>
                      <ProgressBar value={g.progress} marker={g.elapsed} color={behind ? '#C77700' : '#2D3FE0'} />
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="px-4 py-4 text-sm text-ink-500">Nenhuma meta ativa.</p>
            )}
          </Panel>

          <Panel
            title="Comunicados"
            actions={
              <Link to="/mural" className="text-[13px] font-medium text-brand-600 hover:underline">
                Mural
              </Link>
            }
          >
            <ul>
              {(announcements ?? []).slice(0, 3).map((a) => (
                <li key={a.id} className="border-b border-ink-100 px-4 py-3 last:border-0">
                  <p className="text-sm font-medium text-ink-900">{a.title}</p>
                  <p className="mt-0.5 line-clamp-2 text-[13px] text-ink-600">{a.body}</p>
                  <p className="mt-1 text-2xs text-ink-400">
                    {a.author.name} · {fromNow(a.createdAt)}
                  </p>
                </li>
              ))}
            </ul>
          </Panel>

          {inbox.licenses.length > 0 && (
            <Panel title="Licenças sob sua responsabilidade">
              <ul>
                {inbox.licenses.map((l) => (
                  <li key={l.id}>
                    <Link to={`/licencas?id=${l.id}`} className="flex items-center gap-2 border-b border-ink-100 px-4 py-2.5 text-sm last:border-0 hover:bg-ink-50/60">
                      <span className="h-2 w-2 rounded-full" style={{ background: LICENSE_STATE_COLOR[l.state] }} />
                      <span className="flex-1 truncate">{l.name}</span>
                      <span className="num text-xs text-ink-500">{l.daysLeft < 0 ? `vencida` : `${l.daysLeft} dias`}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </aside>
      </div>
    </div>
  );
}
