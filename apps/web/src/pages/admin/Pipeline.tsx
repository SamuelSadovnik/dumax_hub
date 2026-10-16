import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import clsx from 'clsx';
import { toast } from 'sonner';
import { AlertTriangle, ArrowLeft, Columns3, FileText, List, Pencil, Search } from 'lucide-react';
import { EMPLOYMENT_TYPE_LABEL, JOB_STATUS_LABEL, PROFILES, STAGES, STAGE_COLOR, STAGE_LABEL, WORK_MODE_LABEL, fitLabel, type Stage } from '@dumax/shared';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Job, PipelineCard } from '@/lib/types';
import { fromNow } from '@/lib/format';
import { Avatar, Badge, Button, Checkbox, Input, Modal, PageLoader, Select, Stars, Tabs, Textarea } from '@/components/ui';
import { JOB_STATUS_COLOR, JobFormModal, ProfileBar, SOURCE_LABEL, ShareJobMenu } from './Jobs';

export function FitBadge({ fit, className }: { fit: number | null; className?: string }) {
  if (fit === null) return null;
  const l = fitLabel(fit);
  return (
    <span title={l.label} className={clsx('num inline-flex items-center rounded px-1.5 py-0.5 text-2xs font-semibold', className)} style={{ color: l.color, background: `${l.color}14` }}>
      {fit}% fit
    </span>
  );
}

function CandidateCard({ a }: { a: PipelineCard }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: a.id });
  const profile = a.profile ? PROFILES[a.profile] : null;
  const misses = (a.screeningAnswers ?? []).filter((x) => !x.passed);
  // Tempo parado na etapa (como o "guide time" do Teamtailor)
  const idle = Math.floor((Date.now() - +new Date(a.stageUpdatedAt ?? a.createdAt)) / 86400000);
  const idleWarn = a.stage !== 'HIRED' && a.stage !== 'REJECTED' && idle >= 5;
  return (
    <div ref={setNodeRef} {...listeners} {...attributes} style={transform ? { transform: `translate(${transform.x}px,${transform.y}px)`, zIndex: 50 } : undefined}>
      <Link
        to={`/admin/recrutamento/candidaturas/${a.id}`}
        onClick={(e) => isDragging && e.preventDefault()}
        className={clsx('block rounded-xl border border-ink-200/80 bg-white px-3 py-2.5 shadow-card hover:border-brand-300', isDragging && 'opacity-80 shadow-pop')}
      >
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-[13px] font-medium">{a.candidate.name}</p>
          <FitBadge fit={a.fit} />
        </div>
        <div className="mt-1 flex items-center gap-1.5 text-2xs text-ink-500">
          {profile && (
            <span className="flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: profile.color }} />
              {profile.label}
            </span>
          )}
          {a.hasResume && <FileText className="h-3 w-3 text-ink-400" />}
          {a.rating ? <Stars value={a.rating} size={10} /> : null}
          {misses.length > 0 && (
            <span className={clsx('flex items-center gap-0.5 font-medium', misses.some((x) => x.mode === 'ELIMINATE') ? 'text-bad' : 'text-warn')} title={misses.map((x) => x.text).join(' · ')}>
              <AlertTriangle className="h-3 w-3" /> {misses.length}
            </span>
          )}
          {idleWarn ? (
            <span className={clsx('ml-auto rounded-full px-1.5 py-px font-medium', idle >= 10 ? 'bg-bad-soft text-bad' : 'bg-warn-soft text-warn')} title="Dias sem mudar de etapa">
              {idle}d parado
            </span>
          ) : (
            <span className="ml-auto">{fromNow(a.createdAt)}</span>
          )}
        </div>
      </Link>
    </div>
  );
}

