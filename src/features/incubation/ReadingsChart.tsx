import { useCallback, useEffect, useRef, useState } from 'react'
import { useData } from '@/data/context'
import type { SensorReading } from '@/data/types'
import { niceTicks, niceStep, tickDecimals, timeTicks } from '@/domain/chartTicks'

const TZ = 'America/Edmonton'
/**
 * The operation's UTC offset at an instant, for aligning ticks to local clock
 * boundaries. Read from Intl rather than the device, so a phone in another
 * timezone still labels midnight in Alberta as midnight.
 */
const tzOffsetMs = (t: number): number => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(t))
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0)
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return asUtc - Math.floor(t / 1000) * 1000
}

/**
 * A tick's label: the date at midnight, the time otherwise.
 *
 * A 24-hour clock on the time ticks — "14:00" says in five characters what
 * "2:00 p.m." says in nine, and the axis has room for neither to be wasted.
 */
const tickLabel = (t: number, isDay: boolean) =>
  isDay
    ? new Date(t).toLocaleDateString('en-CA', { timeZone: TZ, month: 'short', day: 'numeric' })
    : new Date(t).toLocaleTimeString('en-CA', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false })

// Chart colours come from the token layer so the chart tracks light/dark.
const LINE = 'var(--data-honey)'
const AXIS = 'var(--border-default)'
const REF = 'var(--text-faint)'
const BAND = 'var(--data-honey)'
const LABEL = { fill: 'var(--text-faint)' } as const

/**
 * Selectable windows, newest-anchored. 30D is deliberately the longest — an
 * unbounded "all" meant fetching thousands of rows for a marginal view.
 */
