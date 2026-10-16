import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { EMPLOYMENT_TYPE_LABEL, WORK_MODE_LABEL } from '@dumax/shared';
import { api } from '@/lib/api';
import type { Job } from '@/lib/types';
import { fmtMoney } from '@/lib/format';
import { EmptyState, PageLoader } from '@/components/ui';
import { Logo } from '@/components/brand';

export function PublicHeader() {
  return (
    <header className="border-b border-ink-200 bg-white">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-5">
        <Link to="/vagas" aria-label="Dumax — vagas">
          <Logo />
        </Link>
        <Link to="/login" className="text-sm font-medium text-ink-600 hover:text-ink-900">
          Área do colaborador
        </Link>
      </div>
    </header>
  );
}

export function salaryText(j: Pick<Job, 'salaryMin' | 'salaryMax'>) {
  if (j.salaryMin && j.salaryMax) return `${fmtMoney(j.salaryMin)} a ${fmtMoney(j.salaryMax)}`;
  if (j.salaryMin) return `A partir de ${fmtMoney(j.salaryMin)}`;
  if (j.salaryMax) return `Até ${fmtMoney(j.salaryMax)}`;
  return null;
}

const STEPS = [
  ['Inscrição', 'Seus dados e currículo, em 2 minutos.'],
  ['Teste de perfil', '18 perguntas rápidas sobre como você trabalha.'],
  ['Entrevistas', 'Conversa com o RH e com quem vai liderar você.'],
  ['Proposta', 'Retorno para todos os candidatos, aprovados ou não.'],
];

export default function Careers() {
  const { data, isLoading } = useQuery({ queryKey: ['public-jobs'], queryFn: () => api.get<Job[]>('/public/jobs') });
  const jobs = data ?? [];
  const groups = Object.entries(
    jobs.reduce<Record<string, Job[]>>((acc, j) => {
      const k = j.department?.name ?? 'Outras áreas';
      (acc[k] ??= []).push(j);
      return acc;
    }, {}),
  ).sort((a, b) => a[0].localeCompare(b[0]));

  return (
    <div className="min-h-screen bg-white">
      <PublicHeader />

      <section className="border-b border-ink-200 bg-ink-900 text-white">
        <div className="mx-auto grid max-w-5xl gap-10 px-5 py-16 md:grid-cols-[1fr_auto] md:items-end">
          <div>
            <h1 className="max-w-xl text-4xl font-semibold leading-[1.1] tracking-[-0.03em] sm:text-5xl">Trabalhe na Dumax</h1>
            <p className="mt-4 max-w-lg text-[15px] leading-relaxed text-ink-300">Metas claras, gente que ajuda e espaço para crescer. Escolha uma vaga abaixo e candidate-se.</p>
          </div>
          <p className="num text-sm text-ink-400">
            <span className="block text-5xl font-semibold tracking-tight text-white">{jobs.length}</span>
            vaga(s) aberta(s)
          </p>
        </div>
      </section>

      <main className="mx-auto max-w-5xl px-5 py-12">
        {isLoading ? (
          <PageLoader />
        ) : !jobs.length ? (
          <EmptyState title="Nenhuma vaga aberta agora" text="Volte em breve — abrimos novas oportunidades com frequência." />
        ) : (
          <div className="space-y-10">
            {groups.map(([area, list]) => (
              <section key={area}>
                <h2 className="mb-3 flex items-baseline gap-2 text-sm font-semibold text-ink-900">
                  <span className="h-2 w-2 rounded-full" style={{ background: list[0].department?.color ?? '#9AA1B5' }} />
                  {area}
                  <span className="num font-normal text-ink-400">{list.length}</span>
                </h2>
                <ul className="divide-y divide-ink-200 border-y border-ink-200">
                  {list.map((j) => (
                    <li key={j.id}>
                      <Link to={`/vagas/${j.slug}`} className="group grid gap-1 py-4 sm:grid-cols-[1fr_200px_160px_24px] sm:items-center sm:gap-4">
                        <span>
                          <span className="block text-[17px] font-medium text-ink-900 group-hover:text-brand-600">{j.title}</span>
                          {j.summary && <span className="mt-0.5 block text-sm text-ink-500">{j.summary}</span>}
                        </span>
                        <span className="text-sm text-ink-600">
                          {j.location ?? '—'} · {WORK_MODE_LABEL[j.workMode]}
                        </span>
                        <span className="text-sm text-ink-600">
                          {EMPLOYMENT_TYPE_LABEL[j.employmentType]}
                          {j.showSalary && salaryText(j) && <span className="block text-xs text-ok">{salaryText(j)}</span>}
                        </span>
                        <ArrowRight className="hidden h-4 w-4 text-ink-300 transition group-hover:translate-x-0.5 group-hover:text-brand-500 sm:block" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}

        <section className="mt-16 border-t border-ink-200 pt-10">
          <h2 className="text-lg font-semibold">Como funciona o processo</h2>
          <ol className="mt-6 grid gap-6 sm:grid-cols-4">
            {STEPS.map(([t, d], i) => (
              <li key={t}>
                <span className="num flex h-7 w-7 items-center justify-center rounded-full bg-brand-50 text-sm font-semibold text-brand-700">{i + 1}</span>
                <p className="mt-3 text-sm font-semibold">{t}</p>
                <p className="mt-1 text-sm text-ink-500">{d}</p>
              </li>
            ))}
          </ol>
        </section>
      </main>
      <footer className="border-t border-ink-200 py-8 text-center text-xs text-ink-400">Dumax · seus dados são tratados conforme a LGPD</footer>
    </div>
  );
}
