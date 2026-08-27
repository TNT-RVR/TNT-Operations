/**
 * The freight quote request, as a form rather than a photocopy.
 *
 * TNT sends this to Cole International for every US shipment, and has been
 * filling it in by hand from an invoice that already holds most of it. Here the
 * derived half is derived — parties, quantities, HS codes, values, pallets,
 * weights and freight class — and the form is only the answers a person has to
 * give: when the truck comes, what each end has, and how high the pallets are
 * stacked.
 *
 * ── Two rules this screen exists to enforce ──────────────────────────────────
 *
 * 1. NOTHING GOES OUT INCOMPLETE. Cole prices from this sheet, so a blank HS
 *    code is a quote that comes back wrong or comes back as a phone call. The
 *    blockers list is shown at the top and Print stays disabled until it clears.
 *
 * 2. EVERY SECTION EXPLAINS ITSELF. The person filling this in is the one who
 *    signs for it, and "freight class", "INCOTERM" and "country of origin" are
 *    all terms a carrier or a border officer will hold you to. Each section
 *    carries an info button off `docHelp.ts`.
 */
import { useEffect, useMemo, useState } from 'react'
import { useData } from '@/data/context'
import { Badge, Button, InfoDot, Input, Select } from '@/components/ui'
import { AlertTriangle, Printer, Save } from 'lucide-react'
import type { SalesOrder } from '@/data/types'
import { helpFor } from '@/domain/docHelp'
import { EMPTY_LOGISTICS, type QuoteLogistics, type YesNo } from '@/domain/freightQuote'
import { buildOrderQuote, packOrderLines } from './useOrderPricing'

/** The class settled on an item, if one has been. */
function specDefault(specs: Array<{ item: string; freightClass: number | null }>, item: string) {
  return specs.find((s) => s.item === item)?.freightClass ?? null
}

const fmt = (n: number) => n.toLocaleString('en-CA', { maximumFractionDigits: 0 })
const money = (n: number, c: string) =>
  `${n.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${c}`