const RANGES = [
  { key: '1h', label: '1H', hours: 1 },
  { key: '6h', label: '6H', hours: 6 },
  { key: '24h', label: '24H', hours: 24 },
  { key: '7d', label: '7D', hours: 24 * 7 },
  { key: '30d', label: '30D', hours: 24 * 30 },
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
  incubatorId,
  targetC,
  tolerance = 1.5,
}: {
  readings: SensorReading[]
  incubatorId: string
  /** Target for the current mode, or null when the incubator is off (no target). */
  targetC: number | null
  tolerance?: number
}) {
  const { loadReadings } = useData()
  const [range, setRange] = useState<RangeKey>('24h')
  const [loading, setLoading] = useState(false)

  /**
   * The chart is drawn at the container's real pixel width.
   *
   * It used to draw into a fixed 560-wide viewBox scaled with `w-full`, which
   * on a phone meant every unit shrank by about 40% — a 10px label rendered at
   * 6px and the whole plot was 97px tall. Measuring instead means one SVG unit
   * is one CSS pixel: text is the size it says it is, on any screen.
   */
  const [boxW, setBoxW] = useState(560)
  const roRef = useRef<ResizeObserver | null>(null)
  /**
   * A callback ref, not an effect.
   *
   * This component swaps between an empty state and the chart, so the measured
   * node is a DIFFERENT element depending on the branch. A mount-only effect
   * attaches to whichever was rendered first and then observes a detached node
   * forever — which is exactly what happened: the chart kept drawing at the
   * 560 fallback and scaling itself back down.
   *
   * Measuring in the callback also gets a width on the first paint rather than
   * on the observer's first delivery.
   */
  const nodeRef = useRef<HTMLDivElement | null>(null)
  const measure = useCallback((node: HTMLDivElement | null) => {
    roRef.current?.disconnect()
    roRef.current = null
    nodeRef.current = node
    if (!node) return
    const w = Math.round(node.getBoundingClientRect().width)
    if (w > 0) setBoxW(w)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([entry]) => {
      const next = Math.round(entry.contentRect.width)
      if (next > 0) setBoxW(next)
    })
    ro.observe(node)
    roRef.current = ro
  }, [])

  /**
   * A window-resize fallback, belt and braces.
   *
   * ResizeObserver is the right tool — it catches a sidebar collapsing, which
   * changes this element without changing the window — but it is not always
   * delivered (it was silently never firing in one embedded browser during
   * testing). Rotating a phone or resizing a window is the common case and
   * costs one listener to cover, so the chart is never left at a stale width.
   */
  useEffect(() => {
    const onResize = () => {
      const w = Math.round(nodeRef.current?.getBoundingClientRect().width ?? 0)
      if (w > 0) setBoxW(w)
    }
    window.addEventListener('resize', onResize)
    window.addEventListener('orientationchange', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('orientationchange', onResize)
    }
  }, [])

  // Hydration only holds a recent window per incubator, so a longer range has
  // to go and get the rest — otherwise 7D and 30D render the same ~16h as 24H.
  const hours = RANGES.find((r) => r.key === range)?.hours ?? 24

  useEffect(() => {
    const since = new Date(Date.now() - hours * 3600_000).toISOString()
    let cancelled = false
    setLoading(true)
    loadReadings(incubatorId, since).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [incubatorId, hours, loadReadings])

  const all = [...readings].sort((a, b) => a.at.localeCompare(b.at))
  const newest = all.length ? Date.parse(all[all.length - 1].at) : 0
  const pts = all.filter((p) => Date.parse(p.at) >= newest - hours * 3600_000)

  const picker = (
    <div className="mb-2 flex flex-wrap items-center gap-1">
      {RANGES.map((r) => (
        <button
          key={r.key}
          onClick={() => setRange(r.key)}
          className={`rounded-sm px-3 py-1.5 text-sm font-medium tracking-wide transition ${
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

  if (pts.length < 2) {
    return (
      // Measured here too, so the width is already known when the readings
      // arrive — otherwise the first frame of a real chart is drawn at the
      // fallback width and visibly resizes.
      <div ref={measure}>
        {picker}
        <div className="grid h-28 place-items-center rounded-lg border border-dashed border-default text-sm text-muted">
          {loading
            ? 'Loading readings…'
            : all.length < 2
              ? 'Not enough readings to chart yet.'
              : 'No readings in this window — try a longer range.'}
        </div>
      </div>
    )
  }

  // One unit per CSS pixel, so nothing is scaled and the type is legible.
  const W = boxW
  // Taller on a phone than the old scaled height: on a narrow screen the chart
  // is the only thing on the line, and 100px of plot cannot show a shape.
  const H = W < 480 ? 240 : 200
  const FONT = 12
  // Room for a label like "17.5" at 12px, and for the time under the axis.
  const padL = 40
  const padR = 14
  const padT = 16
  const padB = 34

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

  // Rounded gridlines rather than "the highest and lowest reading": three
  // numbers a person reads without decoding them.
  const tickStep = niceStep(yHi - yLo, 3)
  const yTicks = niceTicks(yLo, yHi, 3)
  const tickDp = tickDecimals(tickStep)
  const last = pts[pts.length - 1]

  // Time ticks sized to the width available: roughly one per 60px. "Sep 11"
  // is about 44px at 12px mono, so that still leaves a clear gap. It was one
  // per 80px, which on a phone allowed only three ticks — too few for any
  // step but a week, so a 7-day chart showed one date, or none.
  const plotW = W - padL - padR
  const xTicks = timeTicks(xMin, xMax, Math.max(3, Math.floor(plotW / 60)), tzOffsetMs)
    // A label centred on a tick right at an edge would spill past the chart.
    .filter((k) => x(k.t) - padL > 22 && W - padR - x(k.t) > 22)
  // Clamp the shaded band to the plot area so it never bleeds past the axes.
  const yTarget = targetC == null ? null : y(targetC)
  const bandTop = targetC == null ? 0 : Math.max(padT, y(targetC + tolerance))
  const bandBottom = targetC == null ? 0 : Math.min(H - padB, y(targetC - tolerance))

  return (
    <div ref={measure}>
      {picker}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        className="w-full"
        role="img"
        aria-label={`Temperature over time, ${pts.length} readings, latest ${last.tempC.toFixed(1)} degrees`}
      >
        {/* in-range band (target ± tolerance) — omitted when there's no target */}
        {targetC != null && bandBottom > bandTop && (
          <rect x={padL} y={bandTop} width={W - padL - padR} height={bandBottom - bandTop} fill={BAND} opacity={0.12} />
        )}

        {/* Gridlines at the rounded ticks. Faint on purpose: they are there to
            be measured against, not looked at. */}
        {yTicks.map((t) => (
          <g key={t}>
            <line
              x1={padL}
              y1={y(t)}
              x2={W - padR}
              y2={y(t)}
              stroke={AXIS}
              strokeOpacity={0.5}
              strokeDasharray="2 4"
            />
            <text
              x={padL - 8}
              y={y(t) + FONT / 3}
              textAnchor="end"
              style={LABEL}
              fontSize={FONT}
              fontFamily="var(--font-mono)"
            >
              {t.toFixed(tickDp)}
            </text>
          </g>
        ))}

        {/* axes */}
        <line x1={padL} y1={padT} x2={padL} y2={H - padB} stroke={AXIS} />
        <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} stroke={AXIS} />

        {/* target reference line — an incubator that's off has no target */}
        {yTarget != null && (
          <>
            <line x1={padL} y1={yTarget} x2={W - padR} y2={yTarget} stroke={REF} strokeDasharray="5 4" />
            <text
              x={W - padR}
              y={yTarget - 5}
              textAnchor="end"
              style={LABEL}
              fontSize={FONT}
              fontFamily="var(--font-mono)"
            >
              target {targetC}°C
            </text>
          </>
        )}

        {/* temperature line */}
        <path d={linePath} fill="none" stroke={LINE} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />

        {/* The latest reading, marked and labelled. It is the number people
            came to the chart for, and hunting for the end of a line to find it
            is work the chart can do instead. */}
        <circle cx={x(times[times.length - 1])} cy={y(last.tempC)} r={4} fill={LINE} />
        <text
          x={Math.min(x(times[times.length - 1]) + 8, W - padR)}
          y={Math.max(y(last.tempC) - 9, padT + FONT)}
          textAnchor={x(times[times.length - 1]) > W - padR - 60 ? 'end' : 'start'}
          fontSize={FONT}
          fontWeight={600}
          fontFamily="var(--font-mono)"
          fill={LINE}
        >
          {last.tempC.toFixed(1)}°
        </text>

        {/*
          Time ticks along the bottom.

          The axis used to be labelled only at its two ends, which left a week
          of data with nothing to read a day off. These land on local midnights
          and whole hours, with a faint rule up the plot so a bump can be traced
          down to when it happened. The latest time is already in the header
          above, so the ends need no label of their own.
        */}
        {xTicks.map((k) => (
          <g key={k.t}>
            <line
              x1={x(k.t)}
              y1={padT}
              x2={x(k.t)}
              y2={H - padB}
              stroke={AXIS}
              strokeOpacity={k.isDay ? 0.55 : 0.3}
              strokeDasharray="2 4"
            />
            <line x1={x(k.t)} y1={H - padB} x2={x(k.t)} y2={H - padB + 4} stroke={AXIS} />
            <text
              x={x(k.t)}
              y={H - 10}
              textAnchor="middle"
              style={LABEL}
              fontSize={FONT}
              fontWeight={k.isDay ? 600 : 400}
              fontFamily="var(--font-mono)"
            >
              {tickLabel(k.t, k.isDay)}
            </text>
          </g>
        ))}
      </svg>
      <p className="mt-1 text-right text-xs text-faint">{pts.length} readings</p>
    </div>
  )
}
