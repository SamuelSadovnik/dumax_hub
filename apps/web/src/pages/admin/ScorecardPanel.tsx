import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { toast } from 'sonner';
import { ChevronDown, ClipboardCheck } from 'lucide-react';
import { DEFAULT_SCORECARD_CRITERIA, RATING_LABEL, RECOMMENDATIONS, RECOMMENDATION_COLOR, RECOMMENDATION_LABEL, type Recommendation } from '@dumax/shared';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { ApplicationDetail, Scorecard } from '@/lib/types';
import { fromNow } from '@/lib/format';
import { Avatar, Button, Input, Modal, Panel, Textarea } from '@/components/ui';

const avg = (s: Scorecard) => s.ratings.reduce((t, r) => t + r.rating, 0) / Math.max(1, s.ratings.length);

/** Quatro quadradinhos de 1 a 4 (só leitura) */
function Pips({ value }: { value: number }) {
  return (
    <span className="inline-flex gap-0.5" aria-label={`${value} de 4`}>
      {[1, 2, 3, 4].map((n) => (
        <span key={n} className={clsx('h-2 w-4 rounded-sm', n <= value ? 'bg-brand-500' : 'bg-ink-200')} />
      ))}
    </span>
  );
}

function RecBadge({ value }: { value: Recommendation }) {
  const c = RECOMMENDATION_COLOR[value];
  return (
    <span className="inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-semibold" style={{ color: c, background: `${c}14` }}>
      {RECOMMENDATION_LABEL[value]}
    </span>
  );
}

