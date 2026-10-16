import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { toast } from 'sonner';
import { CheckCircle2, Lock } from 'lucide-react';
import { PULSE_SCALE } from '@dumax/shared';
import { api, errorMessage } from '@/lib/api';
import type { PulseSurvey } from '@/lib/types';
import { fmtDateTime, fmtDayKey } from '@/lib/format';
import { Button, Checkbox, EmptyState, PageHeader, PageLoader, Panel, Textarea } from '@/components/ui';

type MyResponse = { score: number; comment: string | null; anonymous?: boolean; createdAt: string };

export function PulseWidget({ survey, initial }: { survey: PulseSurvey; initial?: MyResponse | null }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(!initial);
  const [score, setScore] = useState<number | null>(initial?.score ?? null);
  const [comment, setComment] = useState(initial?.comment ?? '');
  const [anonymous, setAnonymous] = useState(initial?.anonymous ?? true);
  const send = useMutation({
    mutationFn: () => api.post(`/pulse/${survey.id}/respond`, { score, comment: comment || undefined, anonymous }),
    onSuccess: () => {
      toast.success(initial ? 'Resposta atualizada' : 'Resposta enviada. Obrigado!');
      setEditing(false);
      qc.invalidateQueries({ queryKey: ['pulse-current'] });
      qc.invalidateQueries({ queryKey: ['pulse-mine'] });
      qc.invalidateQueries({ queryKey: ['inbox'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div className="card">
      <div className="border-b border-ink-100 px-5 py-4">
        <p className="text-xs text-ink-500">
          Semana de {fmtDayKey(survey.weekStart, "dd 'de' MMMM")} · aberto até {fmtDateTime(survey.closesAt)}
        </p>
        <h2 className="mt-1 text-lg font-semibold">{survey.question}</h2>
      </div>

      {initial && !editing ? (
        <div className="flex flex-wrap items-center gap-4 px-5 py-4">
          <CheckCircle2 className="h-5 w-5 text-ok" />
          <div className="flex-1 text-sm">
            <p>
              Você respondeu <span className="font-medium">{PULSE_SCALE[initial.score - 1].label.toLowerCase()}</span> ({initial.score}/5) em {fmtDateTime(initial.createdAt)}.
            </p>
            {initial.comment && <p className="mt-0.5 text-ink-500">“{initial.comment}”</p>}
          </div>
          <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
            Mudar resposta
          </Button>
        </div>
      ) : (
        <div className="space-y-4 p-5">
          <div className="grid grid-cols-5 gap-2">
            {PULSE_SCALE.map((s) => (
              <button
                key={s.score}
                onClick={() => setScore(s.score)}
                className={clsx(
                  'flex flex-col items-center gap-1 rounded-lg border py-3 transition-colors',
                  score === s.score ? 'border-brand-500 bg-brand-50 text-brand-800' : 'border-ink-200 hover:border-ink-300 hover:bg-ink-50',
                )}
              >
                <span className="text-2xl">{s.emoji}</span>
                <span className="num text-sm font-semibold">{s.score}</span>
                <span className="hidden text-2xs text-ink-500 sm:block">{s.label}</span>
              </button>
            ))}
          </div>
          {score && (
            <>
              <Textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Quer contar o porquê? (opcional)" rows={2} />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Checkbox
                  checked={anonymous}
                  onChange={setAnonymous}
                  label={
                    <span className="flex items-center gap-1.5">
                      <Lock className="h-3.5 w-3.5" /> Comentário anônimo
                    </span>
                  }
                />
                <div className="flex gap-2">
                  {initial && (
                    <Button variant="ghost" onClick={() => setEditing(false)}>
                      Cancelar
                    </Button>
                  )}
                  <Button loading={send.isPending} onClick={() => send.mutate()}>
                    {initial ? 'Salvar nova resposta' : 'Enviar resposta'}
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function Pulse() {
  const current = useQuery({
    queryKey: ['pulse-current'],
    queryFn: () => api.get<{ survey: PulseSurvey | null; myResponse: MyResponse | null }>('/pulse/current'),
  });
  const mine = useQuery({
    queryKey: ['pulse-mine'],
    queryFn: () => api.get<{ id: string; score: number; comment: string | null; createdAt: string; survey: { weekStart: string } }[]>('/pulse/mine'),
  });

  if (current.isLoading) return <PageLoader />;
  const history = [...(mine.data ?? [])].reverse();
  const avg = history.length ? history.reduce((a, r) => a + r.score, 0) / history.length : null;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader title="Pulse semanal" subtitle="Toda sexta uma pergunta rápida, de 1 a 5. O RH vê médias por área; quem respondeu o quê fica protegido." />
      {current.data?.survey ? (
        <PulseWidget key={current.data.survey.id} survey={current.data.survey} initial={current.data.myResponse} />
      ) : (
        <div className="card">
          <EmptyState title="Nenhum pulse aberto agora" text="O próximo abre na sexta-feira e você recebe um aviso." />
        </div>
      )}

      <Panel title="Meu histórico" subtitle={avg ? `Média ${avg.toFixed(1)} em ${history.length} semanas · só você vê` : 'Só você vê'}>
        {history.length ? (
          <div className="flex items-end gap-1.5 overflow-x-auto px-5 pb-4 pt-6">
            {history.map((r) => (
              <div key={r.id} className="flex w-9 shrink-0 flex-col items-center gap-1" title={`${PULSE_SCALE[r.score - 1].label}${r.comment ? ` · ${r.comment}` : ''}`}>
                <span className="num text-2xs text-ink-500">{r.score}</span>
                <div className={clsx('w-5 rounded-t', r.score >= 4 ? 'bg-ok' : r.score === 3 ? 'bg-ink-300' : 'bg-bad')} style={{ height: r.score * 14 }} />
                <span className="num text-2xs text-ink-400">{fmtDayKey(r.survey.weekStart, 'dd/MM')}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="px-5 py-4 text-sm text-ink-500">Você ainda não respondeu nenhum pulse.</p>
        )}
      </Panel>
    </div>
  );
}
