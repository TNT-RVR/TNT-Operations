import type { ReactNode } from 'react'
import { Search, X, Lock } from 'lucide-react'

/** Compact controlled search input for list pages. */
export function SearchBar({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="relative w-full max-w-xs">
      <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
      <input
        className="w-full rounded-lg border border-slate-300 bg-white py-1.5 pl-8 pr-7 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? 'Search…'}
      />
      {value && (
        <button onClick={() => onChange('')} title="Clear" className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
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
    <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-200 bg-white px-4 py-4 md:px-6">
      <div>
        <h1 className="text-xl font-bold md:text-2xl">{title}</h1>
        {subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions}
    </div>
  )
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="grid place-items-center rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
      {children}
    </div>
  )
}

/** Shown when a user lacks view permission for a module. */
export function NoAccess() {
  return (
    <div className="grid h-full place-items-center p-8 text-center">
      <div className="max-w-sm">
        <Lock className="mx-auto mb-3 text-slate-400" size={32} />
        <h2 className="font-bold text-slate-700">No access</h2>
        <p className="mt-1 text-sm text-slate-500">You don't have permission to view this section. Ask an admin to grant access in Users &amp; Settings.</p>
      </div>
    </div>
  )
}

type Tone = 'brand' | 'green' | 'amber' | 'red' | 'blue'
const TONES: Record<Tone, string> = {
  brand: 'bg-brand text-white', // readability: brand bg → white text
  green: 'bg-emerald-100 text-emerald-800',
  amber: 'bg-amber-100 text-amber-800',
  red: 'bg-red-100 text-red-800',
  blue: 'bg-sky-100 text-sky-800',
}

export function Badge({ children, tone = 'brand' }: { children: ReactNode; tone?: Tone }) {
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${TONES[tone]}`}>{children}</span>
}

/** Dashboard stat tile. */
export function StatTile({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: string; tone?: 'default' | 'warn' | 'good' }) {
  const ring = tone === 'warn' ? 'border-amber-300' : tone === 'good' ? 'border-emerald-300' : 'border-slate-200'
  return (
    <div className={`rounded-xl border ${ring} bg-white p-4 shadow-sm`}>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-bold text-slate-900">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-500">{hint}</div>}
    </div>
  )
}

/** Horizontal fill gauge (incubation progress, humidity, etc.). */
export function Gauge({ pct, tone = 'brand' }: { pct: number; tone?: 'brand' | 'green' | 'amber' | 'red' }) {
  const clamped = Math.max(0, Math.min(100, pct))
  const color = tone === 'red' ? 'bg-red-500' : tone === 'amber' ? 'bg-amber-500' : tone === 'green' ? 'bg-emerald-500' : 'bg-brand'
  return (
    <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
      <div className={`h-full ${color}`} style={{ width: `${clamped}%` }} />
    </div>
  )
}

/** Modal shell. */
export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 md:p-8" onClick={onClose}>
      <div className={`w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} rounded-xl bg-white shadow-xl`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h2 className="font-bold">{title}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X size={20} /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}
