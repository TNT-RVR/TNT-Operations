import type { SensorReading } from '@/data/types'

const TZ = 'America/Edmonton'
const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString('en-CA', { timeZone: TZ, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

const BRAND = '#B8860B'

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
      <div className="grid h-28 place-items-center rounded-lg border border-dashed border-slate-300 text-sm text-slate-500">
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
      <line x1={padL} y1={padT} x2={padL} y2={H - padB} stroke="#e2e8f0" />
      <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} stroke="#e2e8f0" />

      {/* target reference line */}
      <line x1={padL} y1={yTarget} x2={W - padR} y2={yTarget} stroke="#94a3b8" strokeDasharray="4 3" />
      <text x={W - padR} y={yTarget - 4} textAnchor="end" className="fill-slate-400" fontSize="10">
        target {targetC}°C
      </text>

      {/* y range labels */}
      <text x={padL - 6} y={y(tMax) + 3} textAnchor="end" className="fill-slate-400" fontSize="10">
        {tMax.toFixed(1)}
      </text>
      <text x={padL - 6} y={y(tMin) + 3} textAnchor="end" className="fill-slate-400" fontSize="10">
        {tMin.toFixed(1)}
      </text>

      {/* temperature line + points */}
      <path d={linePath} fill="none" stroke={BRAND} strokeWidth={2} />
      {pts.map((p, i) => {
        const off = Math.abs(p.tempC - targetC) > tolerance
        return <circle key={p.id} cx={x(times[i])} cy={y(p.tempC)} r={3} fill={off ? '#dc2626' : BRAND} stroke="#fff" strokeWidth={1} />
      })}

      {/* x end labels */}
      <text x={padL} y={H - 8} textAnchor="start" className="fill-slate-400" fontSize="10">
        {fmtTime(pts[0].at)}
      </text>
      <text x={W - padR} y={H - 8} textAnchor="end" className="fill-slate-400" fontSize="10">
        {fmtTime(pts[pts.length - 1].at)}
      </text>
    </svg>
  )
}
