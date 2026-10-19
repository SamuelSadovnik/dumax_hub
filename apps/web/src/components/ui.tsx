import {
  forwardRef, useEffect, useLayoutEffect, useMemo, useRef, useState,
  type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { Check, ChevronDown, Loader2, Search, Star, X } from 'lucide-react';
import { initials } from '@dumax/shared';
import type { UserLite } from '@/lib/types';

// ───────────── Button ─────────────
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'dark';
const variants: Record<Variant, string> = {
  primary: 'bg-brand-500 text-white hover:bg-brand-600 active:bg-brand-700',
  secondary: 'border border-ink-200 bg-white text-ink-800 hover:bg-ink-50 hover:border-ink-300',
  ghost: 'text-ink-600 hover:bg-ink-100 hover:text-ink-900',
  danger: 'bg-bad text-white hover:brightness-95',
  dark: 'bg-ink-900 text-white hover:bg-ink-800',
};

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'icon' | 'icon-sm'; loading?: boolean; icon?: ReactNode }
>(function Button({ variant = 'primary', size = 'md', loading, icon, className, children, disabled, type = 'button', ...rest }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={clsx(
        'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' && 'h-8 px-2.5 text-[13px]',
        size === 'md' && 'h-9 px-3.5 text-sm',
        size === 'icon' && 'h-9 w-9',
        size === 'icon-sm' && 'h-7 w-7',
        variants[variant],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  );
});

// ───────────── Form ─────────────
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(function Input({ className, invalid, ...p }, ref) {
  return <input ref={ref} className={clsx('input', invalid && 'input-error', className)} {...p} />;
});
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(function Textarea({ className, invalid, rows = 3, ...p }, ref) {
  return <textarea ref={ref} rows={rows} className={clsx('input resize-y', invalid && 'input-error', className)} {...p} />;
});
export function Select({ className, children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className={clsx('relative', className)}>
      <select className="input appearance-none pr-8" {...p}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
    </div>
  );
}
export function Field({ label, hint, error, children, className, required }: { label: string; hint?: string; error?: string | null; children: ReactNode; className?: string; required?: boolean }) {
  return (
    <label className={clsx('block', className)}>
      <span className="label">
        {label}
        {required && <span className="text-bad"> *</span>}
      </span>
      {children}
      {error ? <span className="mt-1 block text-xs text-bad">{error}</span> : hint ? <span className="mt-1 block text-xs text-ink-500">{hint}</span> : null}
    </label>
  );
}
export function Checkbox({ checked, onChange, label, className }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; className?: string }) {
  return (
    <label className={clsx('inline-flex cursor-pointer select-none items-center gap-2 text-sm text-ink-700', className)}>
      <span
        className={clsx('flex h-4 w-4 shrink-0 items-center justify-center rounded border transition', checked ? 'border-brand-500 bg-brand-500' : 'border-ink-300 bg-white')}
        onClick={(e) => {
          e.preventDefault();
          onChange(!checked);
        }}
      >
        {checked && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
      </span>
      {label && <span onClick={(e) => (e.preventDefault(), onChange(!checked))}>{label}</span>}
    </label>
  );
}

// ───────────── Surfaces ─────────────
export function Card({ className, children, ...p }: { className?: string; children: ReactNode } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={clsx('card', className)} {...p}>
      {children}
    </div>
  );
}

