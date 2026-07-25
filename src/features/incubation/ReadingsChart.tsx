import type { SensorReading } from '@/data/types'

const TZ = 'America/Edmonton'
const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString('en-CA', { timeZone: TZ, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

// Chart colours come from the token layer so the chart tracks light/dark.
const LINE = 'var(--data-honey)'
const OFF = 'var(--red-500)'
const AXIS = 'var(--border-default)'
const REF = 'var(--text-faint)'
const LABEL = { fill: 'var(--text-faint)' } as const

/**
 * Compact, dependency-free temperature-over-time chart for one incubator.
 * Plots tempC against reading time with the target as a dashed reference line;
 * points more than `tolerance`°C off target are drawn in red.
 */
export function ReadingsChart({
  readings,
  targetC,
  tolerance = 1.5,
}: {
  readings: SensorReading[]
  targetC: number
  tolerance?: number
}) {
  const pts = [...readings].sort((a, b) => a.at.localeCompare(b.at))
  if (pts.length < 2) {
    return (
      <div className="grid h-28 place-items-center rounded-lg border border-dashed border-default text-sm text-muted">
        Not enough readings to chart yet.
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
  const tMin = Math.min(...temps, targetC)
  const tMax = Math.max(...temps, targetC)
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
  const yTarget = y(targetC)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Temperature over time">
      {/* axes */}
      <line x1={padL} y1={padT} x2={padL} y2={H - padB} stroke={AXIS} />
      <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} stroke={AXIS} />

      {/* target reference line */}
      <line x1={padL} y1={yTarget} x2={W - padR} y2={yTarget} stroke={REF} strokeDasharray="4 3" />
      <text x={W - padR} y={yTarget - 4} textAnchor="end" style={LABEL} fontSize="10" fontFamily="var(--font-mono)">
        target {targetC}°C
      </text>

      {/* y range labels */}
      <text x={padL - 6} y={y(tMax) + 3} textAnchor="end" style={LABEL} fontSize="10" fontFamily="var(--font-mono)">
        {tMax.toFixed(1)}
      </text>
      <text x={padL - 6} y={y(tMin) + 3} textAnchor="end" style={LABEL} fontSize="10" fontFamily="var(--font-mono)">
        {tMin.toFixed(1)}
      </text>

      {/* temperature line + points */}
      <path d={linePath} fill="none" stroke={LINE} strokeWidth={2} />
      {pts.map((p, i) => {
        const off = Math.abs(p.tempC - targetC) > tolerance
        return <circle key={p.id} cx={x(times[i])} cy={y(p.tempC)} r={3} fill={off ? OFF : LINE} stroke="var(--bg-raised)" strokeWidth={1} />
      })}

      {/* x end labels */}
      <text x={padL} y={H - 8} textAnchor="start" style={LABEL} fontSize="10" fontFamily="var(--font-mono)">
        {fmtTime(pts[0].at)}
      </text>
      <text x={W - padR} y={H - 8} textAnchor="end" style={LABEL} fontSize="10" fontFamily="var(--font-mono)">
        {fmtTime(pts[pts.length - 1].at)}
      </text>
    </svg>
  )
}