function Column({ stage, items }: { stage: Stage; items: PipelineCard[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  return (
    <div ref={setNodeRef} className={clsx('flex min-h-0 min-w-[220px] flex-1 basis-0 flex-col rounded-2xl border border-transparent bg-ink-100/70', isOver && 'border-brand-300 bg-brand-50')}>
      <div className="flex items-center gap-2 px-3 py-2.5">
        <span className="h-2 w-2 rounded-full" style={{ background: STAGE_COLOR[stage] }} />
        <p className="text-[13px] font-medium">{STAGE_LABEL[stage]}</p>
        <span className="num ml-auto text-xs text-ink-500">{items.length}</span>
      </div>
      <div className="scroll-thin flex min-h-[80px] flex-1 flex-col gap-1.5 overflow-y-auto px-2 pb-2">
        {items.map((a) => (
          <CandidateCard key={a.id} a={a} />
        ))}
      </div>
    </div>
  );
}

type Sort = 'fit' | 'recent' | 'rating';

export default function Pipeline() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { isHR } = useAuth();
  const [view, setView] = useState<'board' | 'list'>('board');
  const [sort, setSort] = useState<Sort>('fit');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(false);
  const [showRejected, setShowRejected] = useState(false);
  const [pending, setPending] = useState<{ app: PipelineCard; stage: Stage } | null>(null);
  const [note, setNote] = useState('');
  const [notifyCandidate, setNotifyCandidate] = useState(true);
  const { data: job } = useQuery({ queryKey: ['job', id], queryFn: () => api.get<Job>(`/jobs/${id}`) });
  const { data: apps, isLoading } = useQuery({ queryKey: ['pipeline', id], queryFn: () => api.get<PipelineCard[]>(`/jobs/${id}/applications`) });

  const move = useMutation({
    mutationFn: (v: { appId: string; stage: Stage; note?: string; rejectionReason?: string; notifyCandidate: boolean }) =>
      api.patch(`/applications/${v.appId}/stage`, { stage: v.stage, note: v.note, rejectionReason: v.rejectionReason, notifyCandidate: v.notifyCandidate }),
    onMutate: async (v) => {
      qc.setQueryData<PipelineCard[]>(['pipeline', id], (old) => old?.map((a) => (a.id === v.appId ? { ...a, stage: v.stage } : a)));
    },
    onError: (e) => toast.error(errorMessage(e)),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['pipeline', id] });
      qc.invalidateQueries({ queryKey: ['jobs'] });
    },
  });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const requestMove = (app: PipelineCard, stage: Stage) => {
    if (app.stage === stage) return;
    // etapas finais pedem confirmação (e permitem avisar o candidato)
    if (['REJECTED', 'HIRED', 'OFFER', 'INTERVIEW'].includes(stage)) {
      setNote('');
      setNotifyCandidate(true);
      setPending({ app, stage });
    } else move.mutate({ appId: app.id, stage, notifyCandidate: false });
  };
  const onDragEnd = (e: DragEndEvent) => {
    const app = apps?.find((a) => a.id === e.active.id);
    if (e.over && app) requestMove(app, e.over.id as Stage);
  };

  if (isLoading || !apps) return <PageLoader />;
  const sorter = (a: PipelineCard, b: PipelineCard) =>
    sort === 'fit' ? (b.fit ?? -1) - (a.fit ?? -1) : sort === 'rating' ? (b.rating ?? 0) - (a.rating ?? 0) : +new Date(b.createdAt) - +new Date(a.createdAt);
  const filtered = apps.filter((a) => a.candidate.name.toLowerCase().includes(search.toLowerCase())).sort(sorter);
  const withFit = apps.filter((a) => a.fit !== null);
  const active = apps.filter((a) => a.stage !== 'REJECTED' && a.stage !== 'HIRED');
  const rejected = apps.filter((a) => a.stage === 'REJECTED').length;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div>
        <Link to="/admin/recrutamento" className="inline-flex items-center gap-1 text-[13px] text-ink-500 hover:text-ink-900">
          <ArrowLeft className="h-4 w-4" /> Vagas
        </Link>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-[28px] font-bold leading-tight">{job?.title ?? 'Vaga'}</h1>
            {job && (
              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-500">
                <Badge color={JOB_STATUS_COLOR[job.status]} dot>
                  {JOB_STATUS_LABEL[job.status]}
                </Badge>
                <span>{[job.department?.name, WORK_MODE_LABEL[job.workMode], EMPLOYMENT_TYPE_LABEL[job.employmentType]].filter(Boolean).join(' · ')}</span>
                <span className="text-ink-300">|</span>
                <span>
                  <strong className="num font-semibold text-ink-800">{active.length}</strong> em processo
                </span>
                <span>
                  <strong className="num font-semibold text-ink-800">{withFit.filter((a) => (a.fit ?? 0) >= 80).length}</strong> com alta aderência
                </span>
                {job.idealProfile ? (
                  <span className="flex items-center gap-2">
                    Perfil ideal <span className="w-24"><ProfileBar profile={job.idealProfile} /></span>
                  </span>
                ) : (
                  isHR && (
                    <button onClick={() => setEditing(true)} className="text-brand-600 hover:underline">
                      Definir perfil ideal
                    </button>
                  )
                )}
              </p>
            )}
          </div>
          {job && (
            <div className="flex gap-2">
              <ShareJobMenu job={job} size="md" />
              {isHR && (
                <Button variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(true)}>
                  Editar vaga
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Tabs
          size="sm"
          value={view}
          onChange={setView}
          items={[
            { value: 'board', label: <span className="flex items-center gap-1.5"><Columns3 className="h-3.5 w-3.5" />Etapas</span> },
            { value: 'list', label: <span className="flex items-center gap-1.5"><List className="h-3.5 w-3.5" />Ranking</span> },
          ]}
        />
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <Input className="h-8 w-56 pl-8" placeholder="Buscar candidato" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="h-8 w-48">
          <option value="fit">Maior aderência</option>
          <option value="recent">Mais recentes</option>
          <option value="rating">Melhor avaliação</option>
        </Select>
        {rejected > 0 && (
          <button
            onClick={() => setShowRejected((v) => !v)}
            className={clsx('ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium transition', showRejected ? 'bg-ink-900 text-white' : 'bg-ink-100 text-ink-600 hover:bg-ink-200')}
          >
            {showRejected ? 'Esconder descartados' : `Ver descartados (${rejected})`}
          </button>
        )}
      </div>

      {view === 'board' ? (
        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
          <div className="scroll-thin flex min-h-0 flex-1 gap-2.5 overflow-x-auto pb-1">
            {STAGES.filter((s) => s !== 'REJECTED' || showRejected).map((s) => (
              <Column key={s} stage={s} items={filtered.filter((a) => a.stage === s)} />
            ))}
          </div>
        </DndContext>
      ) : (
        <div className="card overflow-hidden">
          <table className="tbl">
            <thead>
              <tr>
                <th className="w-10">#</th>
                <th>Candidato</th>
                <th>Aderência</th>
                <th>Perfil</th>
                <th>Origem</th>
                <th>Etapa</th>
                <th className="text-right">Candidatou-se</th>
              </tr>
            </thead>
            <tbody>
              {filtered.filter((a) => showRejected || a.stage !== 'REJECTED').map((a, i) => (
                <tr key={a.id} className="cursor-pointer" onClick={() => navigate(`/admin/recrutamento/candidaturas/${a.id}`)}>
                  <td className="num text-ink-400">{i + 1}</td>
                  <td>
                    <span className="flex items-center gap-2.5">
                      <Avatar user={{ id: a.candidate.id, name: a.candidate.name, avatarUrl: null }} size={26} />
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{a.candidate.name}</span>
                        <span className="block truncate text-xs text-ink-500">{a.candidate.city ?? a.candidate.email}</span>
                      </span>
                    </span>
                  </td>
                  <td>{a.fit !== null ? <FitBadge fit={a.fit} /> : <span className="text-xs text-ink-400">{a.profile ? 'sem perfil ideal' : 'sem teste'}</span>}</td>
                  <td className="text-ink-600">{a.profile ? PROFILES[a.profile].label : '—'}</td>
                  <td className="text-ink-600">{SOURCE_LABEL[a.source ?? 'site'] ?? a.source}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <Select value={a.stage} onChange={(e) => requestMove(a, e.target.value as Stage)} className="h-7 w-36 text-xs">
                      {STAGES.map((s) => (
                        <option key={s} value={s}>
                          {STAGE_LABEL[s]}
                        </option>
                      ))}
                    </Select>
                  </td>
                  <td className="num text-right text-ink-500">{fromNow(a.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={Boolean(pending)}
        onClose={() => setPending(null)}
        size="sm"
        title={pending ? `Mover ${pending.app.candidate.name.split(' ')[0]} para ${STAGE_LABEL[pending.stage]}` : ''}
        footer={
          <Button
            variant={pending?.stage === 'REJECTED' ? 'danger' : 'primary'}
            onClick={() => {
              if (!pending) return;
              move.mutate({
                appId: pending.app.id,
                stage: pending.stage,
                note: note || undefined,
                rejectionReason: pending.stage === 'REJECTED' ? note || undefined : undefined,
                notifyCandidate,
              });
              setPending(null);
            }}
          >
            {pending?.stage === 'REJECTED' ? 'Reprovar' : 'Mover'}
          </Button>
        }
      >
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={pending?.stage === 'REJECTED' ? 'Motivo (fica só no histórico interno)' : 'Observação (opcional)'} rows={3} />
        <Checkbox className="mt-3" checked={notifyCandidate} onChange={setNotifyCandidate} label="Avisar o candidato por e-mail" />
      </Modal>
      {editing && job && <JobFormModal job={job} onClose={() => setEditing(false)} />}
    </div>
  );
}
