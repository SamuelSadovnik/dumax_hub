import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Me, Role } from '@dumax/shared';
import { ADMIN_PORTAL_ROLES, HR_ROLES } from '@dumax/shared';
import { ApiError, api, tokenStore } from './api';
import { disconnectSocket } from './socket';

interface AuthCtx {
  user: Me | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<Me>;
  logout: () => void;
  refresh: () => Promise<void>;
  isAdminPortal: boolean;
  isHR: boolean;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(Boolean(tokenStore.get()));
  const qc = useQueryClient();

  const refresh = useCallback(async () => {
    if (!tokenStore.get()) {
      setUser(null);
      setLoading(false);
      return;
    }
    // Só desloga quando o servidor diz que a sessão é inválida (401/403).
    // Falha de rede, API reiniciando ou erro 500: tenta de novo sem perder o login.
    for (let attempt = 0; ; attempt++) {
      try {
        setUser(await api.get<Me>('/auth/me'));
        break;
      } catch (e) {
        if ((e instanceof ApiError && (e.status === 401 || e.status === 403)) || !tokenStore.get()) {
          tokenStore.set(null);
          setUser(null);
          break;
        }
        await new Promise((r) => setTimeout(r, Math.min(5000, 800 * 2 ** attempt)));
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = async (email: string, password: string) => {
    const res = await api.post<{ token: string; user: Me }>('/auth/login', { email, password });
    tokenStore.set(res.token);
    setUser(res.user);
    return res.user;
  };

  const logout = () => {
    tokenStore.set(null);
    disconnectSocket();
    qc.clear();
    setUser(null);
    window.location.href = '/login';
  };

  return (
    <Ctx.Provider
      value={{
        user,
        loading,
        login,
        logout,
        refresh,
        isAdminPortal: Boolean(user && ADMIN_PORTAL_ROLES.includes(user.role)),
        isHR: Boolean(user && HR_ROLES.includes(user.role)),
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

/** Para onde cada perfil vai depois de entrar */
export function homeFor(role: Role | undefined) {
  return role && HR_ROLES.includes(role) ? '/admin' : '/inicio';
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth fora do AuthProvider');
  return ctx;
}

/** Usuário logado garantido (use dentro de rotas protegidas) */
export function useMe(): Me {
  const { user } = useAuth();
  if (!user) throw new Error('Usuário não autenticado');
  return user;
}
