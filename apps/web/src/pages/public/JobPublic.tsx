import { useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Building2, CheckCircle2, FileUp, MapPin, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import { EMPLOYMENT_TYPE_LABEL, WORK_MODE_LABEL } from '@dumax/shared';
import { api, errorMessage } from '@/lib/api';
import type { Job } from '@/lib/types';
import type { ScreeningQuestion } from '@dumax/shared';
import { Badge, Button, Checkbox, EmptyState, Field, Input, PageLoader, Select, Textarea } from '@/components/ui';
import { PublicHeader, salaryText } from './Careers';

function Section({ title, text }: { title: string; text: string | null }) {
  if (!text) return null;
  return (
    <section className="border-t border-ink-200 py-6 first:border-0 first:pt-0">
      <h2 className="mb-2 font-semibold">{title}</h2>
      <div className="max-w-[68ch] whitespace-pre-line text-[15px] leading-relaxed text-ink-700">{text}</div>
    </section>
  );
}

/** Uma pergunta da vaga: Sim/Não, múltipla escolha ou número */
function ScreeningField({ q, value, onChange }: { q: ScreeningQuestion; value: string | undefined; onChange: (v: string) => void }) {
  const type = q.type ?? 'YES_NO';
  const seg = (opts: { v: string; label: string }[]) => (
    <span className="inline-flex shrink-0 flex-wrap rounded-lg bg-ink-100 p-0.5" role="radiogroup" aria-label={q.text}>
      {opts.map(({ v, label }) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={`h-7 rounded-md px-3 text-[13px] font-medium transition ${value === v ? 'bg-white text-ink-900 shadow-sm ring-1 ring-ink-200' : 'text-ink-500 hover:text-ink-900'}`}
        >
          {label}
        </button>
      ))}
    </span>
  );
  if (type === 'YES_NO')
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-ink-200 px-3 py-2">
        <span className="text-sm text-ink-800">{q.text}</span>
        {seg([{ v: 'YES', label: 'Sim' }, { v: 'NO', label: 'Não' }])}
      </div>
    );
  const options = q.options ?? [];
  return (
    <div className="space-y-2 rounded-lg border border-ink-200 px-3 py-2.5">
      <span className="block text-sm text-ink-800">{q.text}</span>
      {type === 'NUMBER' ? (
        <div className="flex items-center gap-2">
          {q.unit === 'R$' && <span className="text-sm text-ink-500">R$</span>}
          <Input type="number" inputMode="decimal" min={0} className="w-36" value={value ?? ''} onChange={(e) => onChange(e.target.value)} aria-label={q.text} />
          {q.unit && q.unit !== 'R$' && <span className="text-sm text-ink-500">{q.unit}</span>}
        </div>
      ) : options.length <= 4 && options.every((o) => o.length <= 14) ? (
        seg(options.map((o) => ({ v: o, label: o })))
      ) : (
        <Select value={value ?? ''} onChange={(e) => onChange(e.target.value)} aria-label={q.text}>
          <option value="">Selecione</option>
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </Select>
      )}
    </div>
  );
}

