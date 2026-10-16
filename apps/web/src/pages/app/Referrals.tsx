import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Copy, MapPin, MessageCircle, UserPlus } from 'lucide-react';
import { STAGE_LABEL, WORK_MODE_LABEL, type Stage, type WorkMode } from '@dumax/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fromNow } from '@/lib/format';
import { Button, EmptyState, PageHeader, PageLoader } from '@/components/ui';

interface ReferralData {
  jobs: { id: string; slug: string; title: string; summary: string | null; location: string | null; workMode: WorkMode; openings: number; department: { name: string; color: string } | null }[];
  referrals: { id: string; stage: Stage; createdAt: string; candidate: { name: string }; job: { title: string } }[];
}

/** O que a pessoa que indicou vê: sem detalhes internos do processo */
function referralStatus(stage: Stage) {
  if (stage === 'HIRED') return { label: 'Contratado', cls: 'bg-ok-soft text-ok' };
  if (stage === 'REJECTED') return { label: 'Não seguiu', cls: 'bg-ink-100 text-ink-500' };
  if (stage === 'INTERVIEW' || stage === 'OFFER') return { label: STAGE_LABEL[stage], cls: 'bg-brand-50 text-brand-700' };
  return { label: 'Em análise', cls: 'bg-warn-soft text-warn' };
}

export default function Referrals() {
  const { user } = useAuth();
  const { data, isLoading } = useQuery({ queryKey: ['referrals'], queryFn: () => api.get<ReferralData>('/referrals/mine') });
  if (isLoading || !data || !user) return <PageLoader />;

  const linkFor = (slug: string) => `${window.location.origin}/vagas/${slug}?ref=${user.id}`;
  const copy = async (slug: string) => {
    await navigator.clipboard?.writeText(linkFor(slug)).catch(() => undefined);
    toast.success('Link copiado. Quem se candidatar por ele fica como sua indicação.');
  };
  const whatsapp = (j: ReferralData['jobs'][number]) =>
    window.open(`https://wa.me/?text=${encodeURIComponent(`Oi! Estamos contratando para ${j.title}. Acho que tem a ver com você. Candidate-se por aqui: ${linkFor(j.slug)}`)}`, '_blank');
  const hired = data.referrals.filter((r) => r.stage === 'HIRED').length;

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Indicar alguém" subtitle="Conhece alguém bom para uma vaga? Mande o seu link. A candidatura chega marcada como sua indicação e você acompanha por aqui." />

      <section className="card mb-5 overflow-hidden">
        <h2 className="border-b border-ink-100 px-5 py-3 text-base font-semibold text-ink-900">
          Vagas abertas <span className="num text-sm font-normal text-ink-400">{data.jobs.length}</span>
        </h2>
        {data.jobs.length === 0 ? (
          <EmptyState compact title="Nenhuma vaga aberta agora" text="Quando o RH abrir uma vaga, ela aparece aqui." />
        ) : (
          <ul className="divide-y divide-ink-100">
            {data.jobs.map((j) => (
              <li key={j.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                <span className="h-9 w-1 shrink-0 rounded-full" style={{ background: j.department?.color ?? '#CBD2E1' }} />
                <div className="min-w-0 flex-1">
                  <a href={`/vagas/${j.slug}`} target="_blank" rel="noreferrer" className="block truncate text-sm font-semibold text-ink-900 hover:text-brand-700">
                    {j.title}
                  </a>
                  <p className="flex items-center gap-1 truncate text-xs text-ink-500">
                    {j.department?.name && <span>{j.department.name} ·</span>}
                    <MapPin className="h-3 w-3" /> {j.location ?? 'A combinar'} · {WORK_MODE_LABEL[j.workMode]}
                    {j.openings > 1 && <span>· {j.openings} vagas</span>}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" icon={<Copy className="h-3.5 w-3.5" />} onClick={() => copy(j.slug)}>
                    Copiar meu link
                  </Button>
                  <Button size="sm" variant="secondary" icon={<MessageCircle className="h-3.5 w-3.5 text-ok" />} onClick={() => whatsapp(j)} aria-label={`Mandar ${j.title} no WhatsApp`}>
                    WhatsApp
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card overflow-hidden">
        <header className="flex items-center gap-3 border-b border-ink-100 px-5 py-3">
          <h2 className="flex-1 text-base font-semibold text-ink-900">Minhas indicações</h2>
          {hired > 0 && <span className="rounded-full bg-ok-soft px-2.5 py-0.5 text-xs font-semibold text-ok">{hired} contratad{hired > 1 ? 'os' : 'o'}</span>}
        </header>
        {data.referrals.length === 0 ? (
          <EmptyState compact icon={<UserPlus />} title="Você ainda não indicou ninguém" text="Copie o link de uma vaga acima e mande para quem você conhece." />
        ) : (
          <ul className="divide-y divide-ink-100">
            {data.referrals.map((r) => {
              const st = referralStatus(r.stage);
              return (
                <li key={r.id} className="flex items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink-900">{r.candidate.name}</p>
                    <p className="truncate text-xs text-ink-500">
                      {r.job.title} · {fromNow(r.createdAt)}
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${st.cls}`}>{st.label}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
