import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import clsx from 'clsx';
import { ArrowUp, History, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { useAiStatus } from '@/lib/hooks';
import { fromNow } from '@/lib/format';
import { Drawer, Spinner } from './ui';

export interface AiDisplayMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  tools: string[];
  createdAt: string;
}

const TOOL_LABEL: Record<string, string> = {
  buscar_pessoas: 'Pessoas',
  ponto_do_dia: 'Ponto de hoje',
  resumo_ponto: 'Banco de horas',
  demandas_da_pessoa: 'Demandas',
  ranking_pendencias: 'Pendências',
  criar_demanda: 'Criou demanda',
  agendar_reuniao: 'Agendou reunião',
  agenda: 'Agenda',
  enviar_mensagem_chat: 'Enviou mensagem',
  resumo_clima: 'Clima',
  resumo_recrutamento: 'Recrutamento',
  desempenho: 'Desempenho',
  licencas: 'Licenças',
  documentos_assinatura: 'Documentos',
};

const SUGGESTIONS = {
  EMPLOYEE: ['Quais demandas minhas estão atrasadas?', 'Como está meu banco de horas este mês?', 'Marque uma reunião amanhã às 10h para revisar a proposta', 'Tenho documento para assinar?'],
  MANAGER: ['Quem do meu time não está sendo produtivo?', 'Quem chegou atrasado hoje?', 'Quantas demandas a Luiza tem abertas?', 'Marque uma reunião amanhã às 10h com o time'],
  HR: ['Quem chegou atrasado hoje?', 'Quais licenças vencem nos próximos 60 dias?', 'Como está o clima nas últimas semanas?', 'Quantos candidatos temos por etapa?'],
};

