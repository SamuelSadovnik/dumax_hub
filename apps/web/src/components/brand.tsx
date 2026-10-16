import clsx from 'clsx';

/**
 * Marca Dumax: um "D" cujo miolo são barras crescendo —
 * o hub é sobre acompanhar o desempenho das pessoas.
 */
export function LogoMark({ size = 28, className, tone = 'brand' }: { size?: number; className?: string; tone?: 'brand' | 'white' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} aria-hidden>
      <path d="M5 4h10.5a12 12 0 0 1 0 24H5z" fill={tone === 'white' ? '#fff' : '#2D3FE0'} />
      <g fill={tone === 'white' ? '#0D1330' : '#fff'}>
        <rect x="9" y="18" width="3" height="6" rx="1.1" />
        <rect x="13.8" y="13.8" width="3" height="10.2" rx="1.1" />
        <rect x="18.6" y="9.6" width="3" height="14.4" rx="1.1" />
      </g>
    </svg>
  );
}

export function Logo({ light, size = 26, className }: { light?: boolean; size?: number; className?: string }) {
  return (
    <span className={clsx('inline-flex items-center gap-2', className)}>
      <LogoMark size={size} />
      <span className={clsx('text-[19px] font-bold leading-none tracking-[-0.03em]', light ? 'text-white' : 'text-ink-900')}>
        dumax
        <span className={clsx('ml-[3px] font-medium', light ? 'text-brand-300' : 'text-brand-500')}>hub</span>
      </span>
    </span>
  );
}