export function FreightQuoteView({ order }: { order: SalesOrder }) {
  const { saveOrder, saveItemSpec, itemSpecs, salesCustomers, company } = useData()

  /*
   * Local edit state, saved on a button rather than on every keystroke:
   * `saveOrder` replaces the order's lines wholesale, and doing that on each
   * character typed into a class box is how a line goes missing.
   */
  const [logistics, setLogistics] = useState<QuoteLogistics>(order.shippingLogistics ?? EMPTY_LOGISTICS)
  const [lines, setLines] = useState(order.lines)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Re-seed when the order itself changes underneath (another tab, a reload).
  useEffect(() => {
    setLogistics(order.shippingLogistics ?? EMPTY_LOGISTICS)
    setLines(order.lines)
  }, [order])

  /*
   * Computed from what is ON SCREEN, not from what is saved. Answer the stacks
   * question and the pallet height, the density and the class all move with it
   * — a form where nothing responds until you press Save reads as broken, and
   * the whole point of asking is to see what the answer costs.
   */
  const quote = useMemo(() => {
    const packing = packOrderLines(lines, logistics, itemSpecs)
    return buildOrderQuote({
      order,
      logistics,
      lines,
      packing,
      itemSpecs,
      company,
      customer: salesCustomers.find((c) => c.id === order.customerId),
    })
  }, [order, logistics, lines, itemSpecs, company, salesCustomers])

  const dirty = useMemo(
    () =>
      JSON.stringify(logistics) !== JSON.stringify(order.shippingLogistics ?? EMPTY_LOGISTICS) ||
      JSON.stringify(lines) !== JSON.stringify(order.lines),
    [logistics, lines, order],
  )

  const set = <K extends keyof QuoteLogistics>(k: K, v: QuoteLogistics[K]) =>
    setLogistics((p) => ({ ...p, [k]: v }))

  const setPerItem = (item: string, patch: { stacksPerPallet?: number; stackable?: YesNo }) =>
    setLogistics((p) => ({
      ...p,
      perItem: { ...p.perItem, [item]: { ...p.perItem?.[item], ...patch } },
    }))

  const setLine = (id: string, patch: { freightClass?: number | null; nmfc?: string }) =>
    setLines((p) => p.map((l) => (l.id === id ? { ...l, ...patch } : l)))

  const save = async () => {
    setBusy(true)
    setError('')
    const r = await saveOrder(order.id, { shippingLogistics: logistics }, lines)
    setBusy(false)
    if (!r.ok) setError(r.error ?? 'Could not save')
  }

  const ready = quote.blockers.length === 0

  return (
    <div className="space-y-5">
      {quote.blockers.length > 0 && (
        <div className="print-hide rounded border border-danger/40 bg-[color:var(--danger-bg)] p-3">
          <p className="mb-1 flex items-center gap-2 text-xs font-semibold text-danger">
            <AlertTriangle size={14} /> Not ready to send — {quote.blockers.length} thing
            {quote.blockers.length === 1 ? '' : 's'} the quote needs
          </p>
          <ul className="space-y-1 text-xs text-secondary">
            {quote.blockers.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="print-target space-y-5">
        <PrintHeading order={order} />

        {/* ── Parties ── */}
        <div className="grid gap-4 sm:grid-cols-2">
          <PartyCard title="Shipper" help="shipper" party={quote.shipper} />
          <PartyCard title="Consignee" help="consignee" party={quote.consignee} />
        </div>

        {/* ── Shipment ── */}
        <Section title="Shipment" help="pickupDate">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Pickup date">
              <Input type="date" value={logistics.pickupDate} onChange={(e) => set('pickupDate', e.target.value)} />
            </Field>
            <Field label="Pickup hours">
              <Input value={logistics.pickupHours} onChange={(e) => set('pickupHours', e.target.value)} />
            </Field>
            <Field label="Delivery hours">
              <Input
                value={logistics.dropOffHours}
                placeholder="e.g. 7:00 AM – 3:30 PM"
                onChange={(e) => set('dropOffHours', e.target.value)}
              />
            </Field>
            <Field label="Mode">
              <Select
                className="print-hide"
                value={logistics.modeOfTransport}
                onChange={(e) => set('modeOfTransport', e.target.value as QuoteLogistics['modeOfTransport'])}
              >
                <option value="truck">Truck</option>
                <option value="air">Air</option>
                <option value="ocean">Ocean</option>
              </Select>
              <span className="hidden text-sm capitalize text-primary print:inline">
                {logistics.modeOfTransport || '\u2014'}
              </span>
            </Field>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="Terms of sale (INCOTERM)" help="incoterm">
              <p className="text-sm text-primary">{quote.incoterm || <Missing />}</p>
              <p className="print-hide mt-1 text-xs text-faint">Set on the order, since it is a term of the sale.</p>
            </Field>
            <Field label="Special equipment">
              <Input
                value={logistics.specialEquipment}
                placeholder="None"
                onChange={(e) => set('specialEquipment', e.target.value)}
              />
            </Field>
          </div>
        </Section>

        {/* ── Conditions at each end ── */}
        <Section title="Pickup and delivery conditions" help="logistics">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="th">Condition</th>
                  <th className="th">At pickup</th>
                  <th className="th">At delivery</th>
                </tr>
              </thead>
              <tbody>
                <ConditionRow
                  label="Appointment required"
                  a={logistics.pickupApptRequired}
                  b={logistics.dropApptRequired}
                  onA={(v) => set('pickupApptRequired', v)}
                  onB={(v) => set('dropApptRequired', v)}
                />
                <ConditionRow
                  label="Loading dock"
                  a={logistics.pickupLoadingDock}
                  b={logistics.dropLoadingDock}
                  onA={(v) => set('pickupLoadingDock', v)}
                  onB={(v) => set('dropLoadingDock', v)}
                />
                <ConditionRow
                  label="Liftgate needed"
                  a={logistics.pickupLiftgate}
                  b={logistics.dropLiftgate}
                  onA={(v) => set('pickupLiftgate', v)}
                  onB={(v) => set('dropLiftgate', v)}
                />
                <ConditionRow
                  label="Residential"
                  a={logistics.residentialPickup}
                  b={logistics.residentialDelivery}
                  onA={(v) => set('residentialPickup', v)}
                  onB={(v) => set('residentialDelivery', v)}
                />
              </tbody>
            </table>
          </div>
          {logistics.dropLoadingDock === 'no' && logistics.dropLiftgate !== 'yes' && (
            <p className="mt-2 flex items-start gap-2 text-xs text-warn">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              No dock at the delivery end and no liftgate on the truck means the driver cannot unload. The load
              comes back.
            </p>
          )}
        </Section>

        {/* ── Freight ── */}
        <Section title="Freight" help="handlingUnits">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="th">Item</th>
                  <th className="th">
                    <HeadWithHelp label="Units" help="handlingUnits" />
                  </th>
                  <th className="th print-hide">Stacks / pallet</th>
                  <th className="th">
                    <HeadWithHelp label="Dimensions (in)" help="dimensions" />
                  </th>
                  <th className="th">
                    <HeadWithHelp label="Weight (lb)" help="weight" />
                  </th>
                  <th className="th">
                    <HeadWithHelp label="Class" help="freightClass" />
                  </th>
                  <th className="th">NMFC</th>
                  <th className="th">
                    <HeadWithHelp label="Stackable" help="stackable" />
                  </th>
                </tr>
              </thead>
              <tbody>
                {quote.freight.map((row) => {
                  const line = lines.find((l) => (l.shipItem ?? l.description) === row.item)
                  return (
                    <tr key={row.item} className="border-t border-subtle align-top">
                      <td className="px-3 py-2 text-primary">{row.description}</td>
                      <td className="px-3 py-2 tabular-nums text-secondary">{row.units}</td>
                      <td className="print-hide px-3 py-2">
                        {/*
                          A loose item reports no stacks, because it has none —
                          anchors go in a tub. Its pallet height is measured on
                          the spec, so a box here would look like it moved
                          something and would not.
                        */}
                        {row.stacksPerPallet === 0 ? (
                          <span className="text-xs text-faint">loose</span>
                        ) : (
                          <Input
                            type="number"
                            min={1}
                            className="w-20"
                            value={logistics.perItem?.[row.item]?.stacksPerPallet ?? row.stacksPerPallet}
                            onChange={(e) =>
                              setPerItem(row.item, { stacksPerPallet: Math.max(1, Number(e.target.value) || 1) })
                            }
                          />
                        )}
                      </td>
                      <td className="px-3 py-2 tabular-nums text-secondary">{row.dimensions || <Missing />}</td>
                      <td className="px-3 py-2 tabular-nums text-secondary">{fmt(row.totalWeightLbs)}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          {/*
                            The computed class is IN the box, not behind it as a
                            placeholder: it is the app's answer, and a grey hint
                            reads as an empty field someone forgot. Typing over
                            it stores an override; clearing the box drops back to
                            computed, which then keeps following the load if it
                            is packed differently.
                          */}
                          <Input
                            type="number"
                            className="w-20 print-hide"
                            value={line?.freightClass ?? (row.computed.problem ? '' : row.computed.freightClass)}
                            onChange={(e) =>
                              line &&
                              setLine(line.id, {
                                freightClass: e.target.value === '' ? null : Number(e.target.value),
                              })
                            }
                          />
                          <span className="hidden tabular-nums text-secondary print:inline">
                            {row.freightClass ?? ''}
                          </span>
                          <span className="print-hide">
                            <InfoDot note={{ title: 'Freight class', body: row.classExplanation }} />
                          </span>
                        </div>
                        <span className="print-hide mt-1 block text-xs text-muted">
                          {row.overridden ? (
                            <>
                              <button
                                type="button"
                                className="underline decoration-dotted underline-offset-2 hover:text-brand"
                                onClick={() => line && setLine(line.id, { freightClass: null })}
                              >
                                overrides {row.computed.freightClass} &mdash; reset
                              </button>
                              {/*
                                A class a carrier has settled does not change
                                between shipments, so it belongs on the item
                                rather than being retyped onto every order. One
                                click puts it there and future orders start
                                from it.
                              */}
                              {itemSpecs.some((sp) => sp.item === row.item && sp.freightClass !== row.freightClass) && (
                                <button
                                  type="button"
                                  className="ml-2 underline decoration-dotted underline-offset-2 hover:text-brand"
                                  onClick={() =>
                                    row.freightClass != null &&
                                    saveItemSpec(row.item, { freightClass: row.freightClass, nmfc: row.nmfc })
                                  }
                                >
                                  always use for {row.item}
                                </button>
                              )}
                            </>
                          ) : row.computed.problem ? (
                            'no class yet'
                          ) : specDefault(itemSpecs, row.item) != null ? (
                            `${row.item}'s settled class`
                          ) : (
                            'computed from density'
                          )}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          className="w-24 print-hide"
                          value={line?.nmfc ?? ''}
                          onChange={(e) => line && setLine(line.id, { nmfc: e.target.value })}
                        />
                        <span className="hidden text-secondary print:inline">{row.nmfc}</span>
                      </td>
                      <td className="px-3 py-2">
                        <YesNoSelect
                          value={logistics.perItem?.[row.item]?.stackable ?? row.stackable}
                          onChange={(v) => setPerItem(row.item, { stackable: v })}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-default font-medium">
                  <td className="px-3 py-2 text-primary">Total</td>
                  <td className="px-3 py-2 tabular-nums text-primary">{quote.totals.units}</td>
                  <td className="print-hide" />
                  <td />
                  <td className="px-3 py-2 tabular-nums text-primary">{fmt(quote.totals.weightLbs)}</td>
                  <td colSpan={3} />
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="print-hide mt-2 text-xs text-faint">
            Pallet height is worked out from the item specs — how many fit a pallet, how tall they nest, and the
            stacks above — plus the pallet deck itself.
          </p>
        </Section>

        {/* ── Commercial ── */}
        <Section title="Commercial" help="unitValue">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="th">Description</th>
                  <th className="th">
                    <HeadWithHelp label="Origin" help="countryOfOrigin" />
                  </th>
                  <th className="th">Qty</th>
                  <th className="th">
                    <HeadWithHelp label="HS code" help="hsCode" />
                  </th>
                  <th className="th">
                    <HeadWithHelp label="Unit value" help="unitValue" />
                  </th>
                  <th className="th">Total</th>
                </tr>
              </thead>
              <tbody>
                {quote.commercial.map((c, i) => (
                  <tr key={i} className="border-t border-subtle">
                    <td className="px-3 py-2 text-primary">{c.description}</td>
                    <td className="px-3 py-2 text-secondary">{c.origin || <Missing />}</td>
                    <td className="px-3 py-2 tabular-nums text-secondary">{fmt(c.qty)}</td>
                    <td className="px-3 py-2 tabular-nums text-secondary">{c.hsCode || <Missing />}</td>
                    <td className="px-3 py-2 tabular-nums text-secondary">{money(c.unitValue, c.currency)}</td>
                    <td className="px-3 py-2 tabular-nums text-secondary">{money(c.total, c.currency)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-default font-medium">
                  <td colSpan={5} className="px-3 py-2 text-primary">
                    Total value
                  </td>
                  <td className="px-3 py-2 tabular-nums text-primary">
                    {money(quote.totals.value, order.currency)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="print-hide mt-2 text-xs text-faint">
            From the order lines, so the value quoted for freight and the value declared at the border are the
            same number. Change a price on the order, not here.
          </p>
        </Section>
      </div>

      {/* ── Actions ── */}
      <div className="print-hide flex flex-wrap items-center gap-3 border-t border-subtle pt-3">
        <Button onClick={save} disabled={!dirty || busy}>
          <Save size={16} /> {busy ? 'Saving…' : dirty ? 'Save answers' : 'Saved'}
        </Button>
        <Button variant="ghost" onClick={() => window.print()} disabled={!ready}>
          <Printer size={16} /> Print
        </Button>
        {ready ? (
          <Badge tone="green">Ready to send</Badge>
        ) : (
          <span className="text-xs text-muted">Clear the list above to enable printing.</span>
        )}
        {dirty && <span className="text-xs text-warn">Unsaved changes — printing uses the saved figures.</span>}
        {error && <span className="text-xs text-danger">{error}</span>}
      </div>
    </div>
  )
}

// ── Pieces ───────────────────────────────────────────────────────────────────

/** Only on paper: who this is, since the screen has the modal title for that. */
function PrintHeading({ order }: { order: SalesOrder }) {
  return (
    <div className="hidden print:block">
      <h1 className="text-lg font-semibold">Pricing Quote Request — Freight</h1>
      <p className="text-sm">
        Reference {order.number} · prepared {new Date().toLocaleDateString('en-CA')}
      </p>
    </div>
  )
}

function Section({ title, help, children }: { title: string; help?: string; children: React.ReactNode }) {
  return (
    <section className="card">
      <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold text-muted">
        {title}
        {help && (
          <span className="print-hide">
            <InfoDot note={helpFor(help)} />
          </span>
        )}
      </h3>
      {children}
    </section>
  )
}

function PartyCard({
  title,
  help,
  party,
}: {
  title: string
  help: string
  party: { company: string; address: string; cityRegion: string; postalCode: string; contactName: string; contactPhone: string; contactEmail: string }
}) {
  return (
    <Section title={title} help={help}>
      {party.company ? (
        <div className="space-y-0.5 text-sm text-secondary">
          <p className="font-medium text-primary">{party.company}</p>
          {party.address && <p>{party.address}</p>}
          <p>
            {party.cityRegion}
            {party.postalCode ? ` ${party.postalCode}` : ''}
          </p>
          {party.contactName && <p className="pt-1">{party.contactName}</p>}
          {party.contactPhone && <p>{party.contactPhone}</p>}
          {party.contactEmail && <p>{party.contactEmail}</p>}
        </div>
      ) : (
        <p className="text-sm text-muted">
          <Missing /> — set the customer on the order.
        </p>
      )}
    </Section>
  )
}

function Field({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label flex items-center gap-1.5">
        {label}
        {help && (
          <span className="print-hide">
            <InfoDot note={helpFor(help)} />
          </span>
        )}
      </span>
      {children}
    </label>
  )
}

function HeadWithHelp({ label, help }: { label: string; help: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {label}
      <span className="print-hide">
        <InfoDot note={helpFor(help)} />
      </span>
    </span>
  )
}

/**
 * A yes/no answer: a dropdown on screen, the word itself on paper.
 *
 * A printed `<select>` still draws its border and its arrow, which makes a
 * finished document look like a half-filled web form. The answer prints as
 * text instead, and an unanswered one prints as a dash rather than defaulting
 * to "No" — nobody should read a question that was never answered as a no.
 */
function YesNoSelect({ value, onChange }: { value: YesNo; onChange: (v: YesNo) => void }) {
  return (
    <>
      <Select
        className="w-24 print-hide"
        value={value}
        onChange={(e) => onChange(e.target.value as YesNo)}
      >
        <option value="">&mdash;</option>
        <option value="yes">Yes</option>
        <option value="no">No</option>
      </Select>
      <span className="hidden text-sm text-secondary print:inline">
        {value === 'yes' ? 'Yes' : value === 'no' ? 'No' : '\u2014'}
      </span>
    </>
  )
}

function ConditionRow({
  label,
  a,
  b,
  onA,
  onB,
}: {
  label: string
  a: YesNo
  b: YesNo
  onA: (v: YesNo) => void
  onB: (v: YesNo) => void
}) {
  return (
    <tr className="border-t border-subtle">
      <td className="px-3 py-2 text-secondary">{label}</td>
      <td className="px-3 py-2">
        <YesNoSelect value={a} onChange={onA} />
      </td>
      <td className="px-3 py-2">
        <YesNoSelect value={b} onChange={onB} />
      </td>
    </tr>
  )
}

const Missing = () => <span className="text-faint">—</span>