function Markdown({ text }: { text: string }) {
  return (
    <div className="prose-hub text-sm leading-relaxed text-ink-800">
      <ReactMarkdown
        components={{
          a: ({ href, children }) =>
            href?.startsWith('/') ? (
              <Link to={href}>{children}</Link>
            ) : (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

function AssistantChat({ threadId, onThreadChange }: { threadId: string | null; onThreadChange: (id: string) => void }) {
  const me = useMe();
  const qc = useQueryClient();
  const { data: status } = useAiStatus();
  const [messages, setMessages] = useState<AiDisplayMessage[]>([]);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const thread = useQuery({
    queryKey: ['ai-thread', threadId],
    queryFn: () => api.get<{ messages: AiDisplayMessage[] }>(`/ai/threads/${threadId}`),
    enabled: Boolean(threadId),
  });
  useEffect(() => {
    if (!threadId) setMessages([]);
    else if (thread.data) setMessages(thread.data.messages);
  }, [threadId, thread.data]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const ask = useMutation({
    mutationFn: (q: string) => api.post<{ threadId: string; messages: AiDisplayMessage[] }>('/ai/ask', { ...(threadId ? { threadId } : {}), text: q }),
    onMutate: (q) => {
      setError(null);
      setMessages((m) => [...m, { id: `tmp-${Date.now()}`, role: 'user', text: q, tools: [], createdAt: new Date().toISOString() }]);
    },
    onSuccess: (res) => {
      setMessages((m) => [...m.filter((x) => !x.id.startsWith('tmp-')), ...res.messages]);
      if (res.threadId !== threadId) onThreadChange(res.threadId);
      qc.invalidateQueries({ queryKey: ['ai-threads'] });
      // a conversa mudou: na próxima vez que for aberta pelo histórico, busca de novo
      if (res.threadId === threadId) qc.removeQueries({ queryKey: ['ai-thread', threadId], type: 'inactive' });
      qc.invalidateQueries({ queryKey: ['ai-thread'], refetchType: 'none' });
      if (res.messages.some((m) => m.tools.some((t) => ['criar_demanda', 'agendar_reuniao', 'enviar_mensagem_chat'].includes(t)))) {
        qc.invalidateQueries({ queryKey: ['tasks'] });
        qc.invalidateQueries({ queryKey: ['meetings'] });
        qc.invalidateQueries({ queryKey: ['conversations'] });
        qc.invalidateQueries({ queryKey: ['inbox'] });
      }
    },
    onError: (e) => {
      setMessages((m) => m.filter((x) => !x.id.startsWith('tmp-')));
      setError(errorMessage(e));
    },
  });

  const send = (q = text) => {
    if (!q.trim() || ask.isPending) return;
    setText('');
    ask.mutate(q.trim());
  };
  const suggestions = me.role === 'ADMIN' || me.role === 'HR' ? SUGGESTIONS.HR : me.role === 'MANAGER' ? SUGGESTIONS.MANAGER : SUGGESTIONS.EMPLOYEE;

  return (
    <div className="flex h-full flex-col">
      <div className="scroll-thin flex-1 overflow-y-auto px-4 py-5">
        {!messages.length && (
          <div className="pt-2">
            <p className="text-[15px] font-semibold text-ink-900">Pergunte sobre pessoas, demandas, ponto, agenda e documentos.</p>
            <p className="mt-1 text-sm text-ink-500">Também posso criar demandas, marcar reuniões e mandar mensagens por você. Só vejo o que você tem permissão para ver.</p>
            {status && !status.enabled && (
              <p className="mt-4 rounded-lg border border-warn/30 bg-warn-soft p-3 text-xs text-warn">
                Assistente desligado: coloque a chave do Claude (<code>ANTHROPIC_API_KEY</code>) ou do Gemini (<code>GEMINI_API_KEY</code>) no arquivo <code>apps/api/.env</code> e reinicie.
              </p>
            )}
            <div className="mt-5 space-y-1.5">
              {suggestions.map((s) => (
                <button key={s} onClick={() => send(s)} className="block w-full rounded-lg border border-ink-200 px-3 py-2 text-left text-sm text-ink-700 transition hover:border-brand-300 hover:bg-brand-50/50">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="space-y-4">
          {messages.map((m) =>
            m.role === 'user' ? (
              <div key={m.id} className="flex justify-end">
                <div className="max-w-[85%] whitespace-pre-wrap rounded-xl rounded-br-sm bg-ink-900 px-3.5 py-2 text-sm text-white">{m.text}</div>
              </div>
            ) : (
              <div key={m.id}>
                {!!m.tools.length && (
                  <div className="mb-1.5 flex flex-wrap gap-1">
                    {Array.from(new Set<string>(m.tools)).map((t) => (
                      <span key={t} className="rounded bg-ink-100 px-1.5 py-0.5 text-2xs font-medium text-ink-500">
                        {TOOL_LABEL[t] ?? t}
                      </span>
                    ))}
                  </div>
                )}
                <Markdown text={m.text || '…'} />
              </div>
            ),
          )}
          {ask.isPending && (
            <div className="flex items-center gap-2 text-sm text-ink-500">
              <span className="flex gap-1">
                {[0, 1, 2].map((i) => (
                  <span key={i} className="h-1.5 w-1.5 animate-blink rounded-full bg-ink-400" style={{ animationDelay: `${i * 0.2}s` }} />
                ))}
              </span>
              Consultando
            </div>
          )}
          {error && <p className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}
          <div ref={bottom} />
        </div>
      </div>
      <div className="border-t border-ink-100 p-3">
        <div className="flex items-end gap-2 rounded-lg border border-ink-200 bg-white p-1.5 focus-within:border-brand-400 focus-within:shadow-focus">
          <textarea
            autoFocus
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Escreva sua pergunta"
            className="max-h-40 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none"
          />
          <button onClick={() => send()} disabled={!text.trim() || ask.isPending} aria-label="Enviar" className="flex h-8 w-8 items-center justify-center rounded-md bg-brand-500 text-white transition hover:bg-brand-600 disabled:opacity-40">
            {ask.isPending ? <Spinner className="h-4 w-4 text-white" /> : <ArrowUp className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}

interface Thread {
  id: string;
  title: string;
  updatedAt: string;
}

export function AssistantPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [threadId, setThreadId] = useState<string | null>(null);
  // a chave só muda quando a pessoa troca de conversa (não quando a conversa nova ganha id)
  const [chatKey, setChatKey] = useState('new');
  const open_ = (id: string | null) => {
    setThreadId(id);
    setChatKey(id ?? `new-${Date.now()}`);
    setShowHistory(false);
  };
  const [showHistory, setShowHistory] = useState(false);
  const qc = useQueryClient();
  const { data: threads = [] } = useQuery({ queryKey: ['ai-threads'], queryFn: () => api.get<Thread[]>('/ai/threads'), enabled: open });

  const remove = async (id: string) => {
    await api.del(`/ai/threads/${id}`);
    qc.invalidateQueries({ queryKey: ['ai-threads'] });
    if (id === threadId) open_(null);
  };

  return (
    <Drawer open={open} onClose={onClose} width={460}>
      <div className="flex h-14 shrink-0 items-center gap-1 border-b border-ink-100 pl-4 pr-2">
        <Sparkles className="h-[18px] w-[18px] text-brand-500" />
        <p className="ml-1.5 flex-1 font-semibold">Assistente</p>
        <button title="Conversas anteriores" onClick={() => setShowHistory((s) => !s)} className={clsx('rounded-md p-2 hover:bg-ink-100', showHistory ? 'text-brand-600' : 'text-ink-500')}>
          <History className="h-4 w-4" />
        </button>
        <button
          title="Nova conversa"
          onClick={() => open_(null)}
          className="rounded-md p-2 text-ink-500 hover:bg-ink-100"
        >
          <Plus className="h-4 w-4" />
        </button>
        <button onClick={onClose} aria-label="Fechar" className="rounded-md p-2 text-ink-500 hover:bg-ink-100">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1">
        {showHistory ? (
          <div className="scroll-thin h-full overflow-y-auto p-2">
            {threads.map((t) => (
              <div key={t.id} className={clsx('group flex items-center rounded-lg', t.id === threadId ? 'bg-ink-100' : 'hover:bg-ink-50')}>
                <button
                  onClick={() => open_(t.id)}
                  className="min-w-0 flex-1 px-3 py-2 text-left"
                >
                  <p className="truncate text-sm font-medium">{t.title}</p>
                  <p className="text-2xs text-ink-400">{fromNow(t.updatedAt)}</p>
                </button>
                <button onClick={() => remove(t.id)} aria-label="Apagar conversa" className="mr-1 hidden rounded-md p-1.5 text-ink-400 hover:bg-bad-soft hover:text-bad group-hover:block">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            {!threads.length && <p className="px-3 py-6 text-center text-sm text-ink-400">Nenhuma conversa ainda.</p>}
          </div>
        ) : (
          <AssistantChat key={chatKey} threadId={threadId} onThreadChange={setThreadId} />
        )}
      </div>
    </Drawer>
  );
}
