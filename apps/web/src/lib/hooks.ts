import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import type { DirectoryUser } from './types';

/** Diretório de pessoas ativas (cache de 1 min) */
export function useUsers() {
  return useQuery({
    queryKey: ['users'],
    queryFn: () => api.get<DirectoryUser[]>('/users'),
    staleTime: 60_000,
  });
}

export function useAiStatus() {
  return useQuery({
    queryKey: ['ai-status'],
    queryFn: () => api.get<{ enabled: boolean; model: string }>('/ai/status'),
    staleTime: 5 * 60_000,
  });
}
