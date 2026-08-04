import type { Tray } from '@/data/types'

/**
 * Resolving a scanned or typed tray label. Shared by the Scan screen and the
 * tray observations on an inspection, so both accept the same input.
 */

/**
 * Pull a tray label out of whatever the camera read. Labels are the tray
 * numbers stored in Supabase, but a QR may also carry a URL (the old desktop
 * app encoded `http://<lan-ip>:<port>/tray/<id>`), so take the last path
 * segment when it looks like one.
 */
export function parseScan(text: string): string {
  const raw = (text ?? '').trim()
  if (!raw) return ''
  const m = raw.match(/\/tray\/([^/?#\s]+)/i)
  if (m) return m[1]
  if (/^https?:\/\//i.test(raw)) {
    const seg = raw.split(/[?#]/)[0].replace(/\/+$/, '').split('/').pop()
    return seg ?? raw
  }
  return raw
}

/** Digits of a label, for prefix-tolerant matching (Tray0007 vs Trays7). */
const digits = (s: string) => s.replace(/\D/g, '').replace(/^0+/, '')

/**
 * Find the trays a scanned label refers to. Exact match wins; otherwise fall
 * back to the numeric part, because the real data mixes `Tray####` and
 * `Trays####` prefixes (no numeric collisions between them today).
 */
export function findTrays(all: Tray[], query: string): Tray[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const exact = all.filter((t) => t.trayNumber.toLowerCase() === q)
  if (exact.length) return exact
  const qd = digits(q)
  if (!qd) return []
  return all.filter((t) => digits(t.trayNumber) === qd)
}
