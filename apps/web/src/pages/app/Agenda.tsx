import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addDays, addMonths, endOfMonth, endOfWeek, format, isSameDay, isSameMonth, isToday, startOfDay, startOfMonth, startOfWeek,
} from 'date-fns';
import { ptBR } from 'date-fns/locale';
import clsx from 'clsx';
import { toast } from 'sonner';
import { ChevronLeft, ChevronRight, MapPin, Plus, Sparkles, Video, X } from 'lucide-react';
import { RSVP_LABEL } from '@dumax/shared';
import { api, errorMessage } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { useUsers } from '@/lib/hooks';
import type { Meeting } from '@/lib/types';
import { fmtTime, isoToLocalInput, localInputToIso } from '@/lib/format';
import { Avatar, Badge, Button, Field, Input, Modal, Select, Tabs, Textarea, UserPicker } from '@/components/ui';

type View = 'day' | 'week' | 'month';
const START_HOUR = 7;
const END_HOUR = 21;
const ROW = 48; // px por hora

// ───────────── Formulário ─────────────
function MeetingModal({ start, onClose }: { start: Date; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: users = [] } = useUsers();
  const me = useMe();
  const [form, setForm] = useState({ title: '', startsAt: isoToLocalInput(start.toISOString()), duration: '30', participantIds: [] as string[], location: '', videoUrl: '', description: '' });
  const [tried, setTried] = useState(false);
  const [conflicts, setConflicts] = useState<Meeting[]>([]);

  useEffect(() => {
    if (!form.startsAt) return;
    const s = new Date(form.startsAt);
    const e = new Date(s.getTime() + Number(form.duration) * 60000);
    const t = setTimeout(() => {
      api.post<Meeting[]>('/meetings/conflicts', { userIds: [me.id, ...form.participantIds], startsAt: s.toISOString(), endsAt: e.toISOString() }).then(setConflicts).catch(() => setConflicts([]));
    }, 300);
    return () => clearTimeout(t);
  }, [form.startsAt, form.duration, form.participantIds, me.id]);

  const create = useMutation({
    mutationFn: () =>
      api.post<Meeting>('/meetings', {
        title: form.title.trim(),
        startsAt: localInputToIso(form.startsAt),
        durationMinutes: Number(form.duration),
        participantIds: form.participantIds,
        location: form.location || null,
        videoUrl: form.videoUrl || null,
        description: form.description || null,
      }),
    onSuccess: () => {
      toast.success(form.participantIds.length ? 'Reunião marcada e convites enviados' : 'Reunião marcada');
      qc.invalidateQueries({ queryKey: ['meetings'] });
      qc.invalidateQueries({ queryKey: ['inbox'] });
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const titleErr = form.title.trim().length < 2 ? 'Dê um nome à reunião' : null;

  return (
    <Modal
      open
      onClose={onClose}
      title="Nova reunião"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={create.isPending} onClick={() => (setTried(true), !titleErr && create.mutate())}>
            Marcar reunião
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Título" required error={tried ? titleErr : null}>
          <Input autoFocus invalid={tried && !!titleErr} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Ex.: Alinhamento semanal do comercial" />
        </Field>
        <div className="grid grid-cols-[1fr_140px] gap-3">
          <Field label="Início">
            <Input type="datetime-local" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} />
          </Field>
          <Field label="Duração">
            <Select value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value })}>
              {['15', '30', '45', '60', '90', '120', '180'].map((d) => (
                <option key={d} value={d}>
                  {Number(d) < 60 ? `${d} min` : `${Number(d) / 60} h`}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Participantes">
          <UserPicker multiple users={users.filter((u) => u.id !== me.id)} value={form.participantIds} onChange={(v) => setForm({ ...form, participantIds: v as string[] })} placeholder="Convidar pessoas" />
        </Field>
        {conflicts.length > 0 && (
          <div className="rounded-lg border border-warn/30 bg-warn-soft px-3 py-2 text-[13px] text-warn">
            Conflito de horário:{' '}
            {conflicts.slice(0, 3).map((c) => `${c.title} (${fmtTime(c.startsAt)}–${fmtTime(c.endsAt)})`).join('; ')}
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Local">
            <Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Sala de reuniões 2" />
          </Field>
          <Field label="Link da chamada">
            <Input value={form.videoUrl} onChange={(e) => setForm({ ...form, videoUrl: e.target.value })} placeholder="https://meet.google.com/..." />
          </Field>
        </div>
        <Field label="Pauta">
          <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}

function MeetingDetail({ m, onClose }: { m: Meeting; onClose: () => void }) {
  const me = useMe();
  const qc = useQueryClient();
  const mine = m.participants.find((p) => p.userId === me.id);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['meetings'] });
    qc.invalidateQueries({ queryKey: ['inbox'] });
  };
  const rsvp = async (r: string) => {
    await api.post(`/meetings/${m.id}/rsvp`, { rsvp: r });
    refresh();
  };
  const cancel = async () => {
    if (!confirm('Cancelar esta reunião para todos os participantes?')) return;
    await api.post(`/meetings/${m.id}/cancel`);
    refresh();
    onClose();
  };
  return (
    <Modal open onClose={onClose} title={m.title} size="sm">
      <p className="text-sm font-medium capitalize">{format(new Date(m.startsAt), "EEEE, d 'de' MMMM", { locale: ptBR })}</p>
      <p className="num text-sm text-ink-500">
        {fmtTime(m.startsAt)} – {fmtTime(m.endsAt)}
      </p>
      {m.createdVia === 'AI' && (
        <Badge tone="brand" className="mt-2">
          <Sparkles className="h-3 w-3" /> Marcada pelo assistente
        </Badge>
      )}
      <div className="mt-4 space-y-2 text-sm">
        {m.location && (
          <p className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-ink-400" /> {m.location}
          </p>
        )}
        {m.videoUrl && (
          <a href={m.videoUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 font-medium text-brand-600 hover:underline">
            <Video className="h-4 w-4" /> Entrar na chamada
          </a>
        )}
      </div>
      {m.description && <p className="mt-3 whitespace-pre-line rounded-lg bg-ink-50 p-3 text-sm text-ink-700">{m.description}</p>}
      <p className="mb-2 mt-5 text-[13px] font-medium text-ink-500">{m.participants.length} participantes</p>
      <ul className="space-y-2">
        {m.participants.map((p) => (
          <li key={p.userId} className="flex items-center gap-2 text-sm">
            <Avatar user={p.user} size={24} />
            <span className="flex-1">
              {p.user.name}
              {p.userId === m.organizerId && <span className="text-ink-400"> · organizador</span>}
            </span>
            <Badge tone={p.rsvp === 'ACCEPTED' ? 'ok' : p.rsvp === 'DECLINED' ? 'bad' : 'neutral'}>{RSVP_LABEL[p.rsvp]}</Badge>
          </li>
        ))}
      </ul>
      {mine && m.organizerId !== me.id && (
        <div className="mt-5 flex gap-2">
          {(['ACCEPTED', 'TENTATIVE', 'DECLINED'] as const).map((r) => (
            <Button key={r} size="sm" variant={mine.rsvp === r ? 'dark' : 'secondary'} onClick={() => rsvp(r)}>
              {r === 'ACCEPTED' ? 'Vou' : r === 'TENTATIVE' ? 'Talvez' : 'Não vou'}
            </Button>
          ))}
        </div>
      )}
      {m.organizerId === me.id && (
        <Button className="mt-5" size="sm" variant="ghost" icon={<X className="h-4 w-4" />} onClick={cancel}>
          Cancelar reunião
        </Button>
      )}
    </Modal>
  );
}

// ───────────── Layout de eventos sobrepostos ─────────────
function layoutDay(events: Meeting[]) {
  const sorted = [...events].sort((a, b) => +new Date(a.startsAt) - +new Date(b.startsAt));
  const out: { m: Meeting; col: number; cols: number }[] = [];
  let cluster: { m: Meeting; col: number }[] = [];
  let clusterEnd = 0;
  const flush = () => {
    const cols = Math.max(1, ...cluster.map((c) => c.col + 1));
    cluster.forEach((c) => out.push({ ...c, cols }));
    cluster = [];
  };
  for (const m of sorted) {
    const s = +new Date(m.startsAt);
    if (cluster.length && s >= clusterEnd) flush();
    const used = new Set(cluster.filter((c) => +new Date(c.m.endsAt) > s).map((c) => c.col));
    let col = 0;
    while (used.has(col)) col++;
    cluster.push({ m, col });
    clusterEnd = Math.max(clusterEnd, +new Date(m.endsAt));
  }
  flush();
  return out;
}

function TimeGrid({ days, meetings, meId, onSlot, onOpen }: { days: Date[]; meetings: Meeting[]; meId: string; onSlot: (d: Date) => void; onOpen: (id: string) => void }) {
  const now = new Date();
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = Math.max(START_HOUR, Math.min(now.getHours() - 1, END_HOUR - 6));
    scroller.current?.scrollTo({ top: (h - START_HOUR) * ROW });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const hours = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i);
  const cols = `56px repeat(${days.length}, minmax(0, 1fr))`;

  return (
    <div className="card flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="grid shrink-0 border-b border-ink-200" style={{ gridTemplateColumns: cols }}>
        <div />
        {days.map((d) => (
          <div key={d.toISOString()} className="border-l border-ink-100 py-2 text-center">
            <p className={clsx('text-xs capitalize', isToday(d) ? 'font-medium text-brand-600' : 'text-ink-500')}>{format(d, 'EEE', { locale: ptBR })}</p>
            <p className={clsx('num mx-auto mt-0.5 flex h-7 w-7 items-center justify-center rounded-full text-[15px] font-semibold', isToday(d) ? 'bg-brand-500 text-white' : 'text-ink-900')}>{format(d, 'd')}</p>
          </div>
        ))}
      </div>
      <div ref={scroller} className="scroll-thin relative min-h-0 flex-1 overflow-y-auto">
        <div className="grid" style={{ gridTemplateColumns: cols }}>
          <div>
            {hours.map((h) => (
              <div key={h} style={{ height: ROW }} className="num relative pr-2 text-right text-2xs text-ink-400">
                <span className="relative -top-2">{h === START_HOUR ? '' : `${String(h).padStart(2, '0')}:00`}</span>
              </div>
            ))}
          </div>
          {days.map((d) => {
            const dayEvents = layoutDay(meetings.filter((m) => isSameDay(new Date(m.startsAt), d)));
            return (
              <div key={d.toISOString()} className={clsx('relative border-l border-ink-100', isToday(d) && 'bg-brand-50/30')}>
                {hours.map((h) => (
                  <div key={h} style={{ height: ROW }} className="border-t border-ink-100">
                    {[0, 30].map((min) => (
                      <button
                        key={min}
                        aria-label={`Marcar às ${h}:${min || '00'}`}
                        onClick={() => {
                          const s = new Date(d);
                          s.setHours(h, min, 0, 0);
                          onSlot(s);
                        }}
                        className="block h-1/2 w-full hover:bg-brand-50"
                      />
                    ))}
                  </div>
                ))}
                {isToday(d) && now.getHours() >= START_HOUR && now.getHours() < END_HOUR && (
                  <div className="pointer-events-none absolute left-0 right-0 z-10 h-px bg-bad" style={{ top: (now.getHours() - START_HOUR + now.getMinutes() / 60) * ROW }}>
                    <span className="absolute -left-1 -top-[3px] h-[7px] w-[7px] rounded-full bg-bad" />
                  </div>
                )}
                {dayEvents.map(({ m, col, cols: n }) => {
                  const s = new Date(m.startsAt);
                  const e = new Date(m.endsAt);
                  const top = Math.max(0, (s.getHours() - START_HOUR + s.getMinutes() / 60) * ROW);
                  const height = Math.max(20, ((+e - +s) / 3600000) * ROW - 2);
                  const myRsvp = m.participants.find((p) => p.userId === meId)?.rsvp;
                  const tentative = myRsvp === 'PENDING' || myRsvp === 'TENTATIVE';
                  return (
                    <button
                      key={m.id}
                      onClick={() => onOpen(m.id)}
                      className={clsx(
                        'absolute overflow-hidden rounded-md border-l-[3px] px-1.5 py-0.5 text-left text-xs transition hover:z-10 hover:shadow-pop',
                        tentative ? 'border-brand-400 bg-white text-ink-700 ring-1 ring-inset ring-brand-200' : 'border-brand-600 bg-brand-100 text-ink-900',
                      )}
                      style={{ top, height, left: `calc(${(col / n) * 100}% + 2px)`, width: `calc(${100 / n}% - 4px)` }}
                    >
                      <p className="truncate font-medium">{m.title}</p>
                      {height > 30 && (
                        <p className="num truncate text-2xs text-ink-500">
                          {fmtTime(m.startsAt)}–{fmtTime(m.endsAt)}
                        </p>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function MonthGrid({ cursor, meetings, onDay, onOpen }: { cursor: Date; meetings: Meeting[]; onDay: (d: Date) => void; onOpen: (id: string) => void }) {
  const start = startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 });
  const end = endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 });
  const days: Date[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) days.push(d);
  return (
    <div className="card flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="grid shrink-0 grid-cols-7 border-b border-ink-200">
        {['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'].map((d) => (
          <p key={d} className="py-2 text-center text-xs text-ink-500">
            {d}
          </p>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-7 auto-rows-fr">
        {days.map((d) => {
          const evs = meetings.filter((m) => isSameDay(new Date(m.startsAt), d));
          return (
            <div key={d.toISOString()} onClick={() => onDay(d)} className={clsx('min-h-[96px] cursor-pointer border-b border-r border-ink-100 p-1.5 hover:bg-ink-50', !isSameMonth(d, cursor) && 'bg-ink-50/60')}>
              <p className={clsx('num mb-1 flex h-6 w-6 items-center justify-center rounded-full text-xs', isToday(d) ? 'bg-brand-500 font-semibold text-white' : isSameMonth(d, cursor) ? 'text-ink-800' : 'text-ink-400')}>{format(d, 'd')}</p>
              <div className="space-y-0.5">
                {evs.slice(0, 3).map((m) => (
                  <button
                    key={m.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpen(m.id);
                    }}
                    className="flex w-full items-center gap-1 truncate rounded px-1 text-left text-2xs hover:bg-brand-50"
                  >
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />
                    <span className="num text-ink-500">{fmtTime(m.startsAt)}</span>
                    <span className="truncate text-ink-800">{m.title}</span>
                  </button>
                ))}
                {evs.length > 3 && <p className="px-1 text-2xs text-ink-500">+{evs.length - 3} reuniões</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MiniCalendar({ value, onChange, marks }: { value: Date; onChange: (d: Date) => void; marks: Set<string> }) {
  const [month, setMonth] = useState(startOfMonth(value));
  useEffect(() => setMonth(startOfMonth(value)), [value]);
  const start = startOfWeek(month, { weekStartsOn: 1 });
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-semibold capitalize">{format(month, 'MMMM yyyy', { locale: ptBR })}</p>
        <div className="flex">
          <Button variant="ghost" size="icon-sm" onClick={() => setMonth(addMonths(month, -1))} aria-label="Mês anterior">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => setMonth(addMonths(month, 1))} aria-label="Próximo mês">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-7 text-center text-2xs text-ink-400">
        {['S', 'T', 'Q', 'Q', 'S', 'S', 'D'].map((d, i) => (
          <span key={i} className="py-1">
            {d}
          </span>
        ))}
        {days.map((d) => (
          <button
            key={d.toISOString()}
            onClick={() => onChange(d)}
            className={clsx(
              'num relative mx-auto flex h-7 w-7 items-center justify-center rounded-full text-xs',
              isSameDay(d, value) ? 'bg-ink-900 font-semibold text-white' : isToday(d) ? 'font-semibold text-brand-600' : isSameMonth(d, month) ? 'text-ink-700 hover:bg-ink-100' : 'text-ink-300',
            )}
          >
            {format(d, 'd')}
            {marks.has(format(d, 'yyyy-MM-dd')) && !isSameDay(d, value) && <span className="absolute bottom-0.5 h-1 w-1 rounded-full bg-brand-500" />}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function Agenda() {
  const me = useMe();
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<View>('week');
  const [cursor, setCursor] = useState(() => startOfDay(new Date()));
  const [creating, setCreating] = useState<Date | null>(null);

  const range = useMemo(() => {
    if (view === 'day') return { from: cursor, to: addDays(cursor, 1) };
    if (view === 'week') {
      const s = startOfWeek(cursor, { weekStartsOn: 1 });
      return { from: s, to: addDays(s, 7) };
    }
    return { from: startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 }), to: addDays(endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 }), 1) };
  }, [view, cursor]);

  const { data: meetings = [] } = useQuery({
    queryKey: ['meetings', range.from.toISOString(), range.to.toISOString()],
    queryFn: () => api.get<Meeting[]>('/meetings', { from: range.from.toISOString(), to: range.to.toISOString() }),
  });
  const { data: upcoming = [] } = useQuery({
    queryKey: ['meetings', 'upcoming'],
    queryFn: () => api.get<Meeting[]>('/meetings', { from: new Date().toISOString(), to: new Date(Date.now() + 14 * 86400000).toISOString() }),
  });
  const openId = params.get('meeting');
  const opened = [...meetings, ...upcoming].find((m) => m.id === openId);
  const { data: fetched } = useQuery({
    queryKey: ['meetings', 'one', openId],
    enabled: Boolean(openId) && !opened,
    queryFn: async () => (await api.get<Meeting[]>('/meetings', { from: new Date(Date.now() - 90 * 86400000).toISOString(), to: new Date(Date.now() + 180 * 86400000).toISOString() })).find((m) => m.id === openId) ?? null,
  });
  const detail = opened ?? fetched ?? null;

  const step = (dir: 1 | -1) => setCursor((c) => (view === 'day' ? addDays(c, dir) : view === 'week' ? addDays(c, 7 * dir) : addMonths(c, dir)));
  const title =
    view === 'day'
      ? format(cursor, "EEEE, d 'de' MMMM", { locale: ptBR })
      : view === 'week'
        ? `${format(range.from, "d 'de' MMM", { locale: ptBR })} – ${format(addDays(range.to, -1), "d 'de' MMM yyyy", { locale: ptBR })}`
        : format(cursor, 'MMMM yyyy', { locale: ptBR });
  const days = view === 'day' ? [cursor] : Array.from({ length: 7 }, (_, i) => addDays(range.from, i));
  const marks = new Set([...meetings, ...upcoming].map((m) => format(new Date(m.startsAt), 'yyyy-MM-dd')));
  const newAtNextSlot = () => {
    const d = new Date(Math.ceil(Date.now() / 1800000) * 1800000);
    setCreating(d);
  };

  return (
    <div className="flex h-[calc(100vh-56px-48px)] gap-5">
      <aside className="hidden w-[248px] shrink-0 flex-col gap-5 xl:flex">
        <Button icon={<Plus className="h-4 w-4" />} onClick={newAtNextSlot} className="w-full">
          Nova reunião
        </Button>
        <MiniCalendar
          value={cursor}
          marks={marks}
          onChange={(d) => {
            setCursor(startOfDay(d));
            if (view === 'month') setView('week');
          }}
        />
        <div className="min-h-0 flex-1">
          <p className="mb-2 text-[13px] font-medium text-ink-500">Próximas</p>
          <div className="scroll-thin max-h-full space-y-1 overflow-y-auto">
            {upcoming.slice(0, 8).map((m) => (
              <button key={m.id} onClick={() => setParams({ meeting: m.id })} className="block w-full rounded-lg px-2 py-1.5 text-left hover:bg-white">
                <p className="truncate text-sm font-medium">{m.title}</p>
                <p className="num text-xs capitalize text-ink-500">
                  {format(new Date(m.startsAt), "EEE d/MM 'às' HH:mm", { locale: ptBR })}
                </p>
              </button>
            ))}
            {!upcoming.length && <p className="px-2 text-sm text-ink-400">Nada nos próximos 14 dias.</p>}
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => setCursor(startOfDay(new Date()))}>
            Hoje
          </Button>
          <div className="flex">
            <Button variant="ghost" size="icon-sm" onClick={() => step(-1)} aria-label="Anterior">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={() => step(1)} aria-label="Próximo">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <h1 className="text-lg font-semibold capitalize">{title}</h1>
          <div className="ml-auto flex items-center gap-2">
            <Tabs
              size="sm"
              value={view}
              onChange={setView}
              items={[
                { value: 'day', label: 'Dia' },
                { value: 'week', label: 'Semana' },
                { value: 'month', label: 'Mês' },
              ]}
            />
            <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={newAtNextSlot} className="xl:hidden">
              Nova
            </Button>
          </div>
        </div>
        {view === 'month' ? (
          <MonthGrid
            cursor={cursor}
            meetings={meetings}
            onOpen={(id) => setParams({ meeting: id })}
            onDay={(d) => {
              setCursor(startOfDay(d));
              setView('day');
            }}
          />
        ) : (
          <TimeGrid key={view + range.from.toISOString()} days={days} meetings={meetings} meId={me.id} onSlot={setCreating} onOpen={(id) => setParams({ meeting: id })} />
        )}
      </div>

      {creating && <MeetingModal start={creating} onClose={() => setCreating(null)} />}
      {detail && <MeetingDetail m={detail} onClose={() => setParams({})} />}
    </div>
  );
}
