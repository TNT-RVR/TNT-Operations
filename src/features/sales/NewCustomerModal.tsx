/**
 * Create a customer without leaving what you were doing.
 *
 * ── Why it collects first and saves once ─────────────────────────────────────
 *
 * The Customers screen used to create a row called "New customer" the moment
 * you clicked Add, then save each keystroke into it. That leaves a junk row
 * behind every time someone changes their mind, and those rows are worse than
 * clutter here: this form is reached mid-invoice, so an abandoned attempt would
 * put a nameless customer in the dropdown you are about to choose from.
 *
 * So nothing is written until Save, and the caller gets the new id back.
 */
import { useState } from 'react'
import { Button, Input, Modal } from '@/components/ui'
import { useData } from '@/data/context'
import type { SalesCustomer } from '@/data/types'

/** Everything worth capturing. Only one of company/contact is required. */
const FIELDS = [
  ['company', 'Company'],
  ['contactName', 'Contact'],
  ['email', 'Email'],
  ['phone', 'Phone'],
  ['city', 'City'],
  ['region', 'Province / State'],
  ['postalCode', 'Postal / ZIP'],
  ['country', 'Country (ISO 2)'],
  ['taxId', 'EIN / BN'],
] as const

type Draft = Partial<Record<(typeof FIELDS)[number][0], string>>

export function NewCustomerModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  /** The new customer's id, so the caller can select it straight away. */
  onCreated: (id: string, customer: Partial<SalesCustomer>) => void
}) {
  const { addSalesCustomer } = useData()
  const [draft, setDraft] = useState<Draft>({ country: 'CA' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const set = (key: keyof Draft, value: string) => setDraft((d) => ({ ...d, [key]: value }))

  // Enough to tell this customer from another in a dropdown. Everything else
  // can be filled in later on the Customers screen — the point of this form is
  // to get back to the invoice.
  const named = Boolean(draft.company?.trim() || draft.contactName?.trim())
  const foreign = (draft.country ?? 'CA').trim().toUpperCase() !== 'CA'

  const save = async () => {
    if (!named) return
    setBusy(true)
    setError('')
    const cleaned: Draft = {}
    for (const [key] of FIELDS) {
      const v = draft[key]?.trim()
      if (v) cleaned[key] = key === 'country' ? v.toUpperCase() : v
    }
    const r = await addSalesCustomer(cleaned)
    setBusy(false)
    if (!r.ok || !r.id) return setError(r.error ?? 'Could not create the customer.')
    onCreated(r.id, cleaned)
  }

  return (
    <Modal title="New customer" onClose={onClose}>
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          {FIELDS.map(([key, label]) => (
            <label key={key} className="block">
              <span className="label">{label}</span>
              <Input
                value={draft[key] ?? ''}
                autoFocus={key === 'company'}
                onChange={(e) => set(key, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && named && !busy) void save()
                }}
              />
            </label>
          ))}
        </div>

        {/* A warning, not a gate. You may not have the EIN in front of you when
            the order comes in, and blocking here would send you away from the
            invoice — which is the thing this modal exists to avoid. */}
        {foreign && !draft.taxId?.trim() && (
          <p className="text-xs text-warn">
            No EIN. A customer outside Canada needs one before their customs paperwork will clear — you can add it
            later on the Customers screen.
          </p>
        )}
        {error && <p className="text-xs text-danger">{error}</p>}

        <div className="flex gap-2">
          <Button onClick={save} disabled={!named || busy}>
            {busy ? 'Saving…' : 'Save and use'}
          </Button>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          {!named && <span className="self-center text-xs text-muted">Enter a company or a contact name.</span>}
        </div>
      </div>
    </Modal>
  )
}
