/**
 * The incubator history report, as a PDF.
 *
 * Renders the structure `domain/incubatorReport.ts` builds — this file decides
 * what things LOOK like and nothing about what they mean, so a number here and
 * the same number in the CSV came from one computation.
 *
 * Charts are drawn with jsPDF's vector primitives rather than rasterised from a
 * canvas: a line chart is a few dozen line segments, and drawing them directly
 * keeps the plot sharp at any zoom and the file small. A screenshot of a chart
 * would be neither.
 *
 * jsPDF is dynamic-imported so it stays out of the main bundle — most sessions
 * never export anything.
 */
import type { IncubatorReport, DailyPoint } from '@/domain/incubatorReport'
import { TEMP_MODES } from '@/domain/incubation'

// ── Palette ──────────────────────────────────────────────────────────────────
//
// RGB triples, not hex, because that is jsPDF's API — and it keeps the token
// linter honest. Each mirrors the token named beside it; a PDF is printed on
// white paper, so this is the `.on-light` side of the design system.
const INK = [23, 23, 23] as const //          --text-primary   (on light)
const INK_SOFT = [92, 92, 92] as const //     --text-secondary
const INK_FAINT = [150, 150, 150] as const // --text-faint
const BRAND = [254, 184, 54] as const //      --brand   honey
const RULE = [223, 223, 223] as const //      --border-default (on light)
const BAND = [246, 246, 246] as const //      --surface-raised (on light)
const TEMP_LINE = [200, 118, 24] as const //  a darker honey, legible as a line
const HUM_LINE = [70, 120, 170] as const //   muted blue, chart-only data palette

// ── Page geometry ────────────────────────────────────────────────────────────
const PAGE_W = 612 // Letter, portrait, points
const PAGE_H = 792
const MARGIN = 42
const CONTENT_W = PAGE_W - MARGIN * 2
/**
 * Blank space above each section heading. Sections previously sat directly on
 * top of one another, which reads as one long block — the humidity chart in
 * particular looked welded to the temperature note above it.
 */
const SECTION_GAP = 16

type Doc = import('jspdf').jsPDF

/**
 * The brand mark as a data URL, downscaled.
 *
 * The source is 3000 px square; embedding it raw would put ~150 KB of unused
 * resolution into every report for a mark printed 34 pt wide. Downscaling
 * through a canvas first costs a few lines and roughly a hundredth of the size.
 *
 * Returns null if anything fails — a report without the logo still tells you
 * what the incubator did, so this must never be the reason an export dies.
 */
