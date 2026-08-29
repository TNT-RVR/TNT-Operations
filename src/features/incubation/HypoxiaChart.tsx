import { useEffect, useMemo, useState } from 'react'
import { useData } from '@/data/context'
import type { HypoxiaReadingRow } from '@/data/types'
import { collapseSpans } from '@/domain/hypoxia'

const TZ = 'America/Edmonton'
const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString('en-CA', { timeZone: TZ, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

// Token colours, so the chart follows the theme rather than fighting it.
const LINE = 'var(--data-teal)'
const AXIS = 'var(--border-default)'
const BAND = 'var(--data-teal)'
const PURGE = 'var(--data-sky)'
const MAINT = 'var(--text-faint)'
const LABEL = { fill: 'var(--text-faint)' } as const

const RANGES = [
  { key: '6h', label: '6H', hours: 6 },
  { key: '24h', label: '24H', hours: 24 },
  { key: '7d', label: '7D', hours: 24 * 7 },
  { key: '30d', label: '30D', hours: 24 * 30 },
] as const

type RangeKey = (typeof RANGES)[number]['key']

/**
 * Oxygen over time for one chamber.
 *
 * ── Why purges are drawn ─────────────────────────────────────────────────────
 *
 * A hypoxia trace is a sawtooth: oxygen creeps up as the chamber leaks, a purge
 * drops it, and it creeps again. Without marking the purges that reads as a
 * chamber repeatedly failing to hold its target. Shaded purge spans turn the
 * same picture into the mechanism working — and make a genuine problem (a
 * purge that did not bring O2 down, or a climb with no purge at all) visible
 * because it BREAKS the pattern rather than blending into it.
 *
 * Maintenance is shaded differently and for the opposite reason: in maintenance
 * the chamber is not regulating, so that stretch is not evidence of anything.
 *
 * Dependency-free SVG, like `ReadingsChart` next door — recharts is for the
 * Analysis screens; this is one line and two kinds of band.
 */
export function HypoxiaChart({
  chamberId,
  setpointPct,
  deadbandPct,
}: {
  chamberId: string
  setpointPct: number
  deadbandPct: number
}) {
  const { fetchHypoxiaReadings } = useData()
  const [range, setRange] = useState<RangeKey>('24h')
  const [rows, setRows] = useState<HypoxiaReadingRow[]>([])
  const [loading, setLoading] = useState(true)

  const hours = RANGES.find((r) => r.key === range)?.hours ?? 24

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const to = new Date()
    const from = new Date(to.getTime() - hours * 3600_000)
    fetchHypoxiaReadings(chamberId, from.toISOString(), to.toISOString())
      .then((r) => {
        if (!cancelled) setRows(r)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [chamberId, hours, fetchHypoxiaReadings])

  const picker = (
    <div className="mb-2 flex flex-wrap items-center gap-1">
      {RANGES.map((r) => (
        <button
          key={r.key}
          onClick={() => setRange(r.key)}
          className={`rounded-sm px-2 py-0.5 text-xs transition ${
            r.key === range
              ? 'bg-brand text-on-brand'
              : 'text-muted hover:bg-[color:var(--hover-wash)] hover:text-secondary'
          }`}
        >
          {r.label}
        </button>
      ))}
      {loading && <span className="ml-1 text-xs text-faint">loading…</span>}
    </div>
  )

  const chart = useMemo(() => build(rows, setpointPct, deadbandPct), [rows, setpointPct, deadbandPct])

  if (!chart) {
    return (
      <div>
        {picker}
        <div className="grid h-28 place-items-center rounded-lg border border-dashed border-default text-sm text-muted">
          {loading ? 'Loading readings…' : 'Not enough readings in this window to chart.'}
        </div>
      </div>
    )
  }

  const { W, H, path, bandY, bandH, xTicks, yTicks, spans, first, last, lo, hi } = chart

  return (
    <div>
      {picker}
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Oxygen over time">
        {/* Target band first, so the line and the spans sit over it. */}
        <rect x={PAD_L} y={bandY} width={W - PAD_L - PAD_R} height={bandH} fill={BAND} opacity={0.12} />

        {/* Purge and maintenance stretches. */}
        {spans.map((s, i) => (
          <rect
            key={i}
            x={s.x0}
            y={PAD_T}
            width={Math.max(s.x1 - s.x0, 1.5)}
            height={H - PAD_T - PAD_B}
            fill={s.kind === 'purge' ? PURGE : MAINT}
            opacity={s.kind === 'purge' ? 0.22 : 0.12}
          />
        ))}

        {yTicks.map((t) => (
          <g key={t.v}>
            <line x1={PAD_L} y1={t.y} x2={W - PAD_R} y2={t.y} stroke={AXIS} strokeWidth={0.5} opacity={0.5} />
            <text x={PAD_L - 5} y={t.y + 3} textAnchor="end" fontSize={9} style={LABEL}>
              {t.v}
            </text>
          </g>
        ))}
        {xTicks.map((t) => (
          <text key={t.x} x={t.x} y={H - 6} textAnchor="middle" fontSize={9} style={LABEL}>
            {t.label}
          </text>
        ))}

        <path d={path} fill="none" stroke={LINE} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
      </svg>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-0.5 w-3" style={{ background: LINE }} /> Oxygen
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-3" style={{ background: BAND, opacity: 0.3 }} /> Target {setpointPct}% ±{deadbandPct}
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-3" style={{ background: PURGE, opacity: 0.4 }} /> Purging
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-3" style={{ background: MAINT, opacity: 0.3 }} /> Maintenance
        </span>
        <span className="ml-auto">
          {lo.toFixed(1)}–{hi.toFixed(1)}% · {fmtTime(first)} → {fmtTime(last)}
        </span>
      </div>
    </div>
  )
}

const PAD_L = 30
const PAD_R = 10
const PAD_T = 10
const PAD_B = 20

/** Everything the SVG needs, or null when there is too little to draw. */
function build(rows: HypoxiaReadingRow[], setpointPct: number, deadbandPct: number) {
  const pts = [...rows].sort((a, b) => a.at.localeCompare(b.at))
  if (pts.length < 2) return null

  const W = 560
  const H = 170
  const t0 = Date.parse(pts[0].at)
  const t1 = Date.parse(pts[pts.length - 1].at)
  const span = Math.max(t1 - t0, 1)

  /*
   * The scale always includes the target band, even when the chamber never got
   * near it. A trace auto-scaled to its own values alone looks like it is
   * hugging the target no matter how far off it actually sat.
   */
  const values = pts.map((p) => p.o2Pct)
  const lo = Math.min(...values, setpointPct - deadbandPct)
  const hi = Math.max(...values, setpointPct + deadbandPct)
  const pad = Math.max((hi - lo) * 0.12, 0.4)
  const yLo = lo - pad
  const yHi = hi + pad

  const x = (iso: string) => PAD_L + ((Date.parse(iso) - t0) / span) * (W - PAD_L - PAD_R)
  const y = (v: number) => PAD_T + (1 - (v - yLo) / (yHi - yLo)) * (H - PAD_T - PAD_B)

  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.at).toFixed(1)},${y(p.o2Pct).toFixed(1)}`).join(' ')

  const bandTop = y(setpointPct + deadbandPct)
  const bandBottom = y(setpointPct - deadbandPct)

  /*
   * Purge and maintenance stretches, mapped to pixels. The collapsing itself is
   * domain logic (and tested there) — this only places it.
   */
  const spans = collapseSpans(pts).map((sp) => ({
    x0: x(sp.start),
    x1: x(sp.end),
    kind: sp.kind,
  }))

  const yTicks = [yLo, (yLo + yHi) / 2, yHi].map((v) => ({ v: v.toFixed(1), y: y(v) }))
  const xTicks = [pts[0], pts[Math.floor(pts.length / 2)], pts[pts.length - 1]].map((p) => ({
    x: x(p.at),
    label: new Date(p.at).toLocaleTimeString('en-CA', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }),
  }))

  return {
    W,
    H,
    path,
    bandY: bandTop,
    bandH: Math.max(bandBottom - bandTop, 1),
    xTicks,
    yTicks,
    spans,
    first: pts[0].at,
    last: pts[pts.length - 1].at,
    lo: Math.min(...values),
    hi: Math.max(...values),
  }
}
