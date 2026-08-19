import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { LayoutDashboard, Map, Bug, Bell, PanelLeftClose, PanelLeftOpen, Moon, Sun, Navigation, Banknote, CalendarDays, Boxes, MoreHorizontal, ChartScatter, Receipt, ListChecks, SlidersHorizontal, type LucideIcon } from 'lucide-react'
import { useSession, type Module, type Role } from '@/auth/session'
import { useData } from '@/data/context'
import { useTheme } from '@/styles/theme'
import { Avatar, IconButton } from './ui'
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
  /**
   * Roles that never see this link. The route refuses them too (see
   * Protected's denyRoles) — a hidden link is tidiness, not a permission.
   */
  denyRoles?: readonly Role[]
}

interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  module: Module
  /** Optional subsections shown indented when this section is active. */
  children?: SubNavItem[]
  /**
   * Gets a permanent slot in the phone tab bar. Only the sections actually used
   * on a phone in the shop or the field — the rest live behind "More", because
   * eight labels collide at 375px.
   */
  mobilePrimary?: boolean
}

const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, module: 'dashboard', mobilePrimary: true },
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
  {
    to: '/field',
    label: 'Field Mode',
    icon: Navigation,
    module: 'field',
    mobilePrimary: true,
    children: [
      // Placement is reached THROUGH a work order, not from the nav: the order
      // carries the field, the job and the load list, and starting from the
      // map means starting without any of it.
      { to: '/field', label: 'Work orders', end: true },
      { to: '/field/crews', label: 'Crews' },
    ],
  },
  {
    to: '/incubation',
    label: 'Incubation',
    icon: Bug,
    module: 'incubation',
    mobilePrimary: true,
    children: [
      { to: '/incubation', label: 'Incubators', end: true },
      { to: '/incubation/scan', label: 'Scan' },
      { to: '/incubation/samples', label: 'Samples' },
      { to: '/incubation/trays', label: 'Trays' },
      { to: '/incubation/lineage', label: 'Lineage' },
      { to: '/incubation/alerts', label: 'Alerts' },
    ],
  },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays, module: 'calendar', mobilePrimary: true },
  {
    to: '/blocks',
    label: 'Blocks',
    icon: Boxes,
    module: 'blocks',
    children: [
      // A crew iPad scans and looks things up; the season overview and the
      // returns map are office reading.
      { to: '/blocks', label: 'Overview', end: true, denyRoles: ['device'] },
      { to: '/blocks/scan', label: 'Scan' },
      { to: '/blocks/list', label: 'Register' },
      { to: '/blocks/map', label: 'Returns map', denyRoles: ['device'] },
    ],
  },
  {
    to: '/tasks',
    label: 'Tasks',
    icon: ListChecks,
    module: 'tasks',
    children: [
      { to: '/tasks', label: 'Tasks', end: true },
      { to: '/tasks/checklists', label: 'Checklists' },
      { to: '/tasks/overall', label: 'Overall Checklist' },
    ],
  },
  {
    to: '/sales',
    label: 'Sales',
    icon: Receipt,
    module: 'sales',
    children: [
      { to: '/sales', label: 'Estimates', end: true },
      { to: '/sales/invoices', label: 'Invoices' },
      { to: '/sales/inventory', label: 'Inventory' },
      { to: '/sales/products', label: 'Products' },
      { to: '/sales/customers', label: 'Customers' },
      { to: '/sales/bees', label: 'Bee purchases' },
    ],
  },
  {
    to: '/analysis',
    label: 'Analysis',
    icon: ChartScatter,
    module: 'analysis',
    children: [
      { to: '/analysis', label: 'Overview', end: true },
      { to: '/analysis/fields', label: 'Fields' },
      { to: '/analysis/correlations', label: 'Correlations' },
      { to: '/analysis/weather', label: 'Weather' },
      { to: '/analysis/growers', label: 'Growers' },
      { to: '/analysis/map', label: 'Map' },
      { to: '/analysis/upload', label: 'Upload' },
    ],
  },
  { to: '/grants', label: 'Grants', icon: Banknote, module: 'grants' },
]

/**
 * Users & Settings. Kept out of NAV because the sidebar pins it to the bottom,
 * separated from the sections — but it is a destination like any other, so both
 * navigations build from it rather than the desktop one hardcoding it inline.
 * Defined here so there is one of it.
 */
export const USERS_ITEM: NavItem = {
  to: '/users',
  label: 'Users & Settings',
  icon: SlidersHorizontal,
  module: 'users',
}