function ScorecardForm({ a, mine, onClose }: { a: ApplicationDetail; mine: Scorecard | undefined; onClose: () => void }) {
  const qc = useQueryClient();
  const criteria = a.job.scorecardCriteria?.length ? a.job.scorecardCriteria : DEFAULT_SCORECARD_CRITERIA;
  const [ratings, setRatings] = useState<Record<string, { rating: number; note: string }>>(() =>
    Object.fromEntries(criteria.map((c) => {
      const r = mine?.ratings.find((x) => x.name === c);
      return [c, { rating: r?.rating ?? 0, note: r?.note ?? '' }];
    })),
  );
  const [rec, setRec] = useState<Recommendation | null>(mine?.recommendation ?? null);
  const [summary, setSummary] = useState(mine?.summary ?? '');
  const missing = criteria.filter((c) => !ratings[c]?.rating);

  const save = useMutation({
    mutationFn: () =>
      api.post(`/applications/${a.id}/scorecard`, {
        ratings: criteria.map((c) => ({ name: c, rating: ratings[c].rating, ...(ratings[c].note.trim() ? { note: ratings[c].note.trim() } : {}) })),
        recommendation: rec,
        ...(summary.trim() ? { summary: summary.trim() } : {}),
      }),
    onSuccess: () => {
      toast.success('Avaliação salva');
      qc.invalidateQueries({ queryKey: ['application', a.id] });
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={`Avaliar ${a.candidate.name.split(' ')[0]}`}
      footer={
        <>
          <span className="mr-auto text-xs text-ink-500">{missing.length ? `Falta avaliar ${missing.length} critério${missing.length > 1 ? 's' : ''}` : rec ? 'Pronto para salvar' : 'Falta a recomendação'}</span>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={save.isPending} disabled={missing.length > 0 || !rec} onClick={() => save.mutate()}>
            Salvar avaliação
          </Button>
        </>
      }
    >
      <p className="mb-4 text-sm text-ink-500">Avalie cada critério de 1 a 4. Os outros entrevistadores só veem a sua nota depois que você salvar, para ninguém ser influenciado.</p>
      <ul className="divide-y divide-ink-100 rounded-xl border border-ink-200">
        {criteria.map((c) => {
          const v = ratings[c];
          return (
            <li key={c} className="space-y-2 px-4 py-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className="min-w-0 flex-1 text-sm font-medium text-ink-900">{c}</span>
                <span className="inline-flex rounded-lg bg-ink-100 p-0.5" role="radiogroup" aria-label={c}>
                  {[1, 2, 3, 4].map((n) => (
                    <button
                      key={n}
                      type="button"
                      role="radio"
                      aria-checked={v.rating === n}
                      title={RATING_LABEL[n]}
                      onClick={() => setRatings((r) => ({ ...r, [c]: { ...r[c], rating: n } }))}
                      className={clsx('num h-7 w-9 rounded-md text-[13px] font-semibold transition', v.rating === n ? 'bg-white text-brand-700 shadow-sm ring-1 ring-ink-200' : 'text-ink-500 hover:text-ink-900')}
                    >
                      {n}
                    </button>
                  ))}
                </span>
                <span className="w-32 text-xs text-ink-500">{v.rating ? RATING_LABEL[v.rating] : 'Sem nota'}</span>
              </div>
              <Input value={v.note} placeholder="Observação (opcional)" className="h-8 text-xs" onChange={(e) => setRatings((r) => ({ ...r, [c]: { ...r[c], note: e.target.value } }))} />
            </li>
          );
        })}
      </ul>

      <p className="mb-2 mt-5 text-sm font-semibold text-ink-900">Você contrataria?</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {RECOMMENDATIONS.map((r) => {
          const on = rec === r;
          const c = RECOMMENDATION_COLOR[r];
          return (
            <button
              key={r}
              type="button"
              onClick={() => setRec(r)}
              className={clsx('rounded-xl border px-3 py-2.5 text-sm font-semibold transition', on ? 'shadow-sm' : 'border-ink-200 text-ink-600 hover:border-ink-300')}
              style={on ? { color: c, borderColor: c, background: `${c}10` } : undefined}
            >
              {RECOMMENDATION_LABEL[r]}
            </button>
          );
        })}
      </div>
      <Textarea className="mt-4" rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Resumo da entrevista: o que pesou na sua decisão?" />
    </Modal>
  );
}

/** Avaliações estruturadas de cada entrevistador, lado a lado */
export function ScorecardPanel({ a }: { a: ApplicationDetail }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const cards = a.scorecards ?? [];
  const mine = cards.find((s) => s.authorId === user?.id);
  // Só mostra as notas dos outros depois que eu avaliei (evita viés)
  const visible = mine ? cards : [];
  const hidden = mine ? 0 : cards.length;
  const counts = RECOMMENDATIONS.map((r) => ({ r, n: cards.filter((s) => s.recommendation === r).length })).filter((x) => x.n);

  return (
    <Panel
      title="Avaliação de entrevista"
      subtitle={cards.length ? `${cards.length} avaliaç${cards.length > 1 ? 'ões' : 'ão'}` : 'Mesmos critérios para todos os entrevistadores'}
      actions={
        <Button size="sm" variant={mine ? 'secondary' : 'primary'} icon={<ClipboardCheck className="h-3.5 w-3.5" />} onClick={() => setOpen(true)}>
          {mine ? 'Editar minha' : 'Avaliar'}
        </Button>
      }
    >
      {cards.length === 0 ? (
        <p className="px-5 py-4 text-sm text-ink-500">Ninguém avaliou ainda. Depois da entrevista, dê uma nota de 1 a 4 para cada critério e diga se contrataria.</p>
      ) : (
        <>
          {mine && counts.length > 0 && (
            <div className="flex flex-wrap gap-1.5 border-b border-ink-100 px-5 py-3">
              {counts.map(({ r, n }) => (
                <span key={r} className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold" style={{ color: RECOMMENDATION_COLOR[r], background: `${RECOMMENDATION_COLOR[r]}14` }}>
                  <span className="num">{n}</span> {RECOMMENDATION_LABEL[r]}
                </span>
              ))}
            </div>
          )}
          <ul className="divide-y divide-ink-100">
            {visible.map((s) => {
              const isOpen = expanded === s.id;
              return (
                <li key={s.id}>
                  <button className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-ink-50/60" onClick={() => setExpanded(isOpen ? null : s.id)} aria-expanded={isOpen}>
                    <Avatar user={s.author} size={30} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink-900">{s.author.id === user?.id ? 'Você' : s.author.name}</span>
                      <span className="block text-xs text-ink-500">
                        Média <span className="num font-medium text-ink-700">{avg(s).toFixed(1).replace('.', ',')}</span> · {fromNow(s.updatedAt)}
                      </span>
                    </span>
                    <RecBadge value={s.recommendation} />
                    <ChevronDown className={clsx('h-4 w-4 shrink-0 text-ink-400 transition', isOpen && 'rotate-180')} />
                  </button>
                  {isOpen && (
                    <div className="space-y-2 bg-ink-50/50 px-5 pb-4 pt-1">
                      {s.ratings.map((r) => (
                        <div key={r.name} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 text-sm">
                          <span className="truncate text-ink-700">{r.name}</span>
                          <Pips value={r.rating} />
                          {r.note && <span className="col-span-2 text-xs text-ink-500">{r.note}</span>}
                        </div>
                      ))}
                      {s.summary && <p className="whitespace-pre-wrap border-t border-ink-200 pt-2 text-sm text-ink-700">{s.summary}</p>}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {hidden > 0 && (
            <p className="px-5 py-3 text-sm text-ink-500">
              {hidden} avaliaç{hidden > 1 ? 'ões' : 'ão'} já feita{hidden > 1 ? 's' : ''}. Você vê as notas dos outros depois de registrar a sua.
            </p>
          )}
        </>
      )}
      {open && <ScorecardForm a={a} mine={mine} onClose={() => setOpen(false)} />}
    </Panel>
  );
}
