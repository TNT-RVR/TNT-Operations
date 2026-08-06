/**
 * Shared chrome for the Sales section: the subsection tabs, and the one place
 * that calls `loadSales()`.
 *
 * The sales slice isn't fetched on mount — nothing outside this section reads
 * it — so every Sales screen mounts through here.
 */
import { useEffect, type ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { useData } from '@/data/context'
import { PageHeader } from '@/components/ui'

const TABS = [
  { to: '/sales', label: 'Estimates', end: true },
  { to: '/sales/invoices', label: 'Invoices' },
  { to: '/sales/inventory', label: 'Inventory' },
  { to: '/sales/products', label: 'Products' },
  { to: '/sales/customers', label: 'Customers' },
  { to: '/sales/quickbooks', label: 'QuickBooks' },
]

export function SalesChrome({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string
  subtitle?: string
  actions?: ReactNode
  children: ReactNode
}) {
  const { loadSales, salesLoading } = useData()
  useEffect(() => {
    void loadSales()
  }, [loadSales])

  return (
    <div>
      <PageHeader title={title} subtitle={subtitle} actions={actions} />
      <div className="border-b border-subtle px-4 md:px-6">
        <div className="flex flex-wrap items-center gap-1">
          {TABS.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={({ isActive }) =>
                `-mb-px border-b-2 px-4 py-2 text-sm font-medium ${
                  isActive ? 'border-brand text-brand' : 'border-transparent text-muted hover:text-secondary'
                }`
              }
            >
              {t.label}
            </NavLink>
          ))}
        </div>
      </div>
      <div className="p-4 md:p-6">
        {salesLoading ? <p className="text-sm text-muted">Loading…</p> : children}
      </div>
    </div>
  )
}

/** Money, in the order's own currency. */
export const fmtMoney = (n: number, currency: string): string =>
  `${n.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`

export const fmtNum = (n: number, dp = 0): string =>
  n.toLocaleString('en-CA', { minimumFractionDigits: 0, maximumFractionDigits: dp })
