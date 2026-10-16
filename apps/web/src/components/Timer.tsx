import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { toast } from 'sonner';
import { Pause, Play } from 'lucide-react';
import { formatMinutes, type TimeLogActivity } from '@dumax/shared';
import { api, errorMessage } from '@/lib/api';
import type { TimeLog } from '@/lib/types';

/** Cronômetro global do usuário (um por vez) */
export function useTimer() {
  const qc = useQueryClient();
  const { data: running } = useQuery({ queryKey: ['timer'], queryFn: () => api.get<TimeLog | null>('/timelogs/running'), refetchInterval: 60_000 });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['timer'] });
    qc.invalidateQueries({ queryKey: ['timelogs'] });
    qc.invalidateQueries({ queryKey: ['inbox'] });
    qc.invalidateQueries({ queryKey: ['tasks'] });
  };
  const start = useMutation({
    mutationFn: (b: { taskId?: string | null; activity?: TimeLogActivity; description?: string }) => api.post<TimeLog>('/timelogs/start', b),
    onSuccess: refresh,
    onError: (e) => toast.error(errorMessage(e)),
  });
  const stop = useMutation({
    mutationFn: () => api.post<TimeLog | { stopped: false }>('/timelogs/stop'),
    onSuccess: (r) => {
      if ('minutes' in r) toast.success(`${formatMinutes(r.minutes)} registradas${r.task ? ` em "${r.task.title}"` : ''}`);
      refresh();
    },
  });
  return { running: running ?? null, start, stop };
}

export function useElapsed(since: string | null | undefined) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!since) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [since]);
  if (!since) return '00:00';
  const s = Math.max(0, Math.floor((now - new Date(since).getTime()) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

/** Botão play/pause para uma demanda */
export function TaskTimerButton({ taskId, compact }: { taskId: string; compact?: boolean }) {
  const { running, start, stop } = useTimer();
  const active = running?.taskId === taskId;
  const elapsed = useElapsed(active ? running?.startedAt : null);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        if (active) stop.mutate();
        else start.mutate({ taskId });
      }}
      onPointerDown={(e) => e.stopPropagation()}
      title={active ? 'Parar cronômetro' : 'Iniciar cronômetro nesta demanda'}
      className={clsx(
        'inline-flex items-center gap-1 rounded-md font-medium transition',
        compact ? 'h-6 px-1.5 text-2xs' : 'h-8 px-2.5 text-[13px]',
        active ? 'bg-brand-500 text-white hover:bg-brand-600' : 'text-ink-500 hover:bg-ink-100 hover:text-ink-800',
      )}
    >
      {active ? <Pause className={compact ? 'h-3 w-3' : 'h-3.5 w-3.5'} /> : <Play className={compact ? 'h-3 w-3' : 'h-3.5 w-3.5'} />}
      {active ? <span className="num">{elapsed}</span> : !compact && 'Iniciar'}
    </button>
  );
}