async function loadLogo(): Promise<string | null> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}bee-light.png`)
    if (!res.ok) return null
    const blob = await res.blob()
    const bitmap = await createImageBitmap(blob)
    const SIZE = 160
    const canvas = document.createElement('canvas')
    canvas.width = SIZE
    canvas.height = SIZE
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(bitmap, 0, 0, SIZE, SIZE)
    bitmap.close?.()
    return canvas.toDataURL('image/png')
  } catch {
    return null
  }
}

const f1 = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? '—' : n.toFixed(1))
const f0 = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? '—' : n.toFixed(0))
const cToF = (c: number) => c * 9 / 5 + 32

/** A stored mode key → the label the app shows. */
const modeName = (mode: string) =>
  TEMP_MODES[mode as keyof typeof TEMP_MODES]?.label ?? mode

/**
 * What the inspector saw emerging on that round.
 *
 * The underlying fields are two checkboxes on the inspection form ("Bees
 * emerging", "Parasites emerging"), so the honest reading is "observed at this
 * inspection" — not a stage, and not a claim about whether emergence had just
 * begun or was already under way. The three-way distinction matters: `false`
 * means they looked and saw none, `null`/absent means nobody recorded it.
 */
export function emergingLabel(
  bees: boolean | null | undefined,
  parasites: boolean | null | undefined,
): string {
  const seen = [bees && 'Bees', parasites && 'Parasites'].filter(Boolean) as string[]
  if (seen.length) return seen.join(' + ')
  // Not recorded at all — say so rather than implying nothing was there.
  if (bees == null && parasites == null) return '—'
  return 'None'
}

/** `2026-05-01` → `May 1, 2026`. Dates are plain strings; no Date parsing. */
function prettyDate(ymd: string): string {
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const [y, m, d] = ymd.split('-')
  return `${MONTHS[+m - 1]} ${+d}, ${y}`
}

// ── Layout engine ────────────────────────────────────────────────────────────

/** Cursor + pagination. Every draw call goes through `space()` first. */
class Layout {
  y = MARGIN + 54
  page = 1
  constructor(
    readonly doc: Doc,
    readonly title: string,
    readonly subtitle: string,
    readonly logo: string | null,
  ) {
    this.header()
  }

  private header() {
    const { doc } = this
    if (this.logo) {
      try {
        doc.addImage(this.logo, 'PNG', MARGIN, MARGIN - 6, 34, 34)
      } catch {
        /* a broken image must not cost us the report */
      }
    }
    const x = MARGIN + (this.logo ? 44 : 0)
    doc.setFont('helvetica', 'bold').setFontSize(15).setTextColor(...INK)
    doc.text('TNT Pollination', x, MARGIN + 9)
    doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...INK_SOFT)
    doc.text(this.title, x, MARGIN + 22)
    doc.setFontSize(8).setTextColor(...INK_FAINT)
    doc.text(this.subtitle, x, MARGIN + 33)
    // Honey rule under the masthead — the one accent on the page.
    doc.setDrawColor(...BRAND).setLineWidth(1.5)
    doc.line(MARGIN, MARGIN + 42, PAGE_W - MARGIN, MARGIN + 42)
    doc.setLineWidth(0.5)
  }

  /** Reserve `h` points, starting a new page if they do not fit. */
  space(h: number): number {
    if (this.y + h > PAGE_H - MARGIN - 18) {
      this.doc.addPage()
      this.page++
      this.y = MARGIN + 54
      this.header()
    }
    const at = this.y
    this.y += h
    return at
  }

  /**
   * A section heading, with air above it.
   *
   * The leading gap is the whole reason this is not just a text call: sections
   * butted together read as one undifferentiated block, and the eye needs the
   * white space more than the rule to know a new thing has started. Suppressed
   * at the top of a page, where the masthead already provides the separation.
   */
  sectionTitle(text: string) {
    const lead = this.y > MARGIN + 54 ? SECTION_GAP : 0
    const y = this.space(lead + 26)
    this.doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(...INK)
    this.doc.text(text.toUpperCase(), MARGIN, y + lead + 12)
    this.doc.setDrawColor(...RULE)
    this.doc.line(MARGIN, y + lead + 17, PAGE_W - MARGIN, y + lead + 17)
  }

  note(text: string) {
    const y = this.space(15)
    this.doc.setFont('helvetica', 'italic').setFontSize(8).setTextColor(...INK_FAINT)
    this.doc.text(text, MARGIN, y + 9)
  }

  /** A table. `widths` are fractions of the content width. */
  table(headers: string[], rows: string[][], widths: number[], emptyNote = 'Nothing recorded.') {
    const { doc } = this
    if (rows.length === 0) {
      this.note(emptyNote)
      return
    }
    const cols = widths.map((w) => w * CONTENT_W)
    const xs = cols.map((_, i) => MARGIN + cols.slice(0, i).reduce((s, c) => s + c, 0))

    const head = this.space(18)
    doc.setFillColor(...BAND)
    doc.rect(MARGIN, head, CONTENT_W, 16, 'F')
    doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor(...INK_SOFT)
    headers.forEach((h, i) => doc.text(h, xs[i] + 4, head + 11))

    doc.setFont('helvetica', 'normal').setTextColor(...INK)
    for (const row of rows) {
      const y = this.space(15)
      doc.setDrawColor(...RULE)
      doc.line(MARGIN, y, PAGE_W - MARGIN, y)
      row.forEach((cell, i) => {
        // Truncate rather than wrap: these are short, scannable columns, and a
        // wrapped cell would break the fixed row height the cursor assumes.
        const max = cols[i] - 8
        let text = cell
        while (text.length > 1 && doc.getTextWidth(text) > max) text = text.slice(0, -2) + '…'
        doc.text(text, xs[i] + 4, y + 10)
      })
    }
  }

  /** Stat tiles — the metric readouts that lead in this design system. */
  stats(items: Array<{ label: string; value: string; sub?: string }>) {
    const { doc } = this
    const y = this.space(50)
    const w = CONTENT_W / items.length
    items.forEach((it, i) => {
      const x = MARGIN + i * w
      doc.setFillColor(...BAND)
      doc.rect(x, y, w - 6, 44, 'F')
      doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(...INK_FAINT)
      doc.text(it.label.toUpperCase(), x + 8, y + 13)
      doc.setFont('helvetica', 'bold').setFontSize(15).setTextColor(...INK)
      doc.text(it.value, x + 8, y + 30)
      if (it.sub) {
        doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(...INK_SOFT)
        doc.text(it.sub, x + 8, y + 39)
      }
    })
  }
}

// ── Charts ───────────────────────────────────────────────────────────────────

interface Series {
  get: (d: DailyPoint) => number | null
  lo?: (d: DailyPoint) => number | null
  hi?: (d: DailyPoint) => number | null
  colour: readonly [number, number, number]
}

/**
 * A dated line chart with an optional min/max band and a target line.
 *
 * Days with no reading break the line rather than interpolating across them —
 * a straight segment over a two-week gap would draw a period nobody measured.
 */
function chart(
  L: Layout,
  daily: DailyPoint[],
  series: Series,
  opts: { height: number; unit: string; target?: number | null; band?: [number, number] | null },
) {
  const { doc } = L
  const H = opts.height
  const top = L.space(H + 24)
  const plotL = MARGIN + 34
  const plotR = PAGE_W - MARGIN
  const plotW = plotR - plotL
  const plotB = top + H

  const values: number[] = []
  for (const d of daily) {
    for (const v of [series.get(d), series.lo?.(d), series.hi?.(d)]) {
      if (v != null && Number.isFinite(v)) values.push(v)
    }
  }
  if (opts.target != null) values.push(opts.target)
  if (opts.band) values.push(...opts.band)

  if (values.length === 0) {
    doc.setFont('helvetica', 'italic').setFontSize(8).setTextColor(...INK_FAINT)
    doc.text('No readings in this period.', plotL, top + H / 2)
    return
  }

  let lo = Math.min(...values)
  let hi = Math.max(...values)
  if (hi - lo < 1) {
    // A flat series would otherwise divide by zero and draw a line off-plot.
    lo -= 1
    hi += 1
  }
  const pad = (hi - lo) * 0.12
  lo -= pad
  hi += pad

  const yFor = (v: number) => plotB - ((v - lo) / (hi - lo)) * H
  const xFor = (i: number) => plotL + (daily.length <= 1 ? plotW / 2 : (i / (daily.length - 1)) * plotW)

  // Target band, drawn first so everything else sits on top of it.
  if (opts.band) {
    const [bLo, bHi] = opts.band
    doc.setFillColor(...BAND)
    doc.rect(plotL, yFor(bHi), plotW, Math.max(0.5, yFor(bLo) - yFor(bHi)), 'F')
  }

  // Gridlines + y labels.
  doc.setFontSize(7).setFont('helvetica', 'normal').setTextColor(...INK_FAINT)
  for (let i = 0; i <= 4; i++) {
    const v = lo + ((hi - lo) * i) / 4
    const y = yFor(v)
    doc.setDrawColor(...RULE).setLineWidth(0.3)
    doc.line(plotL, y, plotR, y)
    doc.text(`${v.toFixed(0)}${opts.unit}`, MARGIN, y + 2.5)
  }

  // Daily min/max as vertical whiskers — the spread inside a day matters as
  // much as its mean when you are asking whether a chamber held.
  if (series.lo && series.hi) {
    doc.setDrawColor(...series.colour).setLineWidth(0.6)
    doc.setGState(doc.GState({ opacity: 0.28 }))
    daily.forEach((d, i) => {
      const a = series.lo!(d)
      const b = series.hi!(d)
      if (a == null || b == null) return
      doc.line(xFor(i), yFor(a), xFor(i), yFor(b))
    })
    doc.setGState(doc.GState({ opacity: 1 }))
  }

  if (opts.target != null) {
    doc.setDrawColor(...INK_FAINT).setLineWidth(0.7)
    doc.setLineDashPattern([2, 2], 0)
    doc.line(plotL, yFor(opts.target), plotR, yFor(opts.target))
    doc.setLineDashPattern([], 0)
  }

  // The mean line, broken across gaps.
  doc.setDrawColor(...series.colour).setLineWidth(1.2)
  let prev: { x: number; y: number } | null = null
  daily.forEach((d, i) => {
    const v = series.get(d)
    if (v == null || !Number.isFinite(v)) {
      prev = null
      return
    }
    const pt = { x: xFor(i), y: yFor(v) }
    if (prev) doc.line(prev.x, prev.y, pt.x, pt.y)
    prev = pt
  })

  // Frame + date labels at each end and the middle.
  doc.setDrawColor(...RULE).setLineWidth(0.5)
  doc.rect(plotL, top, plotW, H)
  doc.setFontSize(7).setTextColor(...INK_FAINT)
  const marks = daily.length > 2 ? [0, Math.floor(daily.length / 2), daily.length - 1] : [0]
  for (const i of marks) {
    const label = prettyDate(daily[i].date)
    const w = doc.getTextWidth(label)
    const x = Math.min(Math.max(xFor(i) - w / 2, plotL), plotR - w)
    doc.text(label, x, plotB + 12)
  }
}

// ── The report ───────────────────────────────────────────────────────────────

export async function incubatorReportPdf(
  report: IncubatorReport,
  fmtLocal: (iso: string) => string,
): Promise<Blob> {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'pt', format: 'letter' }) as Doc
  const logo = await loadLogo()

  const inc = report.incubator
  const L = new Layout(
    doc,
    `${inc.name} — incubator history`,
    `${prettyDate(report.from)} to ${prettyDate(report.to)}  ·  ${inc.location}`,
    logo,
  )

  // ── Headline numbers ──
  L.stats([
    { label: 'Days covered', value: String(report.generatedFor.days) },
    {
      label: 'Trays held',
      value: String(report.totals.trays),
      // An undated tray is counted but flagged, so the total can be explained
      // rather than merely believed.
      sub: report.totals.undated
        ? `${report.totals.samples} sample(s) · ${report.totals.undated} undated`
        : `${report.totals.samples} sample(s)`,
    },
    { label: 'Gallons', value: report.totals.gallons.toFixed(1) },
    { label: 'Readings', value: String(report.temp?.count ?? 0) },
  ])

  // ── Highs and lows ──
  L.sectionTitle('Highs and lows')
  const t = report.temp
  const h = report.humidity
  L.table(
    ['Measurement', 'Lowest', 'When', 'Highest', 'When', 'Average'],
    [
      t
        ? [
            'Temperature',
            `${f1(t.min)}°C / ${f1(cToF(t.min))}°F`,
            fmtLocal(t.minAt),
            `${f1(t.max)}°C / ${f1(cToF(t.max))}°F`,
            fmtLocal(t.maxAt),
            `${f1(t.mean)}°C`,
          ]
        : ['Temperature', '—', '—', '—', '—', '—'],
      h
        ? ['Humidity', `${f0(h.min)}%`, fmtLocal(h.minAt), `${f0(h.max)}%`, fmtLocal(h.maxAt), `${f0(h.mean)}%`]
        : ['Humidity', '—', '—', '—', '—', '—'],
    ],
    [0.16, 0.17, 0.19, 0.17, 0.19, 0.12],
  )

  // ── Charts ──
  L.sectionTitle('Temperature')
  chart(
    L,
    report.daily,
    {
      get: (d) => d.tempC,
      lo: (d) => d.tempMinC,
      hi: (d) => d.tempMaxC,
      colour: TEMP_LINE,
    },
    { height: 118, unit: '°C', target: inc.tempTargetC },
  )
  L.note(`Solid line: daily average. Whiskers: that day's low to high. Dashed: target ${f1(inc.tempTargetC)}°C.`)

  L.sectionTitle('Humidity')
  chart(
    L,
    report.daily,
    { get: (d) => d.humidityPct, colour: HUM_LINE },
    { height: 92, unit: '%', target: inc.humidityTargetPct },
  )
  L.note(`Solid line: daily average. Dashed: target ${f0(inc.humidityTargetPct)}%.`)

  // ── Recorded setting changes ──
  //
  // The log, where there is one. Distinct from the derived timeline below and
  // deliberately shown first: this answers "when did someone change it", which
  // is a different question from "what did the chamber hold".
  if (report.modeChanges.length > 0) {
    L.sectionTitle('Setting changes')
    L.table(
      ['When', 'From', 'To', 'Note'],
      report.modeChanges.map((e) => [
        e.backfilled ? '—' : fmtLocal(e.changedAt),
        e.fromMode ? modeName(e.fromMode) : '—',
        modeName(e.toMode),
        e.backfilled ? 'Setting when logging began; the date it was set is not recorded.' : e.note,
      ]),
      [0.22, 0.18, 0.18, 0.42],
    )
    L.note('Recorded when the setting was changed, from any source — the app, a script, or the database.')
  }

  // ── Settings timeline ──
  L.sectionTitle(report.modeChanges.length > 0 ? 'Settings held' : 'Settings')
  L.table(
    ['Setting', 'From', 'To', 'Days', 'Average temp'],
    report.modePeriods.map((p) => [
      p.label,
      prettyDate(p.from),
      prettyDate(p.to),
      String(p.days),
      `${f1(p.meanTempC)}°C`,
    ]),
    [0.24, 0.22, 0.22, 0.1, 0.22],
    'No readings, so there is nothing to infer a setting from.',
  )
  L.note(
    'Read back from measured temperature, not from a log of switch flips — the app stores only the ' +
      'current setting. A gap in the readings ends a period rather than bridging it.',
  )

  // ── Trays in ──
  L.sectionTitle('Trays in')
  L.table(
    ['Date', 'Trays', 'Gallons', 'Tray numbers'],
    report.intake.map((i) => [
      prettyDate(i.date),
      String(i.trays),
      i.gallons.toFixed(1),
      i.trayNumbers.join(', '),
    ]),
    [0.2, 0.1, 0.12, 0.58],
    'No trays went into this incubator during the period.',
  )
  if (report.totals.undated > 0) {
    L.note(
      `${report.totals.undated} tray(s) assigned to this incubator have no dates recorded. They are ` +
        'counted in the totals above as currently held, but cannot appear in this list.',
    )
  }

  // ── Key dates ──
  if (report.keyDates.length > 0) {
    L.sectionTitle('Key dates')
    L.table(
      ['Milestone', 'Planned', 'Actual', 'Variance'],
      report.keyDates.map((k) => [
        k.label,
        k.planned ? prettyDate(k.planned) : '—',
        k.actual ? prettyDate(k.actual) : '—',
        k.varianceDays == null
          ? '—'
          : k.varianceDays === 0
            ? 'on time'
            : `${k.varianceDays > 0 ? '+' : ''}${k.varianceDays} d`,
      ]),
      [0.3, 0.24, 0.24, 0.22],
    )
    L.note('Planned dates come from the run schedule. The only recorded actual is the release — the first tray out.')
  }

  // ── Inspections ──
  L.sectionTitle('Inspections')
  L.table(
    ['When', 'Thermometer', 'Faults', 'Seen emerging'],
    report.inspections.map((i) => {
      const faults = [
        i.heatPumpsOk === false && 'heat pumps',
        i.fansOk === false && 'fans',
        i.blackLightsOk === false && 'black lights',
      ].filter(Boolean) as string[]
      return [
        fmtLocal(i.at),
        i.tempC != null ? `${f1(i.tempC)}°C` : '—',
        faults.length ? faults.join(', ') : 'none',
        emergingLabel(i.beesEmerging, i.parasitesEmerging),
      ]
    }),
    [0.26, 0.15, 0.29, 0.30],
    'No inspections logged during the period.',
  )
  L.note(
    'Seen emerging is what the inspector observed on that round — bees or parasites coming out of the ' +
      'cells. "None" means they looked and saw none; a dash means it was not recorded.',
  )

  // ── Footer on every page ──
  const pages = doc.getNumberOfPages()
  const stamp = fmtLocal(new Date().toISOString())
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p)
    doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(...INK_FAINT)
    doc.text(`Generated ${stamp} · America/Edmonton`, MARGIN, PAGE_H - MARGIN + 8)
    const right = `Page ${p} of ${pages}`
    doc.text(right, PAGE_W - MARGIN - doc.getTextWidth(right), PAGE_H - MARGIN + 8)
  }

  return doc.output('blob')
}

/** The band a mode targets, for callers that want to draw it. */
export const modeBand = (mode: string): [number, number] | null => {
  const cfg = TEMP_MODES[mode as keyof typeof TEMP_MODES]
  return cfg?.min != null && cfg.max != null ? [cfg.min, cfg.max] : null
}
