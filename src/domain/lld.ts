/**
 * Legal Land Description matching. Pure functions — no React, no DB.
 *
 * An LLD under the Dominion Land Survey identifies a piece of prairie as
 * quarter–section–township–range–meridian: `SW-35-8-21-W4`. Everyone writes it
 * differently — `SW 35 8 21 W4`, `sw35-8-21w4`, `SW¼ 35-8-21 W4M`, or just
 * `35-8-21` when the quarter is obvious — and they are all the same place.
 *
 * ── Why substring matching is not enough ─────────────────────────────────────
 *
 * The field list matched with a plain lowercase `includes`, so a field stored
 * as `SW-35-8-21-W4` was found by typing `35-8-21` and NOT by typing
 * `SW 35 8 21`. Since the separator someone reaches for depends on whether they
 * are copying from a land title, a spray record or their own memory, that made
 * the search unreliable in exactly the case it exists for.
 *
 * Normalising both sides to `SW35821W4` before comparing fixes it, and costs
 * nothing for the other fields the same box searches.
 */

/** Quarter designations, plus the legal subdivisions used on some titles. */
const QUARTERS = ['NE', 'NW', 'SE', 'SW']

/**
 * Strip an LLD down to comparable characters.
 *
 * Uppercase, drop everything that is not a letter or digit, and remove the
 * trailing `M` in `W4M` — "meridian" is written with and without it and the two
 * mean the same thing. Anything else is left alone: this has to be forgiving,
 * not clever, because a wrong "helpful" transformation silently hides a field.
 */
export function normalizeLld(value: string | null | undefined): string {
  const raw = String(value ?? '')
    .toUpperCase()
    // ¼ and the word appear on scanned titles.
    .replace(/¼|1\/4|QUARTER/g, '')
    .replace(/[^A-Z0-9]/g, '')
  // W4M and W4 are the same meridian.
  return raw.replace(/W(\d)M$/, 'W$1')
}

/**
 * Whether `query` plausibly refers to `lld`.
 *
 * A CONTAINS test on the normalised forms, so a partial description finds the
 * field: `35821` matches `SW35821W4`, and so does `SW35`. That is deliberately
 * loose — the field list is short and a few extra hits cost nothing, whereas a
 * miss means someone concludes the field is not in the system.
 */
export function lldMatches(lld: string | null | undefined, query: string): boolean {
  const q = normalizeLld(query)
  if (!q) return false
  const target = normalizeLld(lld)
  if (!target) return false
  return target.includes(q)
}

/** The parts of an LLD, when it can be read. Null for anything unrecognised. */
export interface ParsedLld {
  quarter: string | null
  section: number
  township: number
  range: number
  meridian: number | null
}

/**
 * Read an LLD into its parts.
 *
 * Used for display and for the "is this plausible" check when someone types one
 * into the field editor. Returns null rather than guessing: a half-typed
 * description is not an error worth shouting about, it is just not parseable
 * yet.
 */
export function parseLld(value: string | null | undefined): ParsedLld | null {
  const n = normalizeLld(value)
  if (!n) return null

  // Optional quarter, then section-township-range, then optional meridian.
  const m = /^(NE|NW|SE|SW)?(\d{1,2})(\d{1,3})(\d{1,2})(?:W(\d))?$/.exec(n)
  // The greedy digit runs above are ambiguous — 35821 could split several ways
  // — so only trust a form that had separators to disambiguate.
  const sep = /^\s*(NE|NW|SE|SW)?[\s-]*(\d{1,2})[\s-]+(\d{1,3})[\s-]+(\d{1,2})(?:[\s-]*W?(\d)M?)?\s*$/i.exec(
    String(value ?? '').trim(),
  )
  const parts = sep ?? m
  if (!parts) return null

  const section = Number(parts[2])
  const township = Number(parts[3])
  const range = Number(parts[4])
  const meridian = parts[5] ? Number(parts[5]) : null

  // Range checks from the survey system itself. Out-of-range means we misread
  // it, and reporting a confident wrong answer is worse than reporting none.
  if (!(section >= 1 && section <= 36)) return null
  if (!(township >= 1 && township <= 126)) return null
  if (!(range >= 1 && range <= 34)) return null
  if (meridian != null && !(meridian >= 1 && meridian <= 6)) return null

  const quarter = parts[1] ? parts[1].toUpperCase() : null
  if (quarter && !QUARTERS.includes(quarter)) return null

  return { quarter, section, township, range, meridian }
}

/** An LLD written the canonical way, or null if it can't be read. */
export function formatLld(value: string | null | undefined): string | null {
  const p = parseLld(value)
  if (!p) return null
  const head = p.quarter ? `${p.quarter}-` : ''
  const tail = p.meridian ? `-W${p.meridian}` : ''
  return `${head}${p.section}-${p.township}-${p.range}${tail}`
}

/**
 * Whether a query looks like someone reaching for a land description rather
 * than a name.
 *
 * Used to decide whether to bother with LLD matching at all. Mostly digits and
 * separators, or starting with a quarter, is the signal — "Wordmans" is not.
 */
export function looksLikeLld(query: string): boolean {
  const q = query.trim()
  if (!q) return false
  if (/^(NE|NW|SE|SW)\b/i.test(q)) return true
  const digits = (q.match(/\d/g) ?? []).length
  return digits >= 3 && digits >= q.replace(/[\s-]/g, '').length / 2
}