/** Painel com cabeçalho (título + ações) */
export function Panel({ title, subtitle, actions, children, className, bodyClassName }: { title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <section className={clsx('card overflow-hidden', className)}>
      {(title || actions) && (
        <header className="flex min-h-[56px] items-center gap-3 border-b border-ink-100 px-5 py-3">
          <div className="min-w-0 flex-1">
            {title && <h2 className="truncate text-base font-semibold text-ink-900">{title}</h2>}
            {subtitle && <p className="truncate text-xs text-ink-500">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
        </header>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

const TONES = {
  neutral: 'bg-ink-100 text-ink-600',
  brand: 'bg-brand-50 text-brand-700',
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  bad: 'bg-bad-soft text-bad',
} as const;
export function Badge({ children, color, tone, dot, className, title }: { children: ReactNode; color?: string; tone?: keyof typeof TONES; dot?: boolean; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={clsx('inline-flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-xs font-medium', !color && TONES[tone ?? 'neutral'], className)}
      style={color ? { background: `${color}17`, color } : undefined}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'currentColor' }} />}
      {children}
    </span>
  );
}

const AVATAR_COLORS = ['#2D3FE0', '#0E8A8A', '#7C5CFF', '#C2410C', '#1F9254', '#BE185D', '#4F46E5', '#B45309'];
export function Avatar({ user, size = 32, online, className, color: forced }: { user: Pick<UserLite, 'name' | 'avatarUrl'> & { id?: string }; size?: number; online?: boolean; className?: string; /** cor fixa das iniciais (ex.: cor do perfil) */ color?: string }) {
  const color = useMemo(() => {
    const key = user.id ?? user.name;
    let h = 0;
    for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return forced ?? AVATAR_COLORS[h % AVATAR_COLORS.length];
  }, [user.id, user.name, forced]);
  return (
    <span className={clsx('relative inline-flex shrink-0', className)} style={{ width: size, height: size }}>
      {user.avatarUrl ? (
        <img src={user.avatarUrl} alt="" className="h-full w-full rounded-full object-cover" />
      ) : (
        <span className="flex h-full w-full items-center justify-center rounded-full font-semibold text-white" style={{ background: color, fontSize: Math.max(10, size * 0.36) }}>
          {initials(user.name)}
        </span>
      )}
      {online !== undefined && (
        <span className={clsx('absolute bottom-0 right-0 rounded-full ring-2 ring-white', online ? 'bg-ok' : 'bg-ink-300')} style={{ width: Math.max(8, size * 0.28), height: Math.max(8, size * 0.28) }} />
      )}
    </span>
  );
}

/** Foto com anel colorido (ex.: cor do perfil). O anel é sombra: não altera o tamanho nem deforma a foto. */
export function RingAvatar({ user, size = 40, color, className }: { user: Pick<UserLite, 'name' | 'avatarUrl'> & { id?: string }; size?: number; color: string; className?: string }) {
  const ring = size >= 56 ? 4 : 3;
  return (
    <span className={clsx('relative inline-flex shrink-0 rounded-full', className)} style={{ width: size, height: size, boxShadow: `0 0 0 2px #fff, 0 0 0 ${2 + ring}px ${color}` }}>
      <Avatar user={user} size={size} color={color} />
    </span>
  );
}

export function AvatarStack({ users, max = 4, size = 24, color }: { users: UserLite[]; max?: number; size?: number; color?: string }) {
  return (
    <div className="flex -space-x-1.5">
      {users.slice(0, max).map((u) => (
        <Avatar key={u.id} user={u} size={size} color={color} className="rounded-full ring-2 ring-white" />
      ))}
      {users.length > max && (
        <span className="flex items-center justify-center rounded-full bg-ink-100 text-2xs font-semibold text-ink-600 ring-2 ring-white" style={{ width: size, height: size }}>
          +{users.length - max}
        </span>
      )}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx('h-5 w-5 animate-spin text-ink-400', className)} />;
}

export function PageLoader() {
  return (
    <div className="flex h-64 items-center justify-center">
      <Spinner className="h-6 w-6" />
    </div>
  );
}

export function EmptyState({ icon, title, text, action, compact }: { icon?: ReactNode; title: string; text?: string; action?: ReactNode; compact?: boolean }) {
  return (
    <div className={clsx('flex flex-col items-center justify-center px-6 text-center', compact ? 'py-8' : 'py-14')}>
      {icon && <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-ink-100 text-ink-500 [&>svg]:h-5 [&>svg]:w-5">{icon}</div>}
      <p className="text-sm font-semibold text-ink-800">{title}</p>
      {text && <p className="mt-1 max-w-sm text-sm text-ink-500">{text}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: string }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[28px] font-bold leading-[1.1] text-ink-900">{title}</h1>
        {subtitle && <p className="mt-1.5 text-sm text-ink-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Indicador numérico: rótulo, valor e variação */
export function StatCard({
  label, value, hint, icon, tone = 'default', delta, deltaSuffix = '', invertDelta,
}: {
  label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode; tone?: 'default' | 'danger' | 'success' | 'brand' | 'warn';
  delta?: number | null; deltaSuffix?: string; invertDelta?: boolean;
}) {
  const valueTone = { default: 'text-ink-900', danger: 'text-bad', success: 'text-ok', brand: 'text-brand-600', warn: 'text-warn' }[tone];
  const good = delta !== undefined && delta !== null && (invertDelta ? delta < 0 : delta > 0);
  return (
    <div className="card px-5 py-4">
      <div className="flex items-center gap-1.5 text-[13px] text-ink-500">
        {icon && <span className="[&>svg]:h-4 [&>svg]:w-4">{icon}</span>}
        {label}
      </div>
      <div className="mt-1.5 flex items-baseline gap-2">
        <span className={clsx('num whitespace-nowrap font-display text-[30px] font-bold leading-none', valueTone)}>{value}</span>
        {delta !== undefined && delta !== null && delta !== 0 && (
          <span className={clsx('num text-xs font-medium', good ? 'text-ok' : 'text-bad')}>
            {delta > 0 ? '▲' : '▼'} {Math.abs(Math.round(delta * 10) / 10)}
            {deltaSuffix}
          </span>
        )}
      </div>
      {hint && <p className="mt-1.5 text-xs text-ink-500">{hint}</p>}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, items, size = 'md' }: { value: T; onChange: (v: T) => void; items: { value: T; label: ReactNode; count?: number }[]; size?: 'sm' | 'md' }) {
  return (
    <div className="inline-flex rounded-lg bg-ink-100 p-0.5">
      {items.map((it) => (
        <button
          key={it.value}
          type="button"
          onClick={() => onChange(it.value)}
          className={clsx(
            'inline-flex items-center gap-1.5 rounded-md font-medium transition',
            size === 'sm' ? 'h-7 px-2.5 text-[13px]' : 'h-8 px-3 text-sm',
            value === it.value ? 'bg-white text-ink-900 shadow-sm ring-1 ring-ink-200/70' : 'text-ink-500 hover:text-ink-900',
          )}
        >
          {it.label}
          {it.count !== undefined && <span className={clsx('num text-xs', value === it.value ? 'text-brand-600' : 'text-ink-400')}>{it.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Stars({ value, onChange, size = 16 }: { value: number | null; onChange?: (v: number) => void; size?: number }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" disabled={!onChange} onClick={() => onChange?.(n)} className={clsx(onChange && 'transition hover:scale-110')}>
          <Star style={{ width: size, height: size }} className={clsx(value && n <= value ? 'fill-amber-400 text-amber-400' : 'text-ink-300')} />
        </button>
      ))}
    </div>
  );
}

export function ProgressBar({ value, color = '#2D3FE0', marker, className }: { value: number; color?: string; marker?: number; className?: string }) {
  return (
    <div className={clsx('relative h-1.5 w-full rounded-full bg-ink-100', className)}>
      <div className="h-full rounded-full transition-[width]" style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: color }} />
      {marker !== undefined && <span className="absolute -top-0.5 h-2.5 w-0.5 rounded bg-ink-500" style={{ left: `calc(${Math.min(1, marker) * 100}% - 1px)` }} title="Onde deveria estar pelo prazo" />}
    </div>
  );
}

/** Anel da nota de desempenho */
export function ScoreRing({ score, size = 56, color }: { score: number | null; size?: number; color: string }) {
  const r = size / 2 - 4;
  const c = 2 * Math.PI * r;
  return (
    <span className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#EEF0F4" strokeWidth={4} />
        {score !== null && <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={4} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - score / 100)} />}
      </svg>
      <span className="num absolute font-semibold" style={{ fontSize: size * 0.3, color: score === null ? '#9AA1B5' : '#0D1330' }}>
        {score ?? '—'}
      </span>
    </span>
  );
}

// ───────────── Overlays ─────────────
export function Modal({ open, onClose, title, children, footer, size = 'md' }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  useEffect(() => {
    if (!open) return;
    const fn = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink-900/40 sm:items-center sm:p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        onMouseDown={(e) => e.stopPropagation()}
        className={clsx(
          'flex max-h-[92vh] w-full animate-pop flex-col rounded-t-2xl bg-white shadow-pop sm:rounded-xl',
          size === 'sm' && 'sm:max-w-md',
          size === 'md' && 'sm:max-w-xl',
          size === 'lg' && 'sm:max-w-3xl',
          size === 'xl' && 'sm:max-w-5xl',
        )}
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-ink-100 px-5">
          <h3 className="text-base font-semibold">{title}</h3>
          <button onClick={onClose} aria-label="Fechar" className="rounded-md p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="scroll-thin flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex shrink-0 justify-end gap-2 border-t border-ink-100 px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function Drawer({ open, onClose, children, width = 560 }: { open: boolean; onClose: () => void; children: ReactNode; width?: number }) {
  useEffect(() => {
    if (!open) return;
    const fn = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-40 flex justify-end bg-ink-900/25" onMouseDown={onClose}>
      <div onMouseDown={(e) => e.stopPropagation()} className="flex h-full w-full animate-slide-in flex-col bg-white shadow-pop" style={{ maxWidth: width }}>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** Menu suspenso ancorado num botão (estilo WhatsApp/Slack) */
export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  danger?: boolean;
  hidden?: boolean;
}
export function Menu({
  trigger, items, align = 'right', header, side = 'auto', matchWidth, className,
}: {
  trigger: (open: boolean) => ReactNode; items: MenuItem[]; align?: 'left' | 'right'; header?: ReactNode;
  /** 'top' abre sempre para cima (ex.: rodapé do menu lateral) */
  side?: 'auto' | 'top'; matchWidth?: boolean; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const w = matchWidth ? Math.max(208, r.width) : 208;
    const left = align === 'right' ? Math.max(8, r.right - w) : Math.min(window.innerWidth - w - 8, r.left);
    // Para cima: ancora pela base (não depende da altura do menu), sem "flutuar" longe do botão
    const up = side === 'top' || r.bottom + 4 + 260 > window.innerHeight;
    setPos(up ? { bottom: window.innerHeight - r.top + 6, left, width: w } : { top: r.bottom + 4, left, width: w });
  }, [open, align, side, matchWidth]);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);
  return (
    <>
      <span
        ref={btn}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className={clsx('inline-flex', className)}
      >
        {trigger(open)}
      </span>
      {open &&
        pos &&
        createPortal(
          <div className="fixed inset-0 z-[60]" onMouseDown={() => setOpen(false)}>
            <div onMouseDown={(e) => e.stopPropagation()} className="fixed animate-pop overflow-hidden rounded-xl border border-ink-200 bg-white py-1 shadow-pop" style={pos}>
              {header}
              {items
                .filter((i) => !i.hidden)
                .map((i) => (
                  <button
                    key={i.label}
                    onClick={() => {
                      setOpen(false);
                      i.onClick();
                    }}
                    className={clsx('flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-ink-50 [&>svg]:h-4 [&>svg]:w-4', i.danger ? 'text-bad' : 'text-ink-700')}
                  >
                    {i.icon}
                    {i.label}
                  </button>
                ))}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

// ───────────── User picker ─────────────
export function UserPicker({
  users, value, onChange, placeholder = 'Selecione uma pessoa', multiple, invalid,
}: {
  users: UserLite[]; value: string | string[] | null; onChange: (v: string | string[] | null) => void; placeholder?: string; multiple?: boolean; invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const selected = Array.isArray(value) ? value : value ? [value] : [];
  useEffect(() => {
    const fn = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, []);
  const filtered = users.filter((u) => `${u.name} ${u.jobTitle ?? ''}`.toLowerCase().includes(q.toLowerCase()));
  const toggle = (id: string) => {
    if (multiple) onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);
    else {
      onChange(id);
      setOpen(false);
    }
  };
  const selUsers = users.filter((u) => selected.includes(u.id));
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} className={clsx('input flex h-auto min-h-[36px] flex-wrap items-center gap-1.5 py-1 text-left', invalid && 'input-error')}>
        {selUsers.length === 0 && <span className="text-ink-400">{placeholder}</span>}
        {!multiple && selUsers[0] && (
          <span className="flex items-center gap-2">
            <Avatar user={selUsers[0]} size={20} /> {selUsers[0].name}
          </span>
        )}
        {multiple &&
          selUsers.map((u) => (
            <span key={u.id} className="flex items-center gap-1 rounded-md bg-ink-100 py-0.5 pl-0.5 pr-1.5 text-xs font-medium">
              <Avatar user={u} size={18} /> {u.name.split(' ')[0]}
              <X
                className="h-3 w-3 text-ink-400 hover:text-ink-800"
                onClick={(e) => {
                  e.stopPropagation();
                  toggle(u.id);
                }}
              />
            </span>
          ))}
        <ChevronDown className="ml-auto h-4 w-4 text-ink-400" />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-full animate-pop overflow-hidden rounded-lg border border-ink-200 bg-white shadow-pop">
          <div className="flex items-center gap-2 border-b border-ink-100 px-3">
            <Search className="h-4 w-4 text-ink-400" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar pessoa" className="h-9 w-full text-sm outline-none" />
          </div>
          <div className="scroll-thin max-h-64 overflow-y-auto py-1">
            {filtered.map((u) => (
              <button key={u.id} type="button" onClick={() => toggle(u.id)} className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm hover:bg-ink-50">
                <Avatar user={u} size={26} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{u.name}</span>
                  {u.jobTitle && <span className="block truncate text-xs text-ink-500">{u.jobTitle}</span>}
                </span>
                {selected.includes(u.id) && <Check className="h-4 w-4 text-brand-500" />}
              </button>
            ))}
            {!filtered.length && <p className="px-3 py-3 text-sm text-ink-400">Ninguém encontrado</p>}
          </div>
        </div>
      )}
    </div>
  );
}
