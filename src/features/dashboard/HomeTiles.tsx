/**
 * The phone home screen: big shortcut tiles, chosen by the person using them.
 *
 * The sidebar has eleven sections and the phone's bottom bar holds four, so the
 * things people actually do all day — scan a block, tick a step, see today —
 * are two or three taps in. These tiles put a person's own six on the first
 * screen, and because a crew lead and the office want completely different six,
 * the choice lives on the profile rather than in the code.
 *
 * Phone only (`md:hidden`). On a desktop the sidebar is already visible and a
 * second copy of it as tiles would be noise.
 */
import { Link } from 'react-router-dom'
import * as icons from 'lucide-react'
import { useSession } from '@/auth/session'
import { resolveTiles, type HomeTile } from '@/domain/homeTiles'

/** Lucide by name, with a safe fallback so a typo cannot blank the screen. */
function TileIcon({ name, size = 22 }: { name: string; size?: number }) {
  const Cmp = (icons as unknown as Record<string, React.ComponentType<{ size?: number }>>)[name]
  const Fallback = icons.Square
  const C = Cmp ?? Fallback
  return <C size={size} />
}

export function HomeTiles() {
  const s = useSession()
  const tiles = resolveTiles(s.user.homeTiles, (m) => s.can(m as Parameters<typeof s.can>[0]))

  if (tiles.length === 0) {
    return (
      <section className="md:hidden">
        <p className="rounded-lg border border-subtle bg-overlay p-3 text-sm text-secondary">
          No shortcuts chosen.{' '}
          <Link to="/users/account" className="text-brand underline">
            Pick some in Settings
          </Link>
          .
        </p>
      </section>
    )
  }

  return (
    <section className="md:hidden">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-muted">Shortcuts</h2>
        <Link to="/users/account" className="text-xs text-faint underline">
          Edit
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {tiles.map((t) => (
          <Tile key={t.key} tile={t} />
        ))}
      </div>
    </section>
  )
}

/**
 * One tile. Deliberately large: this is meant to be hit with a thumb, in a
 * truck, sometimes with a glove on — so the whole card is the target rather
 * than a label inside it.
 */
function Tile({ tile }: { tile: HomeTile }) {
  return (
    <Link
      to={tile.to}
      className="flex min-h-24 flex-col justify-between rounded-lg border border-subtle bg-raised p-3 transition active:scale-[0.98]"
    >
      <span className="text-brand">
        <TileIcon name={tile.icon} />
      </span>
      <span className="text-sm font-semibold leading-tight text-primary">{tile.label}</span>
    </Link>
  )
}
