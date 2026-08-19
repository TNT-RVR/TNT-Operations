import { useEffect, useMemo, useState } from 'react'
import { PageHeader, Badge } from '@/components/ui'
import { useData } from '@/data/context'
import { useSession } from '@/auth/session'
import type { Field } from '@/data/types'
import {
  resolvePrefsForYear,
  fieldCost,
  totalGals,
  mathTrays,
  totalTrays,
  type CostPrefs,
  type FieldCostResult,
} from '@/domain/cost'
import { getTentPositions } from '@/domain/tentGrid'
import { applyShelterOverrides, type ShelterOverrides } from '@/domain/shelterOverrides'
import { crewRoute } from '@/domain/crewRoute'
import { downloadText, slug } from './exports'

/**
 * Cost estimator / profitability / seasons — the Financial View (spec Part 8).
 * All pricing inputs are stored PER PRICING YEAR (missing years carry forward);
 * per-field costs come from the exact `fieldCost` port. Revenue = contract
 * $/acre per company.
 */

const num = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
const money = (v: number): string => `$${v.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const CONTRACT_COMPANIES = ['BASF', 'Bayer', 'Hytech', 'Proven Seeds', 'Corteva']

interface FieldRow {
  field: Field
  year: string
  shelters: number
  acres: number
  gallons: number
  trays: number
  routeKm: number
  cost: FieldCostResult
}

/** Numeric pref input bound to a draft CostPrefs. */
function P({
  label,
  k,
  draft,
  set,
  suffix,
}: {
  label: string
  k: keyof CostPrefs
  draft: CostPrefs
  set: (k: keyof CostPrefs, v: number) => void
  suffix?: string
}) {
  return (
    <label className="block">
      <span className="label">
        {label}
        {suffix ? <span className="text-faint"> ({suffix})</span> : null}
      </span>
      <input
        className="input"
        type="number"
        step="any"
        value={String(draft[k] ?? 0)}
        onChange={(e) => set(k, num(e.target.value))}
      />
    </label>
  )
}

export default function CostsHome() {
  const { fields, costPrefsByYear, saveCostPrefs } = useData()
  const canEdit = useSession().can('maps', 'edit')

  // Year scope: stored pricing years ∪ field years ∪ this year.
  const years = useMemo(() => {
    const ys = new Set<string>(Object.keys(costPrefsByYear))
    for (const f of fields) {
      const y = String(f.geometry?.year ?? '').trim()
      if (y) ys.add(y)
    }
    ys.add(String(new Date().getFullYear()))
    return [...ys].sort().reverse()
  }, [fields, costPrefsByYear])
  /**
   * Open on the CURRENT season, not the newest year present. `years` is a union
   * that includes anything already entered, so a 2027 field created while
   * planning would otherwise land the page on a year nobody is costing yet.
   * The current year is always in the list — it is added above.
   */
  const [year, setYear] = useState(() => String(new Date().getFullYear()))
  const [showPrefs, setShowPrefs] = useState(false)

  // Draft form for the selected year (whole-form carry-forward when unset).
  const resolved = useMemo(() => resolvePrefsForYear(costPrefsByYear, year), [costPrefsByYear, year])
  const [draft, setDraft] = useState<CostPrefs>(resolved)
  useEffect(() => setDraft(resolved), [resolved])
  const set = (k: keyof CostPrefs, v: number) => setDraft((p) => ({ ...p, [k]: v }))
  const setRate = (company: string, v: number) =>
    setDraft((p) => ({ ...p, contractPerAcre: { ...p.contractPerAcre, [company]: v } }))
  const dirty = JSON.stringify(draft) !== JSON.stringify(resolved)

  // Companies for the contracts card: the spec's contract customers ∪ field clients.
  const companies = useMemo(() => {
    const cs = new Set<string>(CONTRACT_COMPANIES)
    for (const f of fields) if (f.client) cs.add(f.client)
    for (const c of Object.keys(draft.contractPerAcre)) cs.add(c)
    return [...cs].sort()
  }, [fields, draft.contractPerAcre])

  // Per-field costs for the selected year (fields without geometry excluded).
  const rows: FieldRow[] = useMemo(() => {
    const out: FieldRow[] = []
    for (const f of fields) {
      const g = f.geometry
      if (!g) continue
      const fy = String(g.year ?? '').trim() || year
      if (fy !== year) continue
      try {
        const raw = getTentPositions(g)
        const pins =
          String(g.shelter_mode ?? '') === 'manual'
            ? raw
            : applyShelterOverrides(raw, g.shelter_overrides as ShelterOverrides | undefined)
        const n = pins.length || f.shelterCount
        const acres = num(g.acres)
        const gallons = totalGals(num(g.gals_per_acre ?? 3), acres)
        const trays = totalTrays(mathTrays(gallons, num(g.gals_per_tray ?? 2)), n)
        const routeKm = pins.length >= 2 ? crewRoute(g, pins).totalM / 1000 : 0
        const cost = fieldCost(
          {
            shelters: n,
            trays,
            gallons,
            acres,
            routeKm,
            rtKm: num(g.home_to_parking_km),
            rtMin: num(g.home_to_parking_min),
            company: f.client,
          },
          draft,
        )
        out.push({ field: f, year: fy, shelters: n, acres, gallons, trays, routeKm, cost })
      } catch {
        /* skip fields the engine can't cost */
      }
    }
    // Profitability ranking: profit/acre high → low, unknown last.
    return out.sort((a, b) => (b.cost.profitPerAcre ?? -Infinity) - (a.cost.profitPerAcre ?? -Infinity))
  }, [fields, year, draft])

  const totals = useMemo(() => {
    const t = { acres: 0, cost: 0, revenue: 0, profit: 0, shelters: 0 }
    for (const r of rows) {
      t.acres += r.acres
      t.cost += r.cost.total
      t.revenue += r.cost.contractValue
      t.profit += r.cost.netProfit
      t.shelters += r.shelters
    }
    return t
  }, [rows])

  function exportCsv() {
    const head =
      'field,company,acres,shelters,trays,gallons,route_km,items,chemical,fuel,labour,total,cost_per_acre,contract_rate,contract_value,net_profit,profit_per_acre'
    const lines = rows.map((r) =>
      [
        r.field.name,
        r.field.client,
        r.acres,
        r.shelters,
        r.trays,
        r.gallons,
        r.routeKm.toFixed(2),
        r.cost.items.total.toFixed(2),
        r.cost.chemical.toFixed(2),
        r.cost.fuelTotal.toFixed(2),
        r.cost.labourTotal.toFixed(2),
        r.cost.total.toFixed(2),
        r.cost.costPerAcre?.toFixed(2) ?? '',
        r.cost.contractRate,
        r.cost.contractValue.toFixed(2),
        r.cost.netProfit.toFixed(2),
        r.cost.profitPerAcre?.toFixed(2) ?? '',
      ].join(','),
    )
    downloadText(`${slug('costs ' + year)}.csv`, 'text/csv', [head, ...lines].join('\n') + '\n')
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Field Costs"
        subtitle="Cost estimator, profitability and season totals — priced per year"
        actions={
          <div className="flex items-center gap-2">
            <select className="input w-28" style={{ minHeight: 0 }} value={year} onChange={(e) => setYear(e.target.value)}>
              {years.map((y) => (
                <option key={y}>{y}</option>
              ))}
            </select>
            <button className="btn-ghost min-h-0 px-3 py-1.5 text-sm" onClick={() => setShowPrefs((v) => !v)}>
              {showPrefs ? 'Hide pricing' : 'Pricing inputs'}
            </button>
            <button className="btn-ghost min-h-0 px-3 py-1.5 text-sm" onClick={exportCsv} disabled={rows.length === 0}>
              CSV
            </button>
          </div>
        }
      />

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 md:p-6">
        {/* Pricing form (per year) */}
        {showPrefs && (
          <section className="card space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display font-bold text-primary">Pricing — {year}</h2>
              {canEdit && (
                <button className="btn-primary min-h-0 px-3 py-1.5 text-sm" disabled={!dirty} onClick={() => saveCostPrefs(year, draft)}>
                  Save pricing
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <P label="Shelter cost" k="costPerShelter" draft={draft} set={set} suffix="$" />
              <P label="Shelter life" k="shelterLifeYr" draft={draft} set={set} suffix="yr" />
              <P label="Tray cost" k="costPerTray" draft={draft} set={set} suffix="$" />
              <P label="Tray life" k="trayLifeYr" draft={draft} set={set} suffix="yr" />
              <P label="Block cost" k="costPerBlock" draft={draft} set={set} suffix="$" />
              <P label="Block life" k="blockLifeYr" draft={draft} set={set} suffix="yr" />
              <P label="Blocks / shelter" k="blocksPerShelter" draft={draft} set={set} />
              <P label="Flag cost" k="costPerFlag" draft={draft} set={set} suffix="$" />
              <P label="Flag life" k="flagLifeYr" draft={draft} set={set} suffix="yr" />
              <P label="Bees" k="costPerGalBee" draft={draft} set={set} suffix="$/gal" />
              <P label="Chemical" k="chemCostPerAcre" draft={draft} set={set} suffix="$/ac" />
              <P label="Fuel use" k="fuelLPerKm" draft={draft} set={set} suffix="L/km" />
              <P label="Fuel cost" k="fuelCostPerL" draft={draft} set={set} suffix="$/L" />
              <P label="Wage" k="payPerHour" draft={draft} set={set} suffix="$/hr" />
              <P label="Drive speed" k="driveSpeedKmh" draft={draft} set={set} suffix="km/h" />
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <P label="Setup crews" k="crewsSetup" draft={draft} set={set} />
              <P label="Setup emp/crew" k="empPerCrewSetup" draft={draft} set={set} />
              <P label="Setup handling" k="timeSetupMin" draft={draft} set={set} suffix="min/shelter" />
              <P label="Setup loading" k="loadSetupMinPerShelter" draft={draft} set={set} suffix="min/shelter" />
              <P label="Bees crews" k="crewsBees" draft={draft} set={set} />
              <P label="Bees emp/crew" k="empPerCrewBees" draft={draft} set={set} />
              <P label="Bees handling" k="timeBeesMin" draft={draft} set={set} suffix="min/shelter" />
              <P label="Bees loading" k="loadBeesMinPerTray" draft={draft} set={set} suffix="min/tray" />
              <P label="Removal crews" k="crewsRemoval" draft={draft} set={set} />
              <P label="Removal emp/crew" k="empPerCrewRemoval" draft={draft} set={set} />
              <P label="Removal handling" k="timeRemovalMin" draft={draft} set={set} suffix="min/shelter" />
              <P label="Removal loading" k="loadRemovalMinPerShelter" draft={draft} set={set} suffix="min/shelter" />
            </div>
            <div>
              <div className="label mb-2">Contracts ($/acre)</div>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                {companies.map((c) => (
                  <label key={c} className="block">
                    <span className="label">{c}</span>
                    <input
                      className="input"
                      type="number"
                      step="any"
                      value={String(draft.contractPerAcre[c] ?? '')}
                      onChange={(e) => setRate(c, num(e.target.value))}
                    />
                  </label>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* Season totals */}
        <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {[
            ['Fields', String(rows.length)],
            ['Acres', totals.acres.toLocaleString()],
            ['Total cost', money(totals.cost)],
            ['Revenue', money(totals.revenue)],
            ['Net profit', money(totals.profit)],
          ].map(([l, v]) => (
            <div key={l} className="card">
              <div className="label">{l}</div>
              <div className="mt-1 font-mono text-lg font-semibold tabular text-primary">{v}</div>
            </div>
          ))}
        </section>

        {/* Per-field cards, ranked by profit/acre */}
        {rows.length === 0 ? (
          <p className="text-sm text-muted">No costed fields for {year} — fields need geometry (and a matching year) to be estimated.</p>
        ) : (
          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {rows.map((r) => {
              const missing: string[] = []
              if (!r.acres) missing.push('acres')
              if (!r.shelters) missing.push('shelters')
              if (!r.cost.contractRate) missing.push('contract rate')
              if (!r.routeKm) missing.push('route')
              return (
                <div key={r.field.id} className="card">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold text-primary">{r.field.name}</div>
                      <div className="text-xs text-muted">
                        {r.field.client} · {r.acres || '—'} ac · {r.shelters} shelters · {r.trays} trays
                      </div>
                    </div>
                    {missing.length > 0 && <Badge tone="red">missing {missing.join(', ')}</Badge>}
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <div>
                      <div className="label">Cost / acre</div>
                      <div className="font-mono text-xl font-semibold tabular text-primary">
                        {r.cost.costPerAcre != null ? money(r.cost.costPerAcre) : '—'}
                      </div>
                    </div>
                    <div>
                      <div className="label">Profit / acre</div>
                      <div
                        className="font-mono text-xl font-semibold tabular"
                        style={{ color: (r.cost.profitPerAcre ?? 0) >= 0 ? 'var(--ok-fg)' : 'var(--danger-fg)' }}
                      >
                        {r.cost.profitPerAcre != null ? money(r.cost.profitPerAcre) : '—'}
                      </div>
                    </div>
                  </div>
                  <dl className="mt-3 space-y-1 text-xs">
                    {(
                      [
                        ['Items', r.cost.items.total - r.cost.items.bee],
                        ['Bees', r.cost.items.bee],
                        ['Chemical', r.cost.chemical],
                        ['Fuel', r.cost.fuelTotal],
                        ['Labour', r.cost.labourTotal],
                        ['— travel', r.cost.travelTotal],
                        ['Total cost', r.cost.total],
                        ['Contract value', r.cost.contractValue],
                        ['Net profit', r.cost.netProfit],
                      ] as const
                    ).map(([l, v]) => (
                      <div key={l} className="flex justify-between">
                        <dt className="text-muted">{l}</dt>
                        <dd className="font-mono tabular text-secondary">{money(v)}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )
            })}
          </section>
        )}
      </div>
    </div>
  )
}
