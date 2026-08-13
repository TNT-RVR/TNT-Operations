import { useEffect, useState } from 'react'
import { Tent, Layers3, Users } from 'lucide-react'
import ShelterPlacement from './ShelterPlacement'
import TrayPlacement from './TrayPlacement'
import CrewsView from './CrewsView'

/**
 * Field Mode — the crew surface, now three views rather than one.
 *
 *   Shelter Placement — put shelters out against the grid from Shelter Maps.
 *   Tray Placement    — put trays into those shelters.
 *   Crews             — where every crew is and how far along they are.
 *
 * A shell rather than a router: the whole point of this screen is that it is
 * used in a moving vehicle with gloves on, so switching jobs must not cost a
 * page load, and the map must not be torn down and rebuilt when someone
 * glances at where the other crew is.
 *
 * The choice is remembered — a crew placing trays all week should not land on
 * shelter placement every morning.
 */

type View = 'shelter' | 'tray' | 'crews'

const TABS: Array<{ id: View; label: string; icon: typeof Tent }> = [
  { id: 'shelter', label: 'Shelters', icon: Tent },
  { id: 'tray', label: 'Trays', icon: Layers3 },
  { id: 'crews', label: 'Crews', icon: Users },
]

export default function FieldMode() {
  const [view, setView] = useState<View>(
    () => (localStorage.getItem('field.view') as View) ?? 'shelter',
  )

  useEffect(() => {
    try {
      localStorage.setItem('field.view', view)
    } catch {
      /* private mode — the choice just won't persist */
    }
  }, [view])

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col">
      {/* Tabs on top, not bottom: the bottom of a field screen is where the
          action buttons live, and a mis-tap there costs a wrong placement. */}
      <div className="flex shrink-0 border-b border-default bg-raised">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className="flex flex-1 items-center justify-center gap-2 px-2 py-3 text-sm font-medium"
            style={{
              color: view === id ? 'var(--brand)' : 'var(--text-secondary)',
              borderBottom: view === id ? '2px solid var(--brand)' : '2px solid transparent',
            }}
            onClick={() => setView(id)}
            aria-current={view === id ? 'page' : undefined}
          >
            <Icon size={18} />
            {label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1">
        {view === 'shelter' && <ShelterPlacement />}
        {view === 'tray' && <TrayPlacement />}
        {view === 'crews' && <CrewsView />}
      </div>
    </div>
  )
}
