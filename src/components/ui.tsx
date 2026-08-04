import type { ButtonHTMLAttributes, CSSProperties, ReactNode, SelectHTMLAttributes, InputHTMLAttributes } from 'react'
import { forwardRef } from 'react'
import { Search, X, Lock } from 'lucide-react'
import { BeeMark } from './BeeMark'

/**
 * Token-driven UI primitives for TNT Pollination. Every colour/space/radius
 * comes from src/styles/tokens.css (via Tailwind's mapped utilities or a
 * var(--*) inline style) — no raw hex here. Dark-default, `.on-light` correct.
 */

/** Compact controlled search input for list pages. */
export function SearchBar({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="relative w-full max-w-xs">
      <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
      <input
        className="input py-1.5 pl-8 pr-7 text-sm"
        style={{ minHeight: 0 }}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? 'Search…'}
      />
      {value && (
        <button onClick={() => onChange('')} title="Clear" className="absolute right-2 top-1/2 -translate-y-1/2 text-faint hover:text-secondary">
          <X size={14} />
        </button>
      )}
    </div>
  )
}

export function matchesQuery(query: string, ...fields: (string | number | null | undefined)[]): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return fields.some((f) => f != null && String(f).toLowerCase().includes(q))
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 border-b border-subtle bg-surface px-4 py-4 md:px-6">
      <div>
        <h1 className="font-display text-xl font-bold text-primary md:text-2xl">{title}</h1>
        {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
      </div>
      {actions}
    </div>
  )
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="grid place-items-center rounded-lg border border-dashed border-default bg-raised p-8 text-center text-sm text-muted">
      {children}
    </div>
  )
}

/** Shown when a user lacks view permission for a module. */
export function NoAccess() {
  return (
    <div className="grid h-full place-items-center p-8 text-center">
      <div className="max-w-sm">
        <Lock className="mx-auto mb-3 text-faint" size={32} />
        <h2 className="font-display font-bold text-secondary">No access</h2>
        <p className="mt-1 text-sm text-muted">You don't have permission to view this section. Ask an admin to grant access in Users &amp; Settings.</p>
      </div>
    </div>
  )
}

// ── Buttons ──────────────────────────────────────────────────────────────────
type ButtonVariant = 'primary' | 'ghost' | 'danger'
type ButtonSize = 'sm' | 'md'
export function Button({
  children,
  variant = 'primary',
  size = 'md',
  className = '',
  ...rest
}: { children: ReactNode; variant?: ButtonVariant; size?: ButtonSize } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const base = variant === 'primary' ? 'btn-primary' : variant === 'danger' ? 'btn' : 'btn-ghost'
  const danger = variant === 'danger' ? 'text-on-brand' : ''
  const sz = size === 'sm' ? 'min-h-0 px-3 py-1.5 text-sm' : ''
  return (
    <button
      className={`${base} ${danger} ${sz} ${className}`}
      style={variant === 'danger' ? { background: 'var(--red-500)' } : undefined}
      {...rest}
    >
      {children}
    </button>
  )
}

export function IconButton({ label, children, onClick, className = '' }: { label: string; children: ReactNode; onClick?: () => void; className?: string }) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`inline-grid h-9 w-9 place-items-center rounded-sm text-secondary outline-none transition hover:bg-[color:var(--hover-wash)] hover:text-primary focus-visible:ring-2 focus-visible:ring-brand ${className}`}
    >
      {children}
    </button>
  )
}

// ── Form controls ────────────────────────────────────────────────────────────
/** Forwards its ref so callers can focus the field (e.g. right after a scan). */
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className = '', ...rest }, ref) {
    return <input ref={ref} className={`input ${className}`} {...rest} />
  },
)

export function Select({ className = '', children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={`input ${className}`} {...rest}>
      {children}
    </select>
  )
}

export function Checkbox({ label, checked, onChange }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm text-secondary">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  )
}

/** Accessible on/off switch (settings, theme). */
export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-pill outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand"
      style={{ background: checked ? 'var(--brand)' : 'var(--border-strong)' }}
    >
      <span
        className="inline-block h-5 w-5 transform rounded-pill bg-white shadow-sm transition-transform"
        style={{ transform: checked ? 'translateX(22px)' : 'translateX(2px)' }}
      />
    </button>
  )
}

// ── Data readouts ────────────────────────────────────────────────────────────
type Tone = 'brand' | 'green' | 'amber' | 'red' | 'blue' | 'neutral'
const CHIP: Record<Tone, { fg: string; bg: string; bd: string }> = {
  brand: { fg: 'var(--brand-chip-fg)', bg: 'var(--brand-subtle)', bd: 'var(--brand-chip-bd)' },
  green: { fg: 'var(--ok-fg)', bg: 'var(--ok-bg)', bd: 'var(--ok-bd)' },
  amber: { fg: 'var(--warn-fg)', bg: 'var(--warn-bg)', bd: 'var(--warn-bd)' },
  red: { fg: 'var(--danger-fg)', bg: 'var(--danger-bg)', bd: 'var(--danger-bd)' },
  blue: { fg: 'var(--info-fg)', bg: 'var(--info-bg)', bd: 'var(--info-bd)' },
  neutral: { fg: 'var(--neutral-fg)', bg: 'var(--chip-bg)', bd: 'var(--border-subtle)' },
}

