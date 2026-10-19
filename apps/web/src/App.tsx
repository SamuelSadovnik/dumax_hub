import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { homeFor, useAuth } from './lib/auth';
import { AppShell } from './components/layout/AppShell';
import { PageLoader } from './components/ui';

// ── Portal de vagas (público)
const Login = lazy(() => import('./pages/public/Login'));
const Careers = lazy(() => import('./pages/public/Careers'));
const JobPublic = lazy(() => import('./pages/public/JobPublic'));
const AssessmentPublic = lazy(() => import('./pages/public/AssessmentPublic'));
const SignPublic = lazy(() => import('./pages/public/SignPublic'));
const VerifyPublic = lazy(() => import('./pages/public/VerifyPublic'));
// ── Portal do colaborador
const Home = lazy(() => import('./pages/app/Home'));
const Tasks = lazy(() => import('./pages/app/Tasks'));
const Chat = lazy(() => import('./pages/app/Chat'));
const Agenda = lazy(() => import('./pages/app/Agenda'));
const Goals = lazy(() => import('./pages/app/Goals'));
const MyPonto = lazy(() => import('./pages/app/MyPonto'));
const Documents = lazy(() => import('./pages/app/Documents'));
const DocumentPage = lazy(() => import('./pages/app/DocumentPage'));
const Certificate = lazy(() => import('./pages/app/Certificate'));
const Pulse = lazy(() => import('./pages/app/Pulse'));
const Mural = lazy(() => import('./pages/app/Mural'));
const OrgChart = lazy(() => import('./pages/app/OrgChart'));
const Profile = lazy(() => import('./pages/app/Profile'));
const Licenses = lazy(() => import('./pages/app/Licenses'));
const MyProfileTest = lazy(() => import('./pages/app/ProfileTest'));
const ProfileMap = lazy(() => import('./pages/app/ProfileMap'));
const Referrals = lazy(() => import('./pages/app/Referrals'));
// ── Portal admin
const Performance = lazy(() => import('./pages/admin/Performance'));
const PersonPerformance = lazy(() => import('./pages/admin/PersonPerformance'));
const PontoAdmin = lazy(() => import('./pages/admin/PontoAdmin'));
const Jobs = lazy(() => import('./pages/admin/Jobs'));
const Pipeline = lazy(() => import('./pages/admin/Pipeline'));
const ApplicationPage = lazy(() => import('./pages/admin/ApplicationPage'));
const TalentPool = lazy(() => import('./pages/admin/TalentPool'));
const PulseReport = lazy(() => import('./pages/admin/PulseReport'));
const People = lazy(() => import('./pages/admin/People'));
const Structure = lazy(() => import('./pages/admin/Structure'));


function RequireAuth({ children, admin, hr }: { children: ReactNode; admin?: boolean; hr?: boolean }) {
  const { user, loading, isAdminPortal, isHR } = useAuth();
  const location = useLocation();
  if (loading) return <PageLoader />;
  if (!user) return <Navigate to="/login" state={{ from: location.pathname + location.search }} replace />;
  if (admin && !isAdminPortal) return <Navigate to="/inicio" replace />;
  if (hr && !isHR) return <Navigate to="/admin" replace />;
  return <>{children}</>;
}

/** Links antigos (/app/..., /gestao/...) continuam funcionando */
function Legacy({ to }: { to: (rest: string) => string }) {
  const params = useParams();
  const location = useLocation();
  return <Navigate to={to(params['*'] ?? '') + location.search} replace />;
}

export function App() {
  const { user, loading } = useAuth();
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/" element={loading ? <PageLoader /> : <Navigate to={user ? homeFor(user.role) : '/vagas'} replace />} />
        <Route path="/login" element={<Login />} />

        {/* Portal de vagas */}
        <Route path="/vagas" element={<Careers />} />
        <Route path="/vagas/:slug" element={<JobPublic />} />
        <Route path="/teste/:token" element={<AssessmentPublic />} />
        <Route path="/assinar/:token" element={<SignPublic />} />
        <Route path="/verificar/:id" element={<VerifyPublic />} />

        <Route path="/app/*" element={<Legacy to={(r) => (r ? `/${r}` : '/inicio')} />} />
        <Route path="/gestao/*" element={<Legacy to={(r) => `/admin/${r}`} />} />

        {/* Portal do colaborador */}
        <Route
          element={
            <RequireAuth>
              <AppShell portal="colaborador" />
            </RequireAuth>
          }
        >
          <Route path="/inicio" element={<Home />} />
          <Route path="/demandas" element={<Tasks />} />
          <Route path="/chat" element={<Chat />} />
          <Route path="/agenda" element={<Agenda />} />
          <Route path="/metas" element={<Goals scope="mine" />} />
          <Route path="/ponto" element={<MyPonto />} />
          <Route path="/documentos" element={<Documents />} />
          <Route path="/documentos/:id" element={<DocumentPage />} />
          <Route path="/desempenho" element={<PersonPerformance self />} />
          <Route path="/perfil-comportamental" element={<MyProfileTest />} />
          <Route path="/perfis" element={<ProfileMap />} />
          <Route path="/clima" element={<Pulse />} />
          <Route path="/mural" element={<Mural />} />
          <Route path="/organograma" element={<OrgChart />} />
          <Route path="/perfil" element={<Profile />} />
          <Route path="/licencas" element={<Licenses />} />
          <Route path="/indicar" element={<Referrals />} />
        </Route>

        {/* Portal admin */}
        <Route
          element={
            <RequireAuth admin>
              <AppShell portal="admin" />
            </RequireAuth>
          }
        >
          <Route path="/admin" element={<Performance />} />
          <Route path="/admin/desempenho/:id" element={<PersonPerformance />} />
          <Route path="/admin/ponto" element={<PontoAdmin />} />
          <Route path="/admin/metas" element={<Goals scope="team" />} />
          <Route path="/admin/perfis" element={<ProfileMap admin />} />
          <Route path="/admin/recrutamento" element={<Jobs />} />
          <Route path="/admin/recrutamento/vagas/:id" element={<Pipeline />} />
          <Route path="/admin/recrutamento/candidaturas/:id" element={<ApplicationPage />} />
          <Route path="/admin/talentos" element={<TalentPool />} />
          <Route path="/admin/documentos" element={<Documents admin />} />
          <Route path="/admin/documentos/:id" element={<DocumentPage />} />
          <Route path="/admin/licencas" element={<Licenses admin />} />
          <Route path="/admin/clima" element={<RequireAuth hr><PulseReport /></RequireAuth>} />
          <Route path="/admin/pessoas" element={<RequireAuth hr><People /></RequireAuth>} />
          <Route path="/admin/estrutura" element={<RequireAuth hr><Structure /></RequireAuth>} />
          <Route path="/admin/organograma" element={<OrgChart />} />
        </Route>

        {/* certificado fora do layout, para impressão limpa */}
        <Route path="/documentos/:id/certificado" element={<RequireAuth><Certificate /></RequireAuth>} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
