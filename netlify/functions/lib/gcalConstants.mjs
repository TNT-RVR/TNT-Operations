/**
 * Constants and pure helpers shared by the calendar functions.
 *
 * ── Why this is duplicated from src/domain ───────────────────────────────────
 *
 * A Netlify function cannot import from `src/` — the function bundle and the
 * app bundle are built separately. So the milestone table, the day→date offset
 * and the event-id derivation all have to exist twice.
 *
 * Duplication that can silently drift is the dangerous kind, so
 * `src/domain/calendarSync.test.ts` imports THIS FILE and asserts it agrees
 * with `src/domain/incubation.ts` and `src/domain/calendarSync.ts`. Change a
 * milestone there and the test fails here, which is the only reason this
 * arrangement is safe.
 */

export const CALENDAR_SUMMARY_TEXT = 'TNT Operations — Incubation'
export const CALENDAR_DESCRIPTION_TEXT =
  'Incubation milestones from TNT Operations. Managed automatically — changes made here are overwritten.'

/** Mirrors INCUBATION_MILESTONES in src/domain/incubation.ts. */
export const MILESTONES = [
  { day: 1, label: 'Incubation Start' },
  { day: 7, label: 'Vapona In' },
  { day: 13, label: 'Vapona Out' },
  { day: 14, label: 'Earliest We Can Cool' },
  { day: 18, label: '10% Male Emergence' },
  { day: 23, label: 'Expected Release' },
  { day: 37, label: 'Latest Release' },
]

/** Add whole days to a YYYY-MM-DD, in UTC so no timezone can shift it. */
export function addDays(ymd, n) {
  const d = new Date(`${ymd}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/**
 * The incubation start for one incubator — mirrors `incubationStartFor`.
 *
 * An explicit `incubation_start` wins. The literal string "none" means the
 * incubator is deliberately not running and yields null. Otherwise it falls
 * back to the date most of its ACTIVE trays went in, ties resolving to the
 * earlier date so the schedule does not jump about.
 */
export function incubationStartFor(incubator, trays) {
  const raw = String(incubator.incubation_start ?? '').trim()
  if (raw.toLowerCase() === 'none') return null
  if (raw) return raw.slice(0, 10)

  const counts = new Map()
  for (const t of trays) {
    if (t.incubator_id !== incubator.id || t.status !== 'active' || !t.in_date) continue
    const d = String(t.in_date).slice(0, 10)
    counts.set(d, (counts.get(d) ?? 0) + 1)
  }
  let best = null
  let bestN = 0
  for (const [d, n] of counts) {
    if (n > bestN || (n === bestN && best !== null && d < best)) {
      best = d
      bestN = n
    }
  }
  return best
}

/**
 * Every milestone for every running incubator — mirrors `milestoneEvents`.
 *
 * Day 1 IS the start date, so the offset is `day - 1`. An incubator whose
 * temperature mode is 'off' is skipped: it is not running, and putting a
 * schedule on the calendar for it would be fiction.
 */
export function milestoneEvents(incubators, trays) {
  const out = []
  for (const inc of incubators) {
    if (inc.temp_mode === 'off') continue
    const start = incubationStartFor(inc, trays)
    if (!start) continue
    for (const m of MILESTONES) {
      out.push({
        date: addDays(start, m.day - 1),
        day: m.day,
        label: m.label,
        incubatorId: inc.id,
        incubatorName: inc.name ?? 'Incubator',
      })
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.incubatorName.localeCompare(b.incubatorName))
}

/** Mirrors `eventIdFor` in src/domain/calendarSync.ts. */
const BASE32HEX = '0123456789abcdefghijklmnopqrstuv'
export function eventIdFor(incubatorId, day, label) {
  const key = `${incubatorId}|${day}|${label}`
  const hash = (offset) => {
    let h = offset
    for (let i = 0; i < key.length; i++) {
      h ^= key.charCodeAt(i)
      h = Math.imul(h, 16777619) >>> 0
    }
    return h
  }
  const encode = (n) => {
    let out = ''
    let v = n
    for (let i = 0; i < 7; i++) {
      out = BASE32HEX[v % 32] + out
      v = Math.floor(v / 32)
    }
    return out
  }
  return `tnt${encode(hash(2166136261))}${encode(hash(2166136261 ^ 0x5bf03635))}`
}

/** Mirrors `syncWindow`. */
export function syncWindow(milestones, today, pastDays = 30, futureDays = 365) {
  const from = addDays(today, -pastDays)
  const to = addDays(today, futureDays)
  return milestones.filter((m) => m.date >= from && m.date <= to)
}