export function Badge({ children, tone = 'brand' }: { children: ReactNode; tone?: Tone }) {
  const c = CHIP[tone]
  return (
    <span
      className="inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 font-mono uppercase"
      style={{ fontSize: 'var(--text-2xs)', letterSpacing: 'var(--ls-wide)', color: c.fg, background: c.bg, border: `1px solid ${c.bd}` }}
    >
      {children}
    </span>
  )
}

/** Neutral pill tag (filters, metadata). */
export function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-xs text-secondary" style={{ background: 'var(--chip-bg)' }}>
      {children}
    </span>
  )
}

/** KPI readout — the workhorse. Mono value, uppercase label, optional delta. */
export function Stat({
  label,
  value,
  unit,
  delta,
  hint,
  tone = 'default',
}: {
  label: string
  value: ReactNode
  unit?: string
  delta?: { value: string; dir: 'up' | 'down' | 'flat' }
  hint?: string
  tone?: 'default' | 'warn' | 'good' | 'bad'
}) {
  const edge = tone === 'warn' ? 'var(--warn-bd)' : tone === 'good' ? 'var(--ok-bd)' : tone === 'bad' ? 'var(--danger-bd)' : 'var(--border-subtle)'
  const deltaColor = !delta ? '' : delta.dir === 'up' ? 'var(--ok-fg)' : delta.dir === 'down' ? 'var(--danger-fg)' : 'var(--text-muted)'
  return (
    <div className="rounded-lg bg-raised p-4" style={{ border: `1px solid ${edge}`, boxShadow: 'var(--shadow-sm)' }}>
      <div className="label mb-2">{label}</div>
      <div className="flex items-baseline gap-1.5">
        <span className="font-mono text-2xl font-semibold tabular text-primary">{value}</span>
        {unit && <span className="font-mono text-sm text-muted">{unit}</span>}
      </div>
      <div className="mt-1 flex items-center gap-2">
        {delta && (
          <span className="font-mono text-xs tabular" style={{ color: deltaColor }}>
            {delta.dir === 'up' ? '▲' : delta.dir === 'down' ? '▼' : '±'} {delta.value}
          </span>
        )}
        {hint && <span className="text-xs text-muted">{hint}</span>}
      </div>
    </div>
  )
}

/** Back-compat KPI tile (older call sites). Prefer <Stat>. */
export function StatTile({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: string; tone?: 'default' | 'warn' | 'good' }) {
  return <Stat label={label} value={value} hint={hint} tone={tone} />
}

/** Horizontal fill bar (incubation progress, humidity, coverage…). */
export function ProgressBar({ pct, tone = 'brand', label }: { pct: number; tone?: 'brand' | 'green' | 'amber' | 'red'; label?: string }) {
  const clamped = Math.max(0, Math.min(100, pct))
  const color = tone === 'red' ? 'var(--red-500)' : tone === 'amber' ? 'var(--amber-500)' : tone === 'green' ? 'var(--green-500)' : 'var(--brand)'
  return (
    <div>
      {label && <div className="label mb-1">{label}</div>}
      <div className="h-2.5 w-full overflow-hidden rounded-pill" style={{ background: 'var(--bg-inset)' }}>
        <div className="h-full rounded-pill" style={{ width: `${clamped}%`, background: color, transition: 'width var(--dur-slow) var(--ease-out)' }} />
      </div>
    </div>
  )
}

/** Legacy name kept for existing call sites. */
export function Gauge({ pct, tone = 'brand' }: { pct: number; tone?: 'brand' | 'green' | 'amber' | 'red' }) {
  return <ProgressBar pct={pct} tone={tone} />
}

// ── Containers ───────────────────────────────────────────────────────────────
export function Card({
  children,
  className = '',
  featured = false,
  interactive = false,
  style,
}: {
  children: ReactNode
  className?: string
  featured?: boolean
  interactive?: boolean
  style?: CSSProperties
}) {
  return (
    <div
      className={`card ${interactive ? 'transition hover:-translate-y-0.5 hover:border-default' : ''} ${className}`}
      style={{ ...(featured ? { borderTop: '2px solid var(--brand)', boxShadow: 'var(--glow-brand-soft)' } : null), ...style }}
    >
      {children}
    </div>
  )
}

/** Brand logo: bee mark + wordmark. The bee is the one brand glyph. */
export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="shrink-0" style={{ color: 'var(--logo-ink)' }}>
        <BeeMark size={26} />
      </span>
      {!compact && (
        <span className="font-display font-bold leading-none tracking-tight text-primary">
          TNT <span className="text-brand">Pollination</span>
        </span>
      )}
    </span>
  )
}

/** Modal shell. */
export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-[1000] flex items-start justify-center overflow-y-auto p-4 md:p-8" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={onClose}>
      <div
        className={`w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} rounded-lg bg-raised`}
        style={{ border: '1px solid var(--border-default)', boxShadow: 'var(--shadow-xl)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-subtle px-5 py-3">
          <h2 className="font-display font-bold text-primary">{title}</h2>
          <button onClick={onClose} className="text-faint transition hover:text-primary">
            <X size={20} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}
