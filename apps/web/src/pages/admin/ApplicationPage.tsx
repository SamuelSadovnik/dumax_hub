import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { toast } from 'sonner';
import { ArrowLeft, Check, Copy, FileText, Linkedin, Mail, MapPin, MessageCircle, Phone, Send, Sparkles, X } from 'lucide-react';
import { Legend, PolarAngleAxis, PolarGrid, Radar, RadarChart, ResponsiveContainer } from 'recharts';
import { PROFILES, PROFILE_KEYS, STAGES, STAGE_COLOR, STAGE_LABEL, screeningAnswerText, screeningRule, type Stage } from '@dumax/shared';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { AiReading, ApplicationDetail, FitAnalysis } from '@/lib/types';
import { fmtDateTime, fromNow } from '@/lib/format';
import { Avatar, Badge, Button, Checkbox, Field, Input, Modal, PageLoader, Panel, ScoreRing, Select, Stars, Tabs, Textarea } from '@/components/ui';
import { SOURCE_LABEL } from './Jobs';
import { ScorecardPanel } from './ScorecardPanel';

const TEMPLATES = [
  { label: 'Convite para entrevista', text: 'Olá, {nome}! Tudo bem? Gostamos muito do seu perfil para a vaga de {vaga}. Podemos agendar uma entrevista? Quais horários você tem disponíveis esta semana?' },
  { label: 'Pedido de informações', text: 'Olá, {nome}! Para seguirmos com o processo da vaga de {vaga}, você poderia nos enviar sua pretensão salarial e disponibilidade de início?' },
  { label: 'Retorno negativo', text: 'Olá, {nome}. Agradecemos muito pelo seu interesse na vaga de {vaga}. Neste momento seguiremos com outros perfis, mas manteremos seu currículo em nosso banco de talentos. Sucesso!' },
];

const EVENT_DOT: Record<string, string> = { STAGE_CHANGED: 'bg-brand-500', ASSESSMENT_COMPLETED: 'bg-ok', CONTACTED: 'bg-warn', NOTE: 'bg-ink-400' };