export default function JobPublic() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { data: job, isLoading, error } = useQuery({ queryKey: ['public-job', slug], queryFn: () => api.get<Job>(`/public/jobs/${slug}`) });
  const [form, setForm] = useState({ name: '', email: '', phone: '', linkedinUrl: '', city: '', coverLetter: '' });
  const [file, setFile] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);

  if (isLoading) return <PageLoader />;
  if (error || !job)
    return (
      <div className="min-h-screen bg-canvas">
        <PublicHeader />
        <EmptyState title="Vaga não encontrada" text="Ela pode ter sido encerrada." action={<Link to="/vagas" className="text-brand-600 hover:underline">Ver outras vagas</Link>} />
      </div>
    );

  const set = (k: keyof typeof form) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) return toast.error('Anexe seu currículo');
    if ((job.screeningQuestions ?? []).some((q) => !String(answers[q.id] ?? '').trim())) return toast.error('Responda as perguntas sobre a vaga');
    if (!consent) return toast.error('É preciso aceitar o uso dos seus dados');
    setSending(true);
    try {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => fd.append(k, String(v)));
      fd.append('consent', 'true');
      fd.append('screening', JSON.stringify(answers));
      const params = new URLSearchParams(window.location.search);
      fd.append('source', params.get('utm_source') ?? params.get('origem') ?? 'site');
      const ref = params.get('ref');
      if (ref) fd.append('ref', ref);
      fd.append('resume', file);
      const res = await api.upload<{ assessmentUrl: string | null }>(`/public/jobs/${slug}/apply`, fd);
      if (res.assessmentUrl) {
        toast.success('Candidatura enviada. Falta só o teste rápido de perfil.');
        navigate(new URL(res.assessmentUrl).pathname);
      } else setDone(true);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSending(false);
    }
  };

  const share = async () => {
    const url = window.location.href;
    if (navigator.share) await navigator.share({ title: job.title, url }).catch(() => undefined);
    else {
      await navigator.clipboard.writeText(url);
      toast.success('Link copiado');
    }
  };

  return (
    <div className="min-h-screen bg-canvas">
      <PublicHeader />
      <div className="mx-auto grid max-w-5xl gap-8 px-5 py-8 lg:grid-cols-[minmax(0,1fr)_380px]">
        <article>
          <Link to="/vagas" className="mb-5 inline-flex items-center gap-1 text-[13px] text-ink-500 hover:text-ink-900">
            <ArrowLeft className="h-4 w-4" /> Todas as vagas
          </Link>
          <h1 className="text-[28px] font-semibold leading-tight tracking-tight sm:text-[34px]">{job.title}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-ink-500">
            {job.department && (
              <span className="flex items-center gap-1">
                <Building2 className="h-4 w-4" /> {job.department.name}
              </span>
            )}
            {job.location && (
              <span className="flex items-center gap-1">
                <MapPin className="h-4 w-4" /> {job.location}
              </span>
            )}
            <Badge>{WORK_MODE_LABEL[job.workMode]}</Badge>
            <Badge>{EMPLOYMENT_TYPE_LABEL[job.employmentType]}</Badge>
            {job.showSalary && salaryText(job) && <Badge tone="ok">{salaryText(job)}</Badge>}
            <button onClick={share} className="ml-auto flex items-center gap-1 rounded-md px-2 py-1 text-ink-600 hover:bg-ink-100">
              <Share2 className="h-4 w-4" /> Compartilhar
            </button>
          </div>
          <div className="mt-8">
            <Section title="Sobre a vaga" text={job.description} />
            <Section title="O que buscamos" text={job.requirements} />
            <Section title="Benefícios" text={job.benefits} />
          </div>
        </article>

        <aside>
          <div className="card sticky top-6 p-5">
            {done ? (
              <div className="py-8 text-center">
                <CheckCircle2 className="mx-auto h-10 w-10 text-ok" />
                <h3 className="mt-3 text-lg font-semibold">Candidatura enviada</h3>
                <p className="mt-1 text-sm text-ink-500">Nosso time vai analisar e entrar em contato pelo e-mail ou WhatsApp.</p>
              </div>
            ) : (
              <form onSubmit={submit} className="space-y-3">
                <h3 className="font-semibold">Candidatar-se</h3>
                <Field label="Nome completo">
                  <Input required value={form.name} onChange={set('name')} />
                </Field>
                <Field label="E-mail">
                  <Input type="email" required value={form.email} onChange={set('email')} />
                </Field>
                <Field label="Telefone / WhatsApp">
                  <Input type="tel" required value={form.phone} onChange={set('phone')} placeholder="(45) 90000-0000" />
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Cidade">
                    <Input value={form.city} onChange={set('city')} />
                  </Field>
                  <Field label="LinkedIn">
                    <Input type="url" value={form.linkedinUrl} onChange={set('linkedinUrl')} placeholder="https://" />
                  </Field>
                </div>
                <Field label="Currículo (PDF ou Word, até 10 MB)">
                  <label className="flex cursor-pointer items-center gap-3 rounded-md border border-dashed border-ink-300 px-3 py-3 text-sm hover:border-brand-300 hover:bg-brand-50/50">
                    <FileUp className="h-5 w-5 text-brand-500" />
                    <span className="truncate">{file ? file.name : 'Clique para anexar'}</span>
                    <input type="file" accept=".pdf,.doc,.docx" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                  </label>
                </Field>
                {(job.screeningQuestions ?? []).length > 0 && (
                  <fieldset className="space-y-2">
                    <legend className="mb-1.5 text-[13px] font-medium text-ink-700">Sobre a vaga</legend>
                    {(job.screeningQuestions ?? []).map((q) => (
                      <ScreeningField key={q.id} q={q} value={answers[q.id]} onChange={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))} />
                    ))}
                  </fieldset>
                )}
                <Field label="Por que você? (opcional)">
                  <Textarea value={form.coverLetter} onChange={set('coverLetter')} rows={3} />
                </Field>
                <Checkbox checked={consent} onChange={setConsent} label={<span className="text-xs text-ink-500">Autorizo a Dumax a usar meus dados para este e futuros processos seletivos, conforme a LGPD. Seus dados ficam criptografados.</span>} />
                <Button type="submit" loading={sending} className="w-full">
                  Enviar candidatura
                </Button>
              </form>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
