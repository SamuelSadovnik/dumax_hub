import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowLeft, ArrowRight, Clock3 } from 'lucide-react';
import { PROFILES, type ProfileKey } from '@dumax/shared';
import { api, errorMessage } from '@/lib/api';
import { Button, PageLoader } from '@/components/ui';
import { PublicHeader } from './Careers';

interface AssessmentData {
  status: 'PENDING' | 'COMPLETED' | 'EXPIRED';
  candidateName: string;
  jobTitle: string;
  questions: { id: string; prompt: string; options: { id: string; text: string }[] }[];
  result: { primary: ProfileKey; secondary: ProfileKey } | null;
}

function ResultView({ primary, secondary, name }: { primary: ProfileKey; secondary: ProfileKey; name: string }) {
  const p = PROFILES[primary];
  return (
    <div className="card overflow-hidden">
      <div className="border-b border-ink-100 p-8">
        <p className="text-sm text-ink-500">Obrigado, {name}. Seu perfil predominante é</p>
        <h2 className="mt-1 flex items-center gap-3 text-3xl font-semibold">
          <span className="h-3 w-3 rounded-full" style={{ background: p.color }} />
          {p.label}
        </h2>
        <p className="mt-1 text-ink-600">{p.tagline}</p>
      </div>
      <div className="p-6">
        <p className="text-ink-700">{p.description}</p>
        <p className="mt-4 text-sm text-ink-500">
          Perfil secundário: <strong>{PROFILES[secondary].label}</strong>
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {p.strengths.map((s) => (
            <span key={s} className="rounded-md bg-ink-100 px-2 py-1 text-xs font-medium">
              {s}
            </span>
          ))}
        </div>
        <p className="mt-6 rounded-lg bg-ink-50 p-4 text-sm text-ink-600">Suas respostas foram enviadas para o RH da Dumax. Entraremos em contato sobre os próximos passos.</p>
      </div>
    </div>
  );
}

export default function AssessmentPublic() {
  const { token } = useParams();
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['assessment', token],
    queryFn: () => api.get<AssessmentData>(`/public/assessments/${token}`),
  });
  const [step, setStep] = useState(-1);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ primary: ProfileKey; secondary: ProfileKey } | null>(null);

  if (isLoading || !data) return <PageLoader />;
  const qs = data.questions;
  const final = result ?? data.result;

  const choose = (qid: string, oid: string) => {
    setAnswers((a) => ({ ...a, [qid]: oid }));
    if (step < qs.length - 1) setTimeout(() => setStep((s) => s + 1), 220);
  };

  const submit = async () => {
    setSending(true);
    setError(null);
    try {
      setResult(await api.post<{ primary: ProfileKey; secondary: ProfileKey }>(`/public/assessments/${token}`, { answers }));
      void refetch();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSending(false);
    }
  };

  const q = qs[step];
  const progress = qs.length ? (Object.keys(answers).length / qs.length) * 100 : 0;

  return (
    <div className="min-h-screen bg-canvas">
      <PublicHeader />
      <main className="mx-auto max-w-2xl px-5 py-10">
        {final ? (
          <ResultView primary={final.primary} secondary={final.secondary} name={data.candidateName} />
        ) : data.status === 'EXPIRED' ? (
          <div className="card p-8 text-center">
            <h2 className="text-xl font-semibold">Este link expirou</h2>
            <p className="mt-2 text-ink-500">Fale com o RH da Dumax para receber um novo.</p>
          </div>
        ) : step === -1 ? (
          <div className="card p-8">
            <p className="text-sm text-ink-500">{data.jobTitle}</p>
            <h1 className="mt-1 text-2xl font-semibold leading-snug">Olá, {data.candidateName}. Vamos conhecer o seu jeito de trabalhar.</h1>
            <p className="mt-3 text-ink-600">São {qs.length} perguntas rápidas. Em cada uma, escolha a opção que mais combina com você. Não existe resposta certa ou errada.</p>
            <p className="mt-4 flex items-center gap-2 text-sm text-ink-500">
              <Clock3 className="h-4 w-4" /> Cerca de 5 minutos
            </p>
            <Button className="mt-8" onClick={() => setStep(0)} icon={<ArrowRight className="h-4 w-4" />}>
              Começar
            </Button>
          </div>
        ) : (
          <div>
            <div className="mb-6">
              <div className="num mb-2 flex justify-between text-xs text-ink-500">
                <span>
                  Pergunta {step + 1} de {qs.length}
                </span>
                <span>{Math.round(progress)}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-ink-200">
                <div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${progress}%` }} />
              </div>
            </div>
            <div key={q.id} className="card animate-fade-up p-6 sm:p-8">
              <h2 className="text-lg font-semibold sm:text-xl">{q.prompt}</h2>
              <div className="mt-6 grid gap-2.5">
                {q.options.map((o, i) => (
                  <button
                    key={o.id}
                    onClick={() => choose(q.id, o.id)}
                    className={clsx(
                      'flex items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors',
                      answers[q.id] === o.id ? 'border-brand-500 bg-brand-50' : 'border-ink-200 hover:border-ink-300 hover:bg-ink-50',
                    )}
                  >
                    <span className={clsx('flex h-6 w-6 shrink-0 items-center justify-center rounded text-xs font-medium', answers[q.id] === o.id ? 'bg-brand-500 text-white' : 'bg-ink-100 text-ink-500')}>
                      {'ABCD'[i]}
                    </span>
                    <span className="text-[15px]">{o.text}</span>
                  </button>
                ))}
              </div>
              <div className="mt-6 flex items-center justify-between">
                <Button variant="ghost" disabled={step === 0} onClick={() => setStep((s) => s - 1)} icon={<ArrowLeft className="h-4 w-4" />}>
                  Voltar
                </Button>
                {step === qs.length - 1 ? (
                  <Button onClick={submit} loading={sending} disabled={Object.keys(answers).length < qs.length}>
                    Enviar respostas
                  </Button>
                ) : (
                  <Button variant="secondary" disabled={!answers[q.id]} onClick={() => setStep((s) => s + 1)}>
                    Próxima
                  </Button>
                )}
              </div>
              {error && <p className="mt-3 text-sm text-bad">{error}</p>}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
