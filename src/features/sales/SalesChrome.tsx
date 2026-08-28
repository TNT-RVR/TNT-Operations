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

/*
 * Sales' own tabs. Bee purchases is NOT among them any more — it moved out to
 * sit beside Sales under Finances. Buying bees is not a sale, and it never
 * shared anything with this data: no customer, no order, no invoice.
 */
const TABS = [
  { to: '/finances/sales', label: 'Estimates', end: true },
  { to: '/finances/sales/invoices', label: 'Invoices' },
  { to: '/finances/sales/inventory', label: 'Inventory' },
  { to: '/finances/sales/products', label: 'Products' },
  { to: '/finances/sales/shipping', label: 'Shipping specs' },
  { to: '/finances/sales/customers', label: 'Customers' },
]

/**
 * Shared chrome for anything under Finances.
 *
 * It does two jobs: it is the ONE place that calls `loadSales()` (the slice is
 * not fetched on mount because nothing outside this section reads it), and it
 * renders the tab strip.
 *
 * `tabs` is what separates the two views. Sales gets its own six; Bee purchases
 * passes none, because it is a sibling of Sales now rather than a tab inside
 * it — and a page showing another view's tabs is a page that looks like it is
 * somewhere it isn't. It still comes through here for the data.
 */
export function SalesChrome({
  title,
  subtitle,
  actions,
  tabs = TABS,
  children,
}: {
  title: string
  subtitle?: string
  actions?: ReactNode
  /** Null for a view that is not part of the Sales tab set. */
  tabs?: typeof TABS | null
  children: ReactNode
}) {
  const { loadSales, salesLoading } = useData()
  useEffect(() => {
    void loadSales()
  }, [loadSales])

  return (
    <div>
      <PageHeader title={title} subtitle={subtitle} actions={actions} />
      {tabs && tabs.length > 0 && (
      <div className="border-b border-subtle px-4 md:px-6">
        <div className="flex flex-wrap items-center gap-1">
          {tabs.map((t) => (
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
      )}
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
