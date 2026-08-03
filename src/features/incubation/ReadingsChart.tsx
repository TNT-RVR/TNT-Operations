import { useState } from 'react'
import type { SensorReading } from '@/data/types'

const TZ = 'America/Edmonton'
const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString('en-CA', { timeZone: TZ, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

// Chart colours come from the token layer so the chart tracks light/dark.
const LINE = 'var(--data-honey)'
const AXIS = 'var(--border-default)'
const REF = 'var(--text-faint)'
const BAND = 'var(--data-honey)'
const LABEL = { fill: 'var(--text-faint)' } as const

/** Selectable windows, newest-anchored. `hours: null` = everything held. */
const RANGES = [
  { key: '1h', label: '1H', hours: 1 },
  { key: '6h', label: '6H', hours: 6 },
  { key: '24h', label: '24H', hours: 24 },
  { key: '7d', label: '7D', hours: 24 * 7 },
  { key: '30d', label: '30D', hours: 24 * 30 },
  { key: 'all', label: 'ALL', hours: null },
] as const

type RangeKey = (typeof RANGES)[number]['key']

/**
 * Compact, dependency-free temperature-over-time chart for one incubator.
 *
 * Drawn as a single clean line — no per-reading dots. At the poll rates in use
 * a day of data is ~100 points, which rendered as a solid band of overlapping
 * circles and hid the shape of the curve. The target band (target ± tolerance)
 * is shaded instead, so you can still see at a glance where the temperature
 * left range without any per-point marks.
 *
 * Windows are anchored to the NEWEST reading rather than the wall clock: idle
 * incubators are only polled every few hours, so "last 6 hours" of real time is
 * often empty while the last 6 hours *of data* is always meaningful.
 */
export function ReadingsChart({
  readings,
  targetC,
  tolerance = 1.5,
}: {
  readings: SensorReading[]
  /** Target for the current mode, or null when the incubator is off (no target). */
  targetC: number | null
  tolerance?: number
}) {
  const [range, setRange] = useState<RangeKey>('24h')

  const all = [...readings].sort((a, b) => a.at.localeCompare(b.at))
  const hours = RANGES.find((r) => r.key === range)?.hours ?? null
  const newest = all.length ? Date.parse(all[all.length - 1].at) : 0
  const pts = hours == null ? all : all.filter((p) => Date.parse(p.at) >= newest - hours * 3600_000)

  const picker = (
    <div className="mb-2 flex flex-wrap items-center gap-1">
      {RANGES.map((r) => (
        <button
          key={r.key}
          onClick={() => setRange(r.key)}
          className={`rounded-sm px-2 py-0.5 font-mono text-xs tracking-wide transition ${
            r.key === range
              ? 'bg-brand text-on-brand'
              : 'text-muted hover:bg-[color:var(--hover-wash)] hover:text-secondary'
          }`}
        >
          {r.label}
        </button>
      ))}
    </div>
  )

  if (pts.length < 2) {
    return (
      <div>
        {picker}
        <div className="grid h-28 place-items-center rounded-lg border border-dashed border-default text-sm text-muted">
          {all.length < 2 ? 'Not enough readings to chart yet.' : 'No readings in this window — try a longer range.'}
        </div>
      </div>
    )
  }

  const W = 560
  const H = 160
  const padL = 34
  const padR = 12
  const padT = 12
  const padB = 24

  const temps = pts.map((p) => p.tempC)
  const times = pts.map((p) => Date.parse(p.at))
  // With no target (incubator off) the scale follows the data alone, so an
  // irrelevant target doesn't stretch the axis.
  const scaleRefs = targetC == null ? temps : [...temps, targetC]
  const tMin = Math.min(...scaleRefs)
  const tMax = Math.max(...scaleRefs)
  const span = tMax - tMin || 1
  // Pad the temp range a little so the line isn't flush to the edges.
  const yLo = tMin - span * 0.15
  const yHi = tMax + span * 0.15
  const xMin = times[0]
  const xMax = times[times.length - 1]
  const xSpan = xMax - xMin || 1

  const x = (t: number) => padL + ((t - xMin) / xSpan) * (W - padL - padR)
  const y = (v: number) => padT + (1 - (v - yLo) / (yHi - yLo)) * (H - padT - padB)

  const linePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(times[i]).toFixed(1)} ${y(p.tempC).toFixed(1)}`).join(' ')
  // Clamp the shaded band to the plot area so it never bleeds past the axes.
  const yTarget = targetC == null ? null : y(targetC)
  const bandTop = targetC == null ? 0 : Math.max(padT, y(targetC + tolerance))
  const bandBottom = targetC == null ? 0 : Math.min(H - padB, y(targetC - tolerance))

  return (
    <div>
      {picker}
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Temperature over time">
        {/* in-range band (target ± tolerance) — omitted when there's no target */}
        {targetC != null && bandBottom > bandTop && (
          <rect x={padL} y={bandTop} width={W - padL - padR} height={bandBottom - bandTop} fill={BAND} opacity={0.1} />
        )}

        {/* axes */}
        <line x1={padL} y1={padT} x2={padL} y2={H - padB} stroke={AXIS} />
        <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} stroke={AXIS} />

        {/* target reference line — an incubator that's off has no target */}
        {yTarget != null && (
          <>
            <line x1={padL} y1={yTarget} x2={W - padR} y2={yTarget} stroke={REF} strokeDasharray="4 3" />
            <text x={W - padR} y={yTarget - 4} textAnchor="end" style={LABEL} fontSize="10" fontFamily="var(--font-mono)">
              target {targetC}°C
            </text>
          </>
        )}

        {/* y range labels */}
        <text x={padL - 6} y={y(tMax) + 3} textAnchor="end" style={LABEL} fontSize="10" fontFamily="var(--font-mono)">
          {tMax.toFixed(1)}
        </text>
        <text x={padL - 6} y={y(tMin) + 3} textAnchor="end" style={LABEL} fontSize="10" fontFamily="var(--font-mono)">
          {tMin.toFixed(1)}
        </text>

        {/* temperature line */}
        <path d={linePath} fill="none" stroke={LINE} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />

        {/* x end labels */}
        <text x={padL} y={H - 8} textAnchor="start" style={LABEL} fontSize="10" fontFamily="var(--font-mono)">
          {fmtTime(pts[0].at)}
        </text>
        <text x={W - padR} y={H - 8} textAnchor="end" style={LABEL} fontSize="10" fontFamily="var(--font-mono)">
          {fmtTime(pts[pts.length - 1].at)}
        </text>
      </svg>
      <p className="mt-1 text-right font-mono text-xs text-faint">{pts.length} readings</p>
    </div>
  )
}
