import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { LayoutDashboard, Map, Bug, Thermometer, Users, type LucideIcon } from 'lucide-react'
import { useSession, type Module } from '@/auth/session'
import { ErrorBoundary } from './ErrorBoundary'

interface SubNavItem {
  to: string
  label: string
  /** Exact-match highlight (for an index child that shares the parent path). */
  end?: boolean
}

interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  module: Module
  /** Optional subsections shown indented when this section is active. */
  children?: SubNavItem[]
}

const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, module: 'dashboard' },
  { to: '/maps', label: 'Shelter Maps', icon: Map, module: 'maps' },
  {
    to: '/incubation',
    label: 'Incubation',
    icon: Bug,
    module: 'incubation',
    children: [
      { to: '/incubation', label: 'Incubators', end: true },
      { to: '/incubation/samples', label: 'Samples & Trays' },
    ],
  },
  { to: '/sensors', label: 'Sensors', icon: Thermometer, module: 'sensors' },
  { to: '/users', label: 'Users', icon: Users, module: 'users' },
]

function BeeMark() {
  return (
    <div className="flex items-center gap-2">
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand text-white">🐝</span>
      <span className="font-bold tracking-tight text-ink">TNT Operations</span>
    </div>
  )
}

function UserSwitcher() {
  const s = useSession()

  // Real auth: show who's signed in + a sign-out button (no identity switching).
  if (s.authMode === 'supabase') {
    return (
      <div className="flex items-center gap-3 text-sm">
        <span className="hidden text-slate-600 sm:inline">
          {s.user.name}
          <span className="text-slate-400"> · {s.user.role}</span>
        </span>
        <button className="btn-ghost" onClick={() => s.signOut()}>
          Sign out
        </button>
      </div>
    )
  }

  // Mock: switch between the seeded users.
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="hidden text-slate-500 sm:inline">Signed in as</span>
      <select
        className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"
        value={s.user.id}
        onChange={(e) => s.switchUser(e.target.value)}
      >
        {s.users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}
          </option>
        ))}
      </select>
    </label>
  )
}

export default function Layout() {
  const s = useSession()
  const { pathname } = useLocation()
  const items = NAV.filter((n) => s.can(n.module, 'view'))
  const currentLabel = NAV.find((n) => n.to === pathname)?.label

  return (
    <div className="flex h-full flex-col">
      {/* Top bar */}
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2.5 md:px-6">
        <BeeMark />
        <UserSwitcher />
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Sidebar (desktop) */}
        <nav className="hidden w-56 shrink-0 border-r border-slate-200 bg-white p-3 md:block">
          {items.map((n) => {
            const sectionActive = n.to !== '/' && pathname.startsWith(n.to)
            return (
              <div key={n.to}>
                <NavItemLink item={n} />
                {n.children && sectionActive && (
                  <div className="mb-1 ml-9 flex flex-col border-l border-slate-200 pl-2">
                    {n.children.map((c) => (
                      <NavLink
                        key={c.to}
                        to={c.to}
                        end={c.end}
                        className={({ isActive }) =>
                          `rounded-md px-2 py-1.5 text-sm transition ${
                            isActive ? 'font-semibold text-brand' : 'text-slate-600 hover:bg-slate-100'
                          }`
                        }
                      >
                        {c.label}
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </nav>

        {/* Content — a per-route boundary keeps the nav usable if a screen crashes */}
        <main className="min-w-0 flex-1 overflow-y-auto bg-slate-50">
          <ErrorBoundary key={pathname} label={currentLabel}>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>

      {/* Bottom tab bar (mobile) */}
      <nav className="flex items-stretch justify-around border-t border-slate-200 bg-white md:hidden">
        {items.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.to === '/'}
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] ${isActive ? 'text-brand' : 'text-slate-500'}`
            }
          >
            <n.icon size={20} />
            {n.label.split(' ')[0]}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}

function NavItemLink({ item }: { item: NavItem }) {
  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      className={({ isActive }) =>
        `mb-1 flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
          isActive ? 'bg-brand text-white' : 'text-slate-700 hover:bg-slate-100'
        }`
      }
    >
      <item.icon size={18} />
      {item.label}
    </NavLink>
  )
}