/** Every destination a role can reach, desktop and mobile alike. */
export function reachableNav(can: (module: Module) => boolean): NavItem[] {
  return [...NAV.filter((n) => can(n.module)), ...(can('users') ? [USERS_ITEM] : [])]
}

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
      <div className="flex items-center gap-2 text-sm">
        <Avatar user={s.user} size="sm" isYou />
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
      <Avatar user={s.user} size="sm" isYou />
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
  /**
   * Everything reachable, INCLUDING the pinned Users entry.
   *
   * Users & Settings used to be rendered straight into the desktop sidebar and
   * was absent from NAV, so it never reached either mobile list — on a phone
   * there was no route to it at all. Both navigations now derive from this one
   * list, which is what makes that impossible rather than merely fixed.
   */
  const reachable = reachableNav((m) => s.can(m, 'view'))
  const mobilePrimary = reachable.filter((n) => n.mobilePrimary)
  const mobileMore = reachable.filter((n) => !n.mobilePrimary)
  const [moreOpen, setMoreOpen] = useState(false)
  /**
   * Sidebar hidden, remembered across sessions.
   *
   * The screens people stare at longest are the maps — a returns surface or a
   * field boundary — and 14rem of navigation is 14rem of map. Desktop only:
   * the phone has never had a sidebar.
   */
  const [navHidden, setNavHidden] = useState(() => localStorage.getItem('nav.hidden') === '1')
  const toggleNav = () => {
    setNavHidden((v) => {
      try {
        localStorage.setItem('nav.hidden', v ? '0' : '1')
      } catch {
        /* private mode — it just won't persist */
      }
      return !v
    })
  }
  // Close the sheet on navigation, so it never lingers over the new screen.
  useEffect(() => setMoreOpen(false), [pathname])

  return (
    <div className="flex h-full flex-col">
      {/* Top bar */}
      <header className="flex items-center justify-between border-b border-subtle bg-surface px-4 py-2.5 md:px-6">
        <div className="flex min-w-0 items-center gap-2">
          {/* Desktop only — the phone has never had a sidebar to hide. */}
          <button
            className="hidden rounded-md p-1.5 text-secondary hover:bg-overlay md:block"
            onClick={toggleNav}
            aria-label={navHidden ? 'Show navigation' : 'Hide navigation'}
            title={navHidden ? 'Show navigation' : 'Hide navigation'}
          >
            {navHidden ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
          <BrandMark />
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <NotifBell />
          <UserSwitcher />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Sidebar (desktop) */}
        {/*
          Sidebar. A flex COLUMN so Users & Settings can be pinned to the
          bottom: the section list scrolls, the settings link never leaves the
          viewport. It's the one destination people reach for from anywhere.
        */}
        <nav
          className={`hidden w-56 shrink-0 flex-col border-r border-subtle bg-surface p-3 ${
            navHidden ? 'md:hidden' : 'md:flex'
          }`}
        >
          <div className="min-h-0 flex-1 overflow-y-auto">
          {items.map((n) => {
            const sectionActive = n.to !== '/' && pathname.startsWith(n.to)
            return (
              <div key={n.to}>
                <NavItemLink item={n} />
                {n.children && sectionActive && (
                  <div className="mb-1 ml-9 flex flex-col border-l border-subtle pl-2">
                    {n.children
                      .filter((c) => !c.denyRoles?.includes(s.user.role))
                      .map((c) => (
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
          </div>

          {/* Pinned. Only rendered if the role can reach it — a viewer with no
              users access shouldn't see a permanent door to a locked room. */}
          {s.can('users') && (
            <div className="mt-2 shrink-0 border-t border-subtle pt-2">
              <NavItemLink item={USERS_ITEM} />
            </div>
          )}
        </nav>

        {/* Content — a per-route boundary keeps the nav usable if a screen crashes */}
        <main className="min-w-0 flex-1 overflow-y-auto bg-base">
          {/* Subsection strip (mobile only). The sidebar is desktop-only and the
              bottom bar carries only top-level items, so without this a phone
              cannot reach a subsection at all. */}
          {activeSection?.children && (
            <div className="sticky top-0 z-10 flex gap-1 overflow-x-auto border-b border-subtle bg-surface px-3 py-2 md:hidden">
              {activeSection.children
                .filter((c) => !c.denyRoles?.includes(s.user.role))
                .map((c) => (
                <NavLink
                  key={c.to}
                  to={c.to}
                  end={c.end}
                  className={({ isActive }) =>
                    `shrink-0 rounded-sm px-3 py-1.5 text-xs uppercase tracking-wide transition ${
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

      {/* Bottom tab bar (mobile). Four primary sections plus More — eight
          labels collide at 375px, which is every phone in the shop. */}
      <nav className="relative flex items-stretch justify-around border-t border-subtle bg-surface md:hidden">
        {mobilePrimary.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.to === '/'}
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] ${isActive ? 'text-brand' : 'text-muted'}`
            }
          >
            <n.icon size={20} />
            <span className="max-w-full truncate px-0.5">{n.label.split(' ')[0]}</span>
          </NavLink>
        ))}

        {mobileMore.length > 0 && (
          <button
            onClick={() => setMoreOpen((v) => !v)}
            className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] ${
              moreOpen || mobileMore.some((n) => pathname.startsWith(n.to)) ? 'text-brand' : 'text-muted'
            }`}
            aria-expanded={moreOpen}
            aria-label="More sections"
          >
            <MoreHorizontal size={20} />
            <span>More</span>
          </button>
        )}

        {moreOpen && (
          <>
            {/* Tap-away layer, so the sheet closes without a stray navigation. */}
            <button
              className="fixed inset-0 z-20 cursor-default"
              aria-label="Close menu"
              onClick={() => setMoreOpen(false)}
            />
            <div className="absolute bottom-full right-0 z-30 mb-px w-48 overflow-hidden rounded-t-lg border border-subtle bg-surface shadow-lg">
              {mobileMore.map((n) => (
                <NavLink
                  key={n.to}
                  to={n.to}
                  onClick={() => setMoreOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-3 border-b border-subtle px-4 py-3 text-sm last:border-b-0 ${
                      isActive ? 'bg-brand text-on-brand' : 'text-secondary'
                    }`
                  }
                >
                  <n.icon size={18} />
                  {n.label}
                </NavLink>
              ))}
            </div>
          </>
        )}
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
