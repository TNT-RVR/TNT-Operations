/**
 * Loads the Alberta Township System survey table for the LLD lookup.
 *
 * The table is a static asset (`public/ats-townships.bin`, ~141 KiB) rather
 * than anything behind the data seam: it is survey data from the Government of
 * Alberta, identical for every user and every environment, so it has no
 * business in Supabase and would only make the mock provider lie.
 *
 * It is fetched the first time someone actually types a legal land description,
 * not on mount — most map sessions never use the lookup, and the map already
 * hydrates enough on load.
 */
import { useEffect, useState } from 'react'
import { parseTownshipTable, type TownshipTable } from '@/domain/ats'

/** Memoised across the app: the table is immutable, so one fetch is enough. */
let pending: Promise<TownshipTable | null> | null = null

export function loadTownshipTable(): Promise<TownshipTable | null> {
  if (!pending) {
    pending = fetch(`${import.meta.env.BASE_URL}ats-townships.bin`)
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .then((buf) => (buf ? parseTownshipTable(buf) : null))
      .catch(() => null)
      // A failed load must not be cached as a permanent "no survey data" —
      // the lookup still works on the grid tier, and the next attempt may
      // succeed (the crew app runs offline and comes back).
      .then((table) => {
        if (!table) pending = null
        return table
      })
  }
  return pending
}

/**
 * The survey table, once loaded. Null until then — callers fall back to the
 * grid tier, so the lookup answers immediately and sharpens a moment later
 * rather than blocking on a download.
 */
export function useTownshipTable(enabled: boolean): TownshipTable | null {
  const [table, setTable] = useState<TownshipTable | null>(null)

  useEffect(() => {
    if (!enabled || table) return
    let live = true
    void loadTownshipTable().then((t) => {
      if (live && t) setTable(t)
    })
    return () => {
      live = false
    }
  }, [enabled, table])

  return table
}
