import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { toast } from 'sonner';
import { ArrowLeft, ArrowRight, Map as MapIcon, RotateCcw } from 'lucide-react';
import { PROFILES, PROFILE_KEYS, type AssessmentResult, type ProfileKey } from '@dumax/shared';
import { api, errorMessage } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { Button, PageHeader, PageLoader, Panel, ProgressBar } from '@/components/ui';

type Question = { id: string; prompt: string; options: { id: string; text: string }[] };
type Mine = { scores: Record<ProfileKey, number>; primary: ProfileKey; secondary: ProfileKey; completedAt: string } | null;

export function ProfileResult({ scores, primary, secondary }: { scores: Record<ProfileKey, number>; primary: ProfileKey; secondary: ProfileKey }) {
  const p = PROFILES[primary];
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <Panel>
        <div className="p-5">
          <p className="text-sm text-ink-500">Perfil predominante</p>
          <p className="mt-0.5 text-2xl font-semibold" style={{ color: p.color }}>
            {p.label}
          </p>
          <p className="text-sm text-ink-600">
            {p.tagline} · secundário: <span className="font-medium">{PROFILES[secondary].label}</span>
          </p>
          <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-ink-800">{p.description}</p>
          <div className="mt-5 grid gap-5 sm:grid-cols-3">
            <div>
              <p className="mb-1.5 text-[13px] font-medium text-ink-500">Pontos fortes</p>
              <ul className="space-y-1 text-sm">{p.strengths.map((s) => <li key={s}>{s}</li>)}</ul>
            </div>
            <div>
              <p className="mb-1.5 text-[13px] font-medium text-ink-500">Cuidados</p>
              <ul className="space-y-1 text-sm">{p.watchOuts.map((s) => <li key={s}>{s}</li>)}</ul>
            </div>
            <div>
              <p className="mb-1.5 text-[13px] font-medium text-ink-500">Combina com</p>
              <ul className="space-y-1 text-sm">{p.bestFit.map((s) => <li key={s}>{s}</li>)}</ul>
            </div>
          </div>
        </div>
      </Panel>
      <Panel title="Distribuição">
        <ul className="space-y-3.5 p-4">
          {PROFILE_KEYS.map((k) => (
            <li key={k}>
              <div className="mb-1 flex justify-between text-sm">
                <span className="font-medium">{PROFILES[k].label}</span>
                <span className="num text-ink-600">{scores[k]}%</span>
              </div>
              <ProgressBar value={scores[k] / 100} color={PROFILES[k].color} />
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

export default function ProfileTest() {
  const qc = useQueryClient();
  const { data: mine, isLoading } = useQuery({ queryKey: ['profile-me'], queryFn: () => api.get<Mine>('/profiles/me') });
  const [taking, setTaking] = useState(false);
  const { data: test } = useQuery({ queryKey: ['profile-test'], queryFn: () => api.get<{ questions: Question[] }>('/profiles/test'), enabled: taking });
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const submit = useMutation({
    mutationFn: () => api.post<AssessmentResult>('/profiles/test', { answers }),
    onSuccess: () => {
      toast.success('Perfil salvo');
      setTaking(false);
      setAnswers({});
      setStep(0);
      qc.invalidateQueries({ queryKey: ['profile-me'] });
      qc.invalidateQueries({ queryKey: ['profile-map'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (isLoading) return <PageLoader />;

  if (taking) {
    const qs = test?.questions ?? [];
    const q = qs[step];
    if (!q) return <PageLoader />;
    const progress = Object.keys(answers).length / qs.length;
    return (
      <div className="mx-auto max-w-2xl">
        <div className="mb-5 flex items-center gap-3">
          <Button variant="ghost" size="sm" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => setTaking(false)}>
            Sair
          </Button>
          <ProgressBar value={progress} />
          <span className="num shrink-0 text-xs text-ink-500">
            {step + 1}/{qs.length}
          </span>
        </div>
        <Panel>
          <div key={q.id} className="animate-fade-up p-6">
            <h2 className="text-lg font-semibold">{q.prompt}</h2>
            <p className="mt-1 text-sm text-ink-500">Escolha a opção que mais combina com você.</p>
            <div className="mt-5 space-y-2">
              {q.options.map((o) => (
                <button
                  key={o.id}
                  onClick={() => {
                    setAnswers((a) => ({ ...a, [q.id]: o.id }));
                    if (step < qs.length - 1) setTimeout(() => setStep((s) => s + 1), 180);
                  }}
                  className={clsx('block w-full rounded-lg border px-4 py-3 text-left text-[15px] transition', answers[q.id] === o.id ? 'border-brand-500 bg-brand-50' : 'border-ink-200 hover:border-ink-300 hover:bg-ink-50')}
                >
                  {o.text}
                </button>
              ))}
            </div>
            <div className="mt-6 flex justify-between">
              <Button variant="ghost" disabled={step === 0} onClick={() => setStep((s) => s - 1)} icon={<ArrowLeft className="h-4 w-4" />}>
                Anterior
              </Button>
              {step === qs.length - 1 ? (
                <Button loading={submit.isPending} disabled={Object.keys(answers).length < qs.length} onClick={() => submit.mutate()}>
                  Ver meu perfil
                </Button>
              ) : (
                <Button variant="secondary" disabled={!answers[q.id]} onClick={() => setStep((s) => s + 1)}>
                  Próxima <ArrowRight className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </Panel>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Meu perfil comportamental"
        subtitle={mine ? `Respondido em ${fmtDate(mine.completedAt)}` : 'Descubra como você trabalha melhor e ajude a montar times equilibrados'}
        actions={
          <>
            <Link to="/perfis">
              <Button variant="secondary" icon={<MapIcon className="h-4 w-4" />}>
                Mapa da empresa
              </Button>
            </Link>
            {mine && (
              <Button variant="secondary" icon={<RotateCcw className="h-4 w-4" />} onClick={() => setTaking(true)}>
                Refazer teste
              </Button>
            )}
          </>
        }
      />
      {mine ? (
        <ProfileResult scores={mine.scores} primary={mine.primary} secondary={mine.secondary} />
      ) : (
        <Panel>
          <div className="max-w-xl p-6">
            <h2 className="text-lg font-semibold">18 perguntas, cerca de 5 minutos</h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-600">
              Em cada pergunta, escolha a opção que mais combina com seu jeito de trabalhar. Não existe resposta certa. O resultado mostra seu perfil entre <strong>Executor</strong>, <strong>Comunicador</strong>,{' '}
              <strong>Planejador</strong> e <strong>Analista</strong>, e coloca você no mapa de perfis da empresa.
            </p>
            <Button className="mt-5" onClick={() => setTaking(true)} icon={<ArrowRight className="h-4 w-4" />}>
              Começar
            </Button>
          </div>
        </Panel>
      )}
    </div>
  );
}
