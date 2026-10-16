import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Briefcase, Lock } from 'lucide-react';
import { homeFor, useAuth } from '@/lib/auth';
import { errorMessage } from '@/lib/api';
import { Button, Field, Input } from '@/components/ui';
import { Logo } from '@/components/brand';

const DEMO = [
  ['admin@dumax.com.br', 'Diretoria', 'portal admin'],
  ['rh@dumax.com.br', 'RH', 'portal admin'],
  ['gestor@dumax.com.br', 'Gestor', 'admin do time'],
  ['luiza@dumax.com.br', 'Colaboradora', 'portal colaborador'],
];

export default function Login() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (user) return <Navigate to={homeFor(user.role)} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const me = await login(email, password);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from && from !== '/' ? from : homeFor(me.role), { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid min-h-screen bg-canvas lg:grid-cols-[1fr_520px]">
      <section className="relative hidden flex-col justify-between overflow-hidden bg-ink-900 p-12 text-white lg:flex">
        <Logo light />
        <div className="max-w-lg">
          <h1 className="text-[40px] font-semibold leading-[1.1] tracking-tight">A operação da Dumax inteira, numa tela só.</h1>
          <dl className="mt-10 grid grid-cols-3 gap-6 border-t border-white/10 pt-6 text-sm">
            <div>
              <dt className="font-medium">Colaborador</dt>
              <dd className="mt-1 text-ink-300">Demandas, chat, agenda, ponto e documentos.</dd>
            </div>
            <div>
              <dt className="font-medium">Admin</dt>
              <dd className="mt-1 text-ink-300">Desempenho do time, recrutamento, licenças e clima.</dd>
            </div>
            <div>
              <dt className="font-medium">Vagas</dt>
              <dd className="mt-1 text-ink-300">Portal público com links por vaga.</dd>
            </div>
          </dl>
        </div>
        <svg className="pointer-events-none absolute -right-10 top-16 h-[420px] w-[420px] opacity-[.07]" viewBox="0 0 100 100" aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <rect key={i} x={10 + i * 22} y={70 - i * 18} width="14" height={20 + i * 18} rx="2" fill="white" />
          ))}
        </svg>
      </section>

      <section className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-10 lg:hidden">
            <Logo />
          </div>
          <h2 className="text-2xl font-semibold">Entrar</h2>
          <p className="mt-1 text-sm text-ink-500">Use seu e-mail da empresa. Você cai direto no seu portal.</p>
          <form onSubmit={submit} className="mt-7 space-y-4">
            <Field label="E-mail">
              <Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@dumax.com.br" />
            </Field>
            <Field label="Senha">
              <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            {error && <p className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}
            <Button type="submit" loading={loading} className="w-full" icon={<Lock className="h-4 w-4" />}>
              Entrar
            </Button>
          </form>

          <div className="mt-8">
            <p className="mb-2 text-xs text-ink-500">Acessos de demonstração · senha dumax123</p>
            <div className="divide-y divide-ink-100 rounded-lg border border-ink-200 bg-white">
              {DEMO.map(([e, l, p]) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => {
                    setEmail(e);
                    setPassword('dumax123');
                  }}
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-[13px] hover:bg-ink-50"
                >
                  <span>
                    <span className="font-medium">{l}</span> <span className="text-ink-500">{e}</span>
                  </span>
                  <span className="text-xs text-ink-400">{p}</span>
                </button>
              ))}
            </div>
          </div>
          <Link to="/vagas" className="mt-6 flex items-center justify-center gap-2 text-sm text-ink-500 hover:text-brand-600">
            <Briefcase className="h-4 w-4" /> Ver vagas abertas
          </Link>
        </div>
      </section>
    </div>
  );
}
