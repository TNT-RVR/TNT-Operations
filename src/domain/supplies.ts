/**
 * What a crew has to load before leaving the yard.
 *
 * Every number here is computed from what the field already records — acres,
 * gallons per acre, gallons per tray, the shelter grid — rather than from a
 * separate list somebody maintains by hand. A packing list that has to be kept
 * in step with the field data is a packing list that quietly goes stale, and
 * the cost of that is a crew arriving at a quarter one trailer short.
 */

export interface FieldSupplies {
  /** Shelters the grid calls for. */
  shelters: number
  /** Still to place this season — what actually goes on the trailer. */
  sheltersRemaining: number
  /** Bee volume the field is planned at. */
  gallons: number | null
  /** Trays that volume works out to, rounded UP: a part tray still travels. */
  trays: number | null
  /** Trays per shelter, for loading them out evenly. */
  traysPerShelter: number | null
  /** Anything the field cannot answer, said plainly rather than guessed. */
  unknowns: string[]
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

/**
 * Supplies for one field.
 *
 * @param shelterCount how many shelters the grid produces
 * @param placed       how many are already out this season
 */
export function fieldSupplies(
  geometry: Record<string, unknown> | undefined,
  shelterCount: number,
  placed = 0,
): FieldSupplies {
  const g = geometry ?? {}
  const unknowns: string[] = []

  const acres = num(g.acres) ?? num(g.acres_manual)
  const galsPerAcre = num(g.gals_per_acre)
  const galsPerTray = num(g.gals_per_tray)

  if (acres == null) unknowns.push('field acres')
  if (galsPerAcre == null) unknowns.push('gallons per acre')
  if (galsPerTray == null || galsPerTray <= 0) unknowns.push('gallons per tray')

  const gallons = acres != null && galsPerAcre != null ? acres * galsPerAcre : null
  // Rounded UP: two thirds of a tray still has to be carried, and a crew short
  // of one tray at the far end of a quarter loses the afternoon.
  const trays = gallons != null && galsPerTray ? Math.ceil(gallons / galsPerTray) : null

  return {
    shelters: shelterCount,
    sheltersRemaining: Math.max(0, shelterCount - placed),
    gallons: gallons == null ? null : Math.round(gallons * 10) / 10,
    trays,
    traysPerShelter:
      trays != null && shelterCount > 0 ? Math.round((trays / shelterCount) * 10) / 10 : null,
    unknowns,
  }
}

/** One line of a packing list. */
export interface SupplyLine {
  item: string
  qty: string
  note?: string
}

/**
 * The packing list for a scheduled job.
 *
 * Shelter work and tray work load different trailers, so the list is per task
 * rather than everything the field will ever need.
 */
export function supplyLines(task: 'shelter' | 'tray', s: FieldSupplies): SupplyLine[] {
  if (task === 'shelter') {
    const lines: SupplyLine[] = [
      {
        item: 'Shelters',
        qty: String(s.sheltersRemaining),
        note:
          s.sheltersRemaining === s.shelters
            ? undefined
            : `${s.shelters} in the field plan, ${s.shelters - s.sheltersRemaining} already out`,
      },
    ]
    return lines
  }

  const lines: SupplyLine[] = [
    {
      item: 'Trays',
      qty: s.trays == null ? '—' : String(s.trays),
      note:
        s.gallons != null && s.trays != null
          ? `${s.gallons} gal at ${(s.gallons / s.trays).toFixed(1)} gal a tray`
          : 'Needs acres, gallons per acre and gallons per tray on the field',
    },
  ]
  if (s.traysPerShelter != null) {
    lines.push({
      item: 'Trays per shelter',
      qty: String(s.traysPerShelter),
      note: `${s.shelters} shelters`,
    })
  }
  return lines
}

// ═══════════════════════════════════════════════════════════════════════════
// What a crew is scheduled to do
// ═══════════════════════════════════════════════════════════════════════════

export interface ScheduledJob {
  eventId: string
  title: string
  crewId: string
  task: 'shelter' | 'tray'
  fieldId: string
  startDate: string
  endDate: string | null
}

/** A calendar row, as much of it as scheduling cares about. */
interface EventLike {
  id: string
  title: string
  startDate: string
  endDate: string | null
  crewId?: string | null
  task?: 'shelter' | 'tray' | null
  fieldId?: string | null
}

/**
 * The jobs a crew is booked on for a given day.
 *
 * A job spanning several days counts on every one of them: a two-day quarter
 * does not stop being that crew's work on the second morning.
 *
 * Events missing a crew, a task or a field are not jobs — they are ordinary
 * calendar entries (a delivery, a meeting) and must not silently reassign
 * anybody's day.
 */
export function jobsForCrew(events: EventLike[], crewId: string, ymd: string): ScheduledJob[] {
  const out: ScheduledJob[] = []
  for (const e of events) {
    if (!e.crewId || e.crewId !== crewId) continue
    if (!e.task || !e.fieldId) continue
    const last = e.endDate && e.endDate > e.startDate ? e.endDate : e.startDate
    if (ymd < e.startDate || ymd > last) continue
    out.push({
      eventId: e.id,
      title: e.title,
      crewId: e.crewId,
      task: e.task,
      fieldId: e.fieldId,
      startDate: e.startDate,
      endDate: e.endDate ?? null,
    })
  }
  return out.sort((a, b) => a.startDate.localeCompare(b.startDate) || a.title.localeCompare(b.title))
}

/**
 * Every job touching a window of days, listed once each.
 *
 * `jobsForCrew` answers "what is this crew doing today", which is the right
 * question on the map and the wrong one on a list of upcoming work: asking it
 * for twenty-one days running turns one three-day booking into three
 * identical cards. A work order is one thing that happens to last a while, so
 * it appears once and states its own range.
 *
 * `showOn` is the day to file it under: its start, or the first day of the
 * window for a job already under way. A job that began on Monday is still
 * what a crew is doing on Wednesday, and burying it above "Today" would hide
 * exactly the work in progress.
 */
export function jobsInWindow(
  events: EventLike[],
  crewIds: string[],
  from: string,
  to: string,
): Array<ScheduledJob & { showOn: string; lastDate: string }> {
  const wanted = new Set(crewIds)
  const out: Array<ScheduledJob & { showOn: string; lastDate: string }> = []
  for (const e of events) {
    if (!e.crewId || !wanted.has(e.crewId)) continue
    if (!e.task || !e.fieldId) continue
    const lastDate = e.endDate && e.endDate > e.startDate ? e.endDate : e.startDate
    // Any overlap at all with the window, including a job that straddles it.
    if (e.startDate > to || lastDate < from) continue
    out.push({
      eventId: e.id,
      title: e.title,
      crewId: e.crewId,
      task: e.task,
      fieldId: e.fieldId,
      startDate: e.startDate,
      endDate: e.endDate ?? null,
      lastDate,
      showOn: e.startDate < from ? from : e.startDate,
    })
  }
  return out.sort(
    (a, b) =>
      a.showOn.localeCompare(b.showOn) ||
      a.startDate.localeCompare(b.startDate) ||
      a.title.localeCompare(b.title),
  )
}
