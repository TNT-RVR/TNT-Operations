/**
 * Choosing what sits on your phone home screen.
 *
 * Two lists rather than one: the tiles you have, in the order they appear, and
 * everything else you could add. A single checklist would sort by catalogue
 * order and hide the thing that matters most here — that ORDER is a choice, and
 * the first tile is the one you hit without looking.
 *
 * Saves on every change. A settings panel with a Save button is a panel people
 * leave without pressing it.
 */
import { useState } from 'react'
import { ArrowDown, ArrowUp, Plus, RotateCcw, Smartphone, X } from 'lucide-react'
import { useSession } from '@/auth/session'
import { Badge, Button } from '@/components/ui'
import {
  DEFAULT_TILE_KEYS,
  HOME_TILES,
  availableTiles,
  moveTile,
  resolveTiles,
  toggleTile,
} from '@/domain/homeTiles'

export function HomeTilesSettings() {
  const s = useSession()
  const can = (m: string) => s.can(m as Parameters<typeof s.can>[0])
  const [error, setError] = useState('')

  // What is on the screen right now, as keys: either the person's own list or
  // the defaults they have not yet touched.
  const chosen = resolveTiles(s.user.homeTiles, can).map((t) => t.key)
  const available = availableTiles(can).filter((t) => !chosen.includes(t.key))

  const save = async (keys: string[]) => {
    setError('')
    const r = await s.setHomeTiles(keys)
    if (!r.ok) setError(r.error ?? 'Could not save')
  }

  const label = (key: string) => HOME_TILES.find((t) => t.key === key)?.label ?? key
  const hint = (key: string) => HOME_TILES.find((t) => t.key === key)?.hint ?? ''

  return (
    <section className="card">
      <div className="mb-1 flex items-center gap-2">
        <Smartphone size={16} className="text-muted" />
        <h2 className="font-bold text-primary">Phone shortcuts</h2>
      </div>
      <p className="mb-3 text-sm text-muted">
        The tiles on your home screen when you open the app on a phone. Yours alone — everyone picks their own.
      </p>
      {error && <p className="mb-2 text-xs text-danger">{error}</p>}

      <h3 className="label">On your home screen</h3>
      {chosen.length === 0 ? (
        <p className="mb-3 text-sm text-secondary">None. Add some below.</p>
      ) : (
        <ul className="mb-4 divide-y divide-subtle rounded-sm border border-subtle">
          {chosen.map((key, i) => (
            <li key={key} className="flex items-center gap-2 px-2 py-1.5">
              <span className="w-6 text-center text-xs text-faint tabular-nums">{i + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm text-primary">{label(key)}</span>
                <span className="block text-xs text-muted">{hint(key)}</span>
              </span>
              <button
                className="icon-btn inline-grid place-items-center rounded-sm text-faint hover:text-primary disabled:opacity-30"
                aria-label={`Move ${label(key)} up`}
                disabled={i === 0}
                onClick={() => void save(moveTile(chosen, key, -1))}
              >
                <ArrowUp size={15} />
              </button>
              <button
                className="icon-btn inline-grid place-items-center rounded-sm text-faint hover:text-primary disabled:opacity-30"
                aria-label={`Move ${label(key)} down`}
                disabled={i === chosen.length - 1}
                onClick={() => void save(moveTile(chosen, key, 1))}
              >
                <ArrowDown size={15} />
              </button>
              <button
                className="icon-btn inline-grid place-items-center rounded-sm text-faint hover:text-danger"
                aria-label={`Remove ${label(key)}`}
                onClick={() => void save(toggleTile(chosen, key))}
              >
                <X size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <h3 className="label">Add a shortcut</h3>
      {available.length === 0 ? (
        <p className="text-sm text-secondary">Everything you can open is already there.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {available.map((t) => (
            <button
              key={t.key}
              className="tap-target inline-flex items-center gap-1 rounded-pill border border-default px-2.5 py-1 text-xs text-secondary transition hover:border-brand hover:text-primary"
              title={t.hint}
              onClick={() => void save(toggleTile(chosen, t.key))}
            >
              <Plus size={13} /> {t.label}
            </button>
          ))}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button variant="ghost" onClick={() => void save(DEFAULT_TILE_KEYS)}>
          <RotateCcw size={15} /> Reset to the usual six
        </Button>
        {s.user.homeTiles == null && <Badge tone="neutral">using defaults</Badge>}
      </div>
    </section>
  )
}
