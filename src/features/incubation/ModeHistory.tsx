/**
 * When this incubator's temperature setting was changed, and to what.
 *
 * Reads the log written by the database trigger (migration 0025) rather than
 * inferring anything, so it shows the ACT of changing a setting — including a
 * change that never moved the temperature, which the report's measured-
 * temperature timeline cannot see.
 *
 * Before that migration is applied the query returns nothing and this renders
 * a line saying so, rather than an empty box that looks like "never changed".
 */
import { useEffect, useState } from 'react'
import { History } from 'lucide-react'
import { useData } from '@/data/context'
import { TEMP_MODES } from '@/domain/incubation'
import type { Incubator, IncubatorModeEvent } from '@/data/types'

const TZ = 'America/Edmonton'
const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })

const modeName = (m: string | null) =>
  m ? (TEMP_MODES[m as keyof typeof TEMP_MODES]?.label ?? m) : '—'

/** How many changes show before "show all". A season of ordinary use. */
const PREVIEW = 6

export function ModeHistory({ incubator }: { incubator: Incubator }) {
  const { fetchModeEvents } = useData()
  const [events, setEvents] = useState<IncubatorModeEvent[] | null>(null)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    let live = true
    // From the epoch to now: the whole history of this incubator. It is one row
    // per change, so even years of it is a short list.
    void fetchModeEvents(incubator.id, '1970-01-01T00:00:00.000Z', new Date().toISOString()).then(
      (rows) => {
        if (live) setEvents(rows)
      },
    )
    return () => {
      live = false
    }
  }, [incubator.id, fetchModeEvents])

  if (events === null) return null

  // Newest first — "what happened last" is the question being asked.
  const ordered = [...events].sort((a, b) => b.changedAt.localeCompare(a.changedAt))
  const shown = expanded ? ordered : ordered.slice(0, PREVIEW)

  return (
    <section className="rounded-lg bg-overlay p-3">
      <h3 className="label mb-2 flex items-center gap-1.5">
        <History size={13} /> Setting history
      </h3>

      {ordered.length === 0 ? (
        <p className="text-xs text-muted">
          No changes recorded yet. Logging starts once migration 0025 is applied; the report can still
          read earlier settings back from the measured temperature.
        </p>
      ) : (
        <>
          <ul className="divide-y divide-subtle">
            {shown.map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-1.5 text-sm">
                <span className="text-primary">
                  {e.fromMode ? (
                    <>
                      <span className="text-muted">{modeName(e.fromMode)}</span>
                      <span className="mx-1.5 text-faint">→</span>
                    </>
                  ) : null}
                  <span className="font-semibold">{modeName(e.toMode)}</span>
                </span>
                <span className="text-xs tabular-nums text-secondary">
                  {e.backfilled ? 'date not recorded' : fmtWhen(e.changedAt)}
                </span>
                {e.backfilled && (
                  <span className="text-xs text-muted">— the setting when logging began</span>
                )}
              </li>
            ))}
          </ul>
          {ordered.length > PREVIEW && (
            <button
              className="mt-1.5 text-xs text-secondary underline underline-offset-2 hover:text-primary"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? 'Show fewer' : `Show all ${ordered.length}`}
            </button>
          )}
        </>
      )}
    </section>
  )
}
