import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { AlertTriangle, HelpCircle, Trash2 } from 'lucide-react';
import { Button } from './ui';

export interface ConfirmOptions {
  title: string;
  description?: ReactNode;
  /** Texto do botão de confirmar. Padrão: "Confirmar" */
  confirmLabel?: string;
  cancelLabel?: string;
  /** danger: ação destrutiva (vermelho). warn: atenção. default: neutro */
  tone?: 'danger' | 'warn' | 'default';
}

type Pending = ConfirmOptions & { resolve: (ok: boolean) => void };

// Store simples fora do React: qualquer função pode pedir confirmação com await
let current: Pending | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/**
 * Abre a janela de confirmação do sistema e espera a resposta.
 *   if (!(await confirmDialog({ title: 'Excluir demanda?', tone: 'danger' }))) return;
 */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  current?.resolve(false);
  return new Promise((resolve) => {
    current = { ...options, resolve };
    emit();
  });
}

function close(ok: boolean) {
  const p = current;
  current = null;
  emit();
  p?.resolve(ok);
}

const ICON = {
  danger: { icon: <Trash2 />, cls: 'bg-bad-soft text-bad' },
  warn: { icon: <AlertTriangle />, cls: 'bg-warn-soft text-warn' },
  default: { icon: <HelpCircle />, cls: 'bg-brand-50 text-brand-600' },
};

/** Montado uma vez na raiz do app */
export function ConfirmHost() {
  const pending = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
  const okRef = useRef<HTMLButtonElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (!pending) return setShown(false);
    const t = requestAnimationFrame(() => setShown(true));
    okRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(t);
      window.removeEventListener('keydown', onKey);
    };
  }, [pending]);

  if (!pending) return null;
  const tone = pending.tone ?? 'default';
  const { icon, cls } = ICON[tone];

  return createPortal(
    <div
      className={clsx('fixed inset-0 z-[60] flex items-center justify-center p-4 transition-colors duration-150', shown ? 'bg-ink-900/45 backdrop-blur-[2px]' : 'bg-ink-900/0')}
      onMouseDown={() => close(false)}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        onMouseDown={(e) => e.stopPropagation()}
        className={clsx(
          'w-full max-w-[420px] rounded-2xl bg-white p-6 shadow-pop transition duration-150 ease-out',
          shown ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-2 scale-[0.97] opacity-0',
        )}
      >
        <div className="flex gap-4">
          <span className={clsx('flex h-11 w-11 shrink-0 items-center justify-center rounded-full [&>svg]:h-5 [&>svg]:w-5', cls)}>{icon}</span>
          <div className="min-w-0 pt-0.5">
            <h2 id="confirm-title" className="text-[17px] font-semibold leading-snug text-ink-900">
              {pending.title}
            </h2>
            {pending.description && <div className="mt-1.5 text-sm leading-relaxed text-ink-500">{pending.description}</div>}
          </div>
        </div>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={() => close(false)}>
            {pending.cancelLabel ?? 'Voltar'}
          </Button>
          <Button ref={okRef} variant={tone === 'danger' ? 'danger' : 'primary'} onClick={() => close(true)}>
            {pending.confirmLabel ?? 'Confirmar'}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