function FitPanel({ a, analysis }: { a: ApplicationDetail; analysis: FitAnalysis }) {
  const scores = a.assessments.find((x) => x.status === 'COMPLETED' && x.result)!.result!.scores;
  const radar = PROFILE_KEYS.map((k) => ({
    profile: PROFILES[k].label,
    candidato: scores[k],
    ...(analysis.ideal ? { ideal: analysis.ideal[k] } : {}),
    ...(analysis.team?.avg ? { time: analysis.team.avg[k] } : {}),
  }));

  return (
    <Panel title="Aderência à vaga" subtitle="Perfil comportamental do candidato comparado ao perfil ideal e ao time da área">
      <div className="grid gap-6 p-5 md:grid-cols-[220px_1fr]">
        <div className="space-y-5">
          {analysis.fit !== null && analysis.label ? (
            <div className="flex items-center gap-3">
              <ScoreRing score={analysis.fit} size={64} color={analysis.label.color} />
              <div>
                <p className="font-semibold" style={{ color: analysis.label.color }}>
                  {analysis.label.label}
                </p>
                <p className="text-xs text-ink-500">com o perfil ideal</p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-ink-500">A vaga não tem perfil ideal definido. Defina na edição da vaga para calcular a aderência.</p>
          )}
          {analysis.team?.fitWithTeam != null && (
            <div>
              <p className="num text-xl font-semibold">{analysis.team.fitWithTeam}%</p>
              <p className="text-xs text-ink-500">
                parecido com o time de {a.job.department?.name ?? 'área'} ({analysis.team.size} pessoas com teste)
              </p>
              {analysis.team.complement.length > 0 && (
                <p className="mt-2 text-xs text-ink-700">Traz mais {analysis.team.complement.map((k) => PROFILES[k].label).join(' e ')} do que o time tem hoje.</p>
              )}
            </div>
          )}
        </div>
        <div className="h-64">
          <ResponsiveContainer>
            <RadarChart data={radar} outerRadius="72%">
              <PolarGrid stroke="#E3E7EF" />
              <PolarAngleAxis dataKey="profile" tick={{ fontSize: 12, fill: '#3B4366' }} />
              {analysis.team?.avg && <Radar name="Média do time" dataKey="time" stroke="#8A93AD" fill="#8A93AD" fillOpacity={0.08} strokeDasharray="4 3" />}
              {analysis.ideal && <Radar name="Ideal da vaga" dataKey="ideal" stroke="#1F9254" fill="#1F9254" fillOpacity={0.08} />}
              <Radar name="Candidato" dataKey="candidato" stroke="#2D3FE0" fill="#2D3FE0" fillOpacity={0.25} />
              <Legend iconSize={8} wrapperStyle={{ fontSize: 12 }} />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {analysis.gaps.length > 0 && (
        <table className="tbl border-t border-ink-100">
          <thead>
            <tr>
              <th>Perfil</th>
              <th className="text-right">Candidato</th>
              <th className="text-right">Ideal</th>
              <th className="w-[40%]">Diferença</th>
            </tr>
          </thead>
          <tbody>
            {PROFILE_KEYS.map((k) => {
              const g = analysis.gaps.find((x) => x.profile === k)!;
              const big = Math.abs(g.diff) >= 15;
              return (
                <tr key={k}>
                  <td>
                    <span className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full" style={{ background: PROFILES[k].color }} />
                      {PROFILES[k].label}
                    </span>
                  </td>
                  <td className="num text-right">{g.candidate}%</td>
                  <td className="num text-right text-ink-500">{g.ideal}%</td>
                  <td>
                    <div className="flex items-center gap-2">
                      <div className="relative h-1.5 flex-1 rounded-full bg-ink-100">
                        <span className="absolute left-1/2 top-[-3px] h-3 w-px bg-ink-300" />
                        <span
                          className={clsx('absolute top-0 h-1.5 rounded-full', g.diff < 0 ? 'bg-warn' : 'bg-brand-400')}
                          style={g.diff < 0 ? { right: '50%', width: `${Math.min(50, -g.diff)}%` } : { left: '50%', width: `${Math.min(50, g.diff)}%` }}
                        />
                      </div>
                      <span className={clsx('num w-10 text-right text-xs', big ? (g.diff < 0 ? 'font-semibold text-warn' : 'font-semibold text-brand-600') : 'text-ink-500')}>
                        {g.diff > 0 ? '+' : ''}
                        {g.diff}
                      </span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {analysis.probes.length > 0 && (
        <div className="border-t border-ink-100 px-5 py-4">
          <p className="mb-2 text-sm font-medium">Perguntas para a entrevista</p>
          <p className="mb-3 text-xs text-ink-500">Onde o candidato ficou abaixo do ideal. Investigue com exemplos reais antes de decidir.</p>
          <ol className="space-y-2 text-sm">
            {analysis.probes.map((p, i) => (
              <li key={i} className="flex gap-2.5">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: PROFILES[p.profile].color }} />
                <span>
                  {p.question} <span className="text-xs text-ink-400">({PROFILES[p.profile].label})</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
      <p className="border-t border-ink-100 px-5 py-2.5 text-2xs text-ink-400">O perfil é apoio para a conversa, não critério único de decisão.</p>
    </Panel>
  );
}

/** Leitura automática do teste feita pela IA logo que o candidato conclui */
function AiReadingPanel({ ai }: { ai: AiReading }) {
  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-brand-500" /> Leitura do assistente
        </span>
      }
      subtitle={`Gerada automaticamente ${fromNow(ai.generatedAt)}`}
    >
      <div className="space-y-4 px-5 py-4 text-sm">
        <p className="leading-relaxed text-ink-700">{ai.summary}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="mb-1.5 text-xs font-medium text-ink-500">Pontos fortes</p>
            <ul className="space-y-1">
              {ai.strengths.map((s) => (
                <li key={s} className="flex gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" /> {s}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="mb-1.5 text-xs font-medium text-ink-500">Pontos de atenção</p>
            <ul className="space-y-1">
              {ai.risks.map((s) => (
                <li key={s} className="flex gap-2">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-warn" /> {s}
                </li>
              ))}
            </ul>
          </div>
        </div>
        {ai.questions.length > 0 && (
          <div>
            <p className="mb-1.5 text-xs font-medium text-ink-500">Perguntas sugeridas para a entrevista</p>
            <ol className="list-decimal space-y-1 pl-5">
              {ai.questions.map((q) => (
                <li key={q}>{q}</li>
              ))}
            </ol>
          </div>
        )}
      </div>
      <p className="border-t border-ink-100 px-5 py-2.5 text-2xs text-ink-400">Texto gerado por IA a partir do teste. Use como apoio, nunca como decisão.</p>
    </Panel>
  );
}

export default function ApplicationPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const { isHR } = useAuth();
  const { data: a, isLoading } = useQuery({ queryKey: ['application', id], queryFn: () => api.get<ApplicationDetail>(`/applications/${id}`) });
  const [note, setNote] = useState('');
  const [contact, setContact] = useState<{ channel: 'EMAIL' | 'WHATSAPP'; subject: string; message: string } | null>(null);
  const [decision, setDecision] = useState<'HIRED' | 'REJECTED' | null>(null);
  const [reason, setReason] = useState('');
  const [notify, setNotify] = useState(true);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['application', id] });
    qc.invalidateQueries({ queryKey: ['pipeline'] });
    qc.invalidateQueries({ queryKey: ['jobs'] });
  };

  const stage = useMutation({
    mutationFn: (v: { stage: Stage; note?: string; rejectionReason?: string; notifyCandidate?: boolean }) => api.patch(`/applications/${id}/stage`, v),
    onSuccess: refresh,
    onError: (e) => toast.error(errorMessage(e)),
  });
  const rate = useMutation({ mutationFn: (r: number) => api.patch(`/applications/${id}/rating`, { rating: r }), onSuccess: refresh });
  const addNote = useMutation({
    mutationFn: () => api.post(`/applications/${id}/notes`, { body: note }),
    onSuccess: () => {
      setNote('');
      refresh();
    },
  });
  const sendTest = useMutation({
    mutationFn: () => api.post<{ url: string; whatsapp: string }>(`/applications/${id}/assessment`),
    onSuccess: async (r) => {
      await navigator.clipboard?.writeText(r.url).catch(() => undefined);
      toast.success('Teste enviado por e-mail e link copiado', { action: { label: 'Mandar no WhatsApp', onClick: () => window.open(r.whatsapp, '_blank') } });
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const sendContact = useMutation({
    mutationFn: () => api.post<{ whatsappUrl?: string }>(`/applications/${id}/contact`, contact),
    onSuccess: (r) => {
      if (r.whatsappUrl) window.open(r.whatsappUrl, '_blank');
      else toast.success('E-mail enviado');
      setContact(null);
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (isLoading || !a) return <PageLoader />;
  const done = a.assessments.find((x) => x.status === 'COMPLETED' && x.result);
  const pendingTest = a.assessments.find((x) => x.status === 'PENDING');
  const fill = (t: string) => t.replace('{nome}', a.candidate.name.split(' ')[0]).replace('{vaga}', a.job.title);
  const closed = a.stage === 'HIRED' || a.stage === 'REJECTED';

  return (
    <div className="space-y-5">
      <Link to={`/admin/recrutamento/vagas/${a.job.id}`} className="inline-flex items-center gap-1 text-[13px] text-ink-500 hover:text-ink-900">
        <ArrowLeft className="h-4 w-4" /> {a.job.title}
      </Link>

      <div className="card flex flex-wrap items-start gap-4 p-5">
        <Avatar user={{ id: a.candidate.id, name: a.candidate.name, avatarUrl: null }} size={52} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold">{a.candidate.name}</h1>
            <Badge color={STAGE_COLOR[a.stage]} dot>
              {STAGE_LABEL[a.stage]}
            </Badge>
            {a.analysis?.fit != null && a.analysis.label && (
              <span className="num rounded px-1.5 py-0.5 text-xs font-semibold" style={{ color: a.analysis.label.color, background: `${a.analysis.label.color}14` }}>
                {a.analysis.fit}% de aderência
              </span>
            )}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-ink-600">
            <span className="flex items-center gap-1">
              <Mail className="h-3.5 w-3.5" /> {a.candidate.email}
            </span>
            <span className="flex items-center gap-1">
              <Phone className="h-3.5 w-3.5" /> {a.candidate.phone}
            </span>
            {a.candidate.city && (
              <span className="flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" /> {a.candidate.city}
              </span>
            )}
            {a.candidate.linkedinUrl && (
              <a href={a.candidate.linkedinUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-brand-600">
                <Linkedin className="h-3.5 w-3.5" /> LinkedIn
              </a>
            )}
          </div>
          <div className="mt-2 flex items-center gap-3">
            <Stars value={a.rating} onChange={isHR ? (r) => rate.mutate(r) : undefined} size={16} />
            <span className="text-xs text-ink-500">
              Candidatou-se {fromNow(a.createdAt)} via {SOURCE_LABEL[a.source ?? 'site'] ?? a.source}
            </span>
            {a.referredBy && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 py-0.5 pl-0.5 pr-2.5 text-xs font-medium text-brand-700">
                <Avatar user={a.referredBy} size={18} /> Indicado por {a.referredBy.name.split(' ')[0]}
              </span>
            )}
          </div>
        </div>
        {isHR && (
          <div className="flex flex-wrap gap-2">
            {a.resumePath && (
              <Button variant="secondary" icon={<FileText className="h-4 w-4" />} onClick={() => api.openFile(`/applications/${a.id}/resume`).catch((e) => toast.error(errorMessage(e)))}>
                Currículo
              </Button>
            )}
            <Button variant="secondary" icon={<MessageCircle className="h-4 w-4" />} onClick={() => setContact({ channel: 'WHATSAPP', subject: '', message: '' })}>
              Entrar em contato
            </Button>
            {!closed && (
              <>
                <Button variant="secondary" icon={<X className="h-4 w-4" />} className="text-bad" onClick={() => setDecision('REJECTED')}>
                  Reprovar
                </Button>
                <Button icon={<Check className="h-4 w-4" />} onClick={() => setDecision('HIRED')}>
                  Aprovar
                </Button>
              </>
            )}
          </div>
        )}
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          {['SCREENING', 'INTERVIEW', 'OFFER', 'HIRED'].includes(a.stage) || a.scorecards?.length ? <ScorecardPanel a={a} /> : null}
          {done?.result?.ai && <AiReadingPanel ai={done.result.ai} />}
          {done?.result && a.analysis ? (
            <FitPanel a={a} analysis={a.analysis} />
          ) : (
            <Panel title="Teste de perfil">
              <div className="flex flex-wrap items-center gap-3 px-5 py-4 text-sm">
                <span className="flex-1 text-ink-600">
                  {pendingTest
                    ? `Enviado ${fromNow(pendingTest.createdAt)}. ${pendingTest.startedAt ? 'O candidato abriu o link e ainda não terminou.' : 'Ainda não foi aberto.'}`
                    : 'O candidato ainda não fez o teste. Com o resultado, mostramos a aderência à vaga e perguntas para a entrevista.'}
                </span>
                {pendingTest && (
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<Copy className="h-3.5 w-3.5" />}
                    onClick={async () => {
                      await navigator.clipboard.writeText(pendingTest.url);
                      toast.success('Link copiado');
                    }}
                  >
                    Copiar link
                  </Button>
                )}
                {isHR && (
                  <Button size="sm" icon={<Sparkles className="h-3.5 w-3.5" />} loading={sendTest.isPending} onClick={() => sendTest.mutate()}>
                    {pendingTest ? 'Reenviar' : 'Enviar teste'}
                  </Button>
                )}
              </div>
            </Panel>
          )}

          {done?.result && (
            <Panel title={`Perfil predominante: ${PROFILES[done.result.primary].label}`} subtitle={`Secundário: ${PROFILES[done.result.secondary].label}`}>
              <div className="grid gap-5 px-5 py-4 text-sm md:grid-cols-2">
                <p className="text-ink-700 md:col-span-2">{PROFILES[done.result.primary].description}</p>
                <div>
                  <p className="mb-1 text-xs text-ink-500">Pontos fortes</p>
                  <ul className="space-y-0.5">
                    {PROFILES[done.result.primary].strengths.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="mb-1 text-xs text-ink-500">Pontos de atenção</p>
                  <ul className="space-y-0.5">
                    {PROFILES[done.result.primary].watchOuts.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </Panel>
          )}

          {a.coverLetter && (
            <Panel title="Mensagem do candidato">
              <p className="whitespace-pre-wrap px-5 py-4 text-sm text-ink-700">{a.coverLetter}</p>
            </Panel>
          )}
        </div>

        <div className="space-y-5">
          {(a.screeningAnswers ?? []).length > 0 && (
            <Panel title="Perguntas da vaga" subtitle={(a.screeningAnswers ?? []).every((x) => x.passed) ? 'Atende a todas' : 'Não atende a alguma pergunta'}>
              <ul className="divide-y divide-ink-100">
                {(a.screeningAnswers ?? []).map((x) => (
                  <li key={x.id} className="flex items-start gap-2.5 px-4 py-2.5 text-sm">
                    {x.passed ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" /> : <X className={clsx('mt-0.5 h-4 w-4 shrink-0', x.mode === 'ELIMINATE' ? 'text-bad' : 'text-warn')} />}
                    <span className="min-w-0 flex-1">
                      {x.text}
                      <span className="block text-xs text-ink-500">
                        Respondeu <span className="font-medium text-ink-700">{screeningAnswerText(x, x.answer)}</span>
                        {!x.passed && ` · ${screeningRule(x).toLowerCase()}${x.mode === 'ELIMINATE' ? ' (eliminatória)' : ''}`}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          {isHR && (
            <Panel title="Etapa">
              <div className="space-y-3 p-4">
                <Select value={a.stage} onChange={(e) => stage.mutate({ stage: e.target.value as Stage })}>
                  {STAGES.map((s) => (
                    <option key={s} value={s}>
                      {STAGE_LABEL[s]}
                    </option>
                  ))}
                </Select>
                {a.rejectionReason && <p className="text-xs text-ink-500">Motivo da reprovação: {a.rejectionReason}</p>}
              </div>
            </Panel>
          )}

          <Panel title="Histórico">
            {isHR && (
              <div className="flex gap-2 border-b border-ink-100 p-3">
                <Input placeholder="Anotação interna" value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && note.trim() && addNote.mutate()} />
                <Button size="icon" disabled={!note.trim()} onClick={() => addNote.mutate()} aria-label="Salvar anotação">
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            )}
            <ol className="scroll-thin max-h-[520px] space-y-3 overflow-y-auto px-4 py-3">
              {a.events.map((e) => (
                <li key={e.id} className="flex gap-2.5 text-[13px]">
                  <span className={clsx('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', EVENT_DOT[e.type] ?? 'bg-ink-300')} />
                  <div className="min-w-0 flex-1">
                    {e.type === 'STAGE_CHANGED' && e.toStage ? (
                      <p>
                        Movido para <span className="font-medium">{STAGE_LABEL[e.toStage]}</span>
                        {e.body && !e.body.includes('→') && <span className="block text-ink-600">{e.body}</span>}
                      </p>
                    ) : (
                      <p className="whitespace-pre-line">{e.body}</p>
                    )}
                    <p className="text-2xs text-ink-400">
                      {e.author?.name ?? 'Sistema'} · {fmtDateTime(e.createdAt)}
                      {e.type === 'CONTACTED' && e.meta?.channel ? ` · ${e.meta.channel === 'EMAIL' ? 'e-mail' : 'WhatsApp'}` : ''}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </Panel>

          {a.candidate.applications.length > 1 && (
            <Panel title="Outras candidaturas">
              <ul className="divide-y divide-ink-100">
                {a.candidate.applications
                  .filter((x) => x.id !== a.id)
                  .map((x) => (
                    <li key={x.id}>
                      <Link to={`/admin/recrutamento/candidaturas/${x.id}`} className="flex items-center justify-between px-4 py-2.5 text-sm hover:bg-ink-50">
                        {x.job.title}
                        <Badge color={STAGE_COLOR[x.stage]}>{STAGE_LABEL[x.stage]}</Badge>
                      </Link>
                    </li>
                  ))}
              </ul>
            </Panel>
          )}
        </div>
      </div>

      <Modal
        open={Boolean(decision)}
        onClose={() => setDecision(null)}
        size="sm"
        title={decision === 'HIRED' ? `Aprovar ${a.candidate.name.split(' ')[0]}` : `Reprovar ${a.candidate.name.split(' ')[0]}`}
        footer={
          <Button
            variant={decision === 'REJECTED' ? 'danger' : 'primary'}
            loading={stage.isPending}
            onClick={() => {
              stage.mutate({ stage: decision!, note: reason || undefined, rejectionReason: decision === 'REJECTED' ? reason || undefined : undefined, notifyCandidate: notify });
              setDecision(null);
              setReason('');
            }}
          >
            {decision === 'HIRED' ? 'Aprovar e marcar como contratado' : 'Reprovar'}
          </Button>
        }
      >
        <div className="space-y-3">
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={decision === 'REJECTED' ? 'Motivo (fica só no histórico interno)' : 'Observação (opcional)'} />
          <Checkbox checked={notify} onChange={setNotify} label="Avisar o candidato por e-mail" />
        </div>
      </Modal>

      <Modal
        open={Boolean(contact)}
        onClose={() => setContact(null)}
        title="Entrar em contato"
        footer={
          <Button loading={sendContact.isPending} disabled={!contact?.message} icon={<Send className="h-4 w-4" />} onClick={() => sendContact.mutate()}>
            {contact?.channel === 'EMAIL' ? 'Enviar e-mail' : 'Abrir no WhatsApp'}
          </Button>
        }
      >
        {contact && (
          <div className="space-y-3">
            <Tabs
              size="sm"
              value={contact.channel}
              onChange={(c) => setContact({ ...contact, channel: c })}
              items={[
                { value: 'WHATSAPP', label: 'WhatsApp' },
                { value: 'EMAIL', label: 'E-mail' },
              ]}
            />
            <div className="flex flex-wrap gap-1">
              {TEMPLATES.map((t) => (
                <button key={t.label} onClick={() => setContact({ ...contact, message: fill(t.text) })} className="rounded-md border border-ink-200 px-2 py-1 text-xs hover:border-brand-300">
                  {t.label}
                </button>
              ))}
            </div>
            {contact.channel === 'EMAIL' && (
              <Field label="Assunto">
                <Input value={contact.subject} onChange={(e) => setContact({ ...contact, subject: e.target.value })} placeholder={`Sobre sua candidatura: ${a.job.title}`} />
              </Field>
            )}
            <Field label="Mensagem" hint="Fica registrada no histórico do candidato">
              <Textarea rows={6} value={contact.message} onChange={(e) => setContact({ ...contact, message: e.target.value })} />
            </Field>
          </div>
        )}
      </Modal>
    </div>
  );
}
