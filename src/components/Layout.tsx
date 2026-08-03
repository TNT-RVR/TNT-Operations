import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { LayoutDashboard, Map, Bug, Thermometer, Users, Bell, Moon, Sun, Navigation, Banknote, type LucideIcon } from 'lucide-react'
import { useSession, type Module } from '@/auth/session'
import { useData } from '@/data/context'
import { useTheme } from '@/styles/theme'
import { IconButton } from './ui'
import { BeeMark } from './BeeMark'
import { ErrorBoundary } from './ErrorBoundary'

function ThemeToggle() {
  const { theme, toggle } = useTheme()
  return (
    <IconButton label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} onClick={toggle}>
      {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
    </IconButton>
  )
}

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
  {
    to: '/maps',
    label: 'Shelter Maps',
    icon: Map,
    module: 'maps',
    children: [
      { to: '/maps', label: 'Fields', end: true },
      { to: '/maps/costs', label: 'Costs' },
    ],
  },
  { to: '/field', label: 'Field Mode', icon: Navigation, module: 'maps' },
  {
    to: '/incubation',
    label: 'Incubation',
    icon: Bug,
    module: 'incubation',
    children: [
      { to: '/incubation', label: 'Incubators', end: true },
      { to: '/incubation/scan', label: 'Scan' },
      { to: '/incubation/samples', label: 'Samples' },
      { to: '/incubation/trays', label: 'Trays' },
      { to: '/incubation/lineage', label: 'Lineage' },
      { to: '/incubation/alerts', label: 'Alerts' },
    ],
  },
  { to: '/sensors', label: 'Sensors', icon: Thermometer, module: 'sensors' },
  { to: '/grants', label: 'Grants', icon: Banknote, module: 'grants' },
  { to: '/users', label: 'Users', icon: Users, module: 'users' },
]

function NotifBell() {
  const { notifications } = useData()
  const unread = notifications.filter((n) => !n.readAt).length
  return (
    <NavLink
      to="/notifications"
      title="Notifications"
      className={({ isActive }) =>
        `relative rounded-sm p-2 transition ${isActive ? 'bg-brand-subtle text-brand' : 'text-muted hover:bg-[color:var(--hover-wash)] hover:text-primary'}`
      }
    >
      <Bell size={20} />
      {unread > 0 && (
        <span
          className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full"
          style={{ background: 'var(--red-500)', boxShadow: '0 0 0 2px var(--bg-surface)' }}
        />
      )}
    </NavLink>
  )
}

function BrandMark() {
  return (
    <div className="flex items-center gap-2">
      <span className="shrink-0" style={{ color: 'var(--logo-ink)' }}>
        <BeeMark size={28} />
      </span>
      <span className="font-display font-bold tracking-tight text-primary">
        TNT <span className="text-brand">Operations</span>
      </span>
    </div>
  )
}

function UserSwitcher() {
  const s = useSession()

  // Real auth: show who's signed in + a sign-out button (no identity switching).
  if (s.authMode === 'supabase') {
    return (
      <div className="flex items-center gap-3 text-sm">
        <span className="hidden text-secondary sm:inline">
          {s.user.name}
          <span className="text-faint"> · {s.user.role}</span>
        </span>
        <button className="btn-ghost min-h-0 px-3 py-1.5 text-sm" onClick={() => s.signOut()}>
          Sign out
        </button>
      </div>
    )
  }

  // Mock: switch between the seeded users.
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="hidden text-muted sm:inline">Signed in as</span>
      <select
        className="rounded-sm border border-default bg-inset px-2 py-1.5 text-sm text-primary"
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
  /** The section the current route sits under, for the mobile subsection strip. */
  const activeSection = items.find((n) => n.to !== '/' && pathname.startsWith(n.to))

  return (
    <div className="flex h-full flex-col">
      {/* Top bar */}
      <header className="flex items-center justify-between border-b border-subtle bg-surface px-4 py-2.5 md:px-6">
        <BrandMark />
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <NotifBell />
          <UserSwitcher />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Sidebar (desktop) */}
        <nav className="hidden w-56 shrink-0 border-r border-subtle bg-surface p-3 md:block">
          {items.map((n) => {
            const sectionActive = n.to !== '/' && pathname.startsWith(n.to)
            return (
              <div key={n.to}>
                <NavItemLink item={n} />
                {n.children && sectionActive && (
                  <div className="mb-1 ml-9 flex flex-col border-l border-subtle pl-2">
                    {n.children.map((c) => (
                      <NavLink
                        key={c.to}
                        to={c.to}
                        end={c.end}
                        className={({ isActive }) =>
                          `rounded-sm px-2 py-1.5 text-sm transition ${
                            isActive ? 'font-semibold text-brand' : 'text-secondary hover:bg-[color:var(--hover-wash)]'
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
        <main className="min-w-0 flex-1 overflow-y-auto bg-base">
          {/* Subsection strip (mobile only). The sidebar is desktop-only and the
              bottom bar carries only top-level items, so without this a phone
              cannot reach a subsection at all. */}
          {activeSection?.children && (
            <div className="sticky top-0 z-10 flex gap-1 overflow-x-auto border-b border-subtle bg-surface px-3 py-2 md:hidden">
              {activeSection.children.map((c) => (
                <NavLink
                  key={c.to}
                  to={c.to}
                  end={c.end}
                  className={({ isActive }) =>
                    `shrink-0 rounded-sm px-3 py-1.5 font-mono text-xs uppercase tracking-wide transition ${
                      isActive ? 'bg-brand text-on-brand' : 'text-secondary hover:bg-[color:var(--hover-wash)]'
                    }`
                  }
                >
                  {c.label}
                </NavLink>
              ))}
            </div>
          )}
          <ErrorBoundary key={pathname} label={currentLabel}>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>

      {/* Bottom tab bar (mobile) */}
      <nav className="flex items-stretch justify-around border-t border-subtle bg-surface md:hidden">
        {items.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.to === '/'}
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] ${isActive ? 'text-brand' : 'text-muted'}`
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
        `mb-1 flex items-center gap-3 rounded-sm px-3 py-2 text-sm font-medium transition ${
          isActive ? 'bg-brand text-on-brand' : 'text-secondary hover:bg-[color:var(--hover-wash)]'
        }`
      }
    >
      <item.icon size={18} />
      {item.label}
    </NavLink>
  )
}
