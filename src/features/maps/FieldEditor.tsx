import { useState, type ReactNode } from 'react'
import type { FieldGeometry } from '@/data/types'

/**
 * Field placement editor. Presentational: it renders controls bound to a draft
 * geometry and reports every change up via `onChange` so the parent can recompute
 * `getTentPositions` and redraw the map live. The parent owns the draft + save.
 *
 * Surfaces the full parameter set the engine (`tentGrid.ts`) consumes — placement
 * modes (count/spacing/per-acre/acres-each/trays), separate spray vs plant angle,
 * bay layout incl. custom masks, and the advanced pivot/exclusion knobs.
 */
interface Props {
  name: string
  draft: FieldGeometry
  isPivot: boolean
  count: number
  dirty: boolean
  /** Save-time sanity warnings (fieldWarnings + compute checks). */
  warnings?: string[]
  onName: (v: string) => void
  onChange: (key: string, value: unknown) => void
  onSave: () => void
  onCancel: () => void
}

const str = (v: unknown): string => (v === undefined || v === null ? '' : String(v))
const truthy = (v: unknown): boolean => v === true || v === 'true' || v === 'Yes' || v === 'yes'

const SHELTER_MODES: Array<{ value: string; label: string }> = [
  { value: 'total', label: 'Total count' },
  { value: 'spacing', label: 'By spacing' },
  { value: 'per_acre', label: 'Shelters / acre' },
  { value: 'acres_per_shelter', label: 'Acres / shelter' },
  { value: 'trays_1', label: 'Trays (1 / shelter)' },
  { value: 'trays_2', label: 'Trays (2 / shelter)' },
  { value: 'manual', label: 'Manual pins' },
]

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-3">
      <div className="label mb-0">{title}</div>
      {children}
    </fieldset>
  )
}

function NumField({
  label,
  fieldKey,
  draft,
  onChange,
  step,
  suffix,
}: {
  label: string
  fieldKey: string
  draft: FieldGeometry
  onChange: (key: string, value: unknown) => void
  step?: string
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
        step={step ?? 'any'}
        value={str(draft[fieldKey])}
        onChange={(e) => onChange(fieldKey, e.target.value)}
      />
    </label>
  )
}

function TextField({
  label,
  fieldKey,
  draft,
  onChange,
  placeholder,
}: {
  label: string
  fieldKey: string
  draft: FieldGeometry
  onChange: (key: string, value: unknown) => void
  placeholder?: string
}) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <input className="input" value={str(draft[fieldKey])} placeholder={placeholder} onChange={(e) => onChange(fieldKey, e.target.value)} />
    </label>
  )
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm text-secondary">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  )
}

export function FieldEditor({ name, draft, isPivot, count, dirty, warnings = [], onName, onChange, onSave, onCancel }: Props) {
  const [showAdvanced, setShowAdvanced] = useState(false)
  const mode = str(draft.shelter_mode) || 'total'
  const useBays = draft.use_bays !== false && str(draft.use_bays) !== 'false'
  const excludeOutside = str(draft.shelters_in_outside_pass).toLowerCase() === 'no'
  const layout = str(draft.row_layout) || 'centered'
  const usesAcres = mode === 'per_acre' || mode === 'acres_per_shelter' || mode === 'trays_1' || mode === 'trays_2'
  const usesTrays = mode === 'trays_1' || mode === 'trays_2'

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-subtle px-4 py-3">
        <h2 className="font-display font-bold text-primary">Edit field</h2>
        <span className="inline-flex items-center gap-1.5 text-sm">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-brand" />
          <span className="font-mono tabular font-semibold text-primary">{count}</span>
          <span className="text-muted">shelters</span>
        </span>
      </div>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4">
        {/* Identity */}
        <Section title="Field">
          <label className="block">
            <span className="label">Field name</span>
            <input className="input" value={name} onChange={(e) => onName(e.target.value)} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <TextField label="Company" fieldKey="company" draft={draft} onChange={onChange} />
            <TextField label="Year" fieldKey="year" draft={draft} onChange={onChange} />
          </div>
          <TextField label="Legal land (LLD)" fieldKey="lld" draft={draft} onChange={onChange} placeholder="SW-35-8-21-W4" />
        </Section>

        {/* Placement */}
        <Section title="Placement">
          <label className="block">
            <span className="label">Method</span>
            <select className="input" value={mode} onChange={(e) => onChange('shelter_mode', e.target.value)}>
              {SHELTER_MODES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            {mode === 'total' && <NumField label="Number of shelters" fieldKey="num_structures" draft={draft} onChange={onChange} step="1" />}
            {mode === 'spacing' && <NumField label="Spacing" fieldKey="spacing" draft={draft} onChange={onChange} suffix="m" />}
            {mode === 'per_acre' && <NumField label="Shelters per acre" fieldKey="shelters_per_acre" draft={draft} onChange={onChange} />}
            {mode === 'acres_per_shelter' && <NumField label="Acres per shelter" fieldKey="acres_per_shelter" draft={draft} onChange={onChange} />}
            {usesTrays && <NumField label="Gallons / acre" fieldKey="gals_per_acre" draft={draft} onChange={onChange} />}
            {usesTrays && <NumField label="Gallons / tray" fieldKey="gals_per_tray" draft={draft} onChange={onChange} />}
            {usesAcres && <NumField label="Acres" fieldKey="acres" draft={draft} onChange={onChange} />}
          </div>
          {mode === 'manual' && (
            <p
              className="rounded-md px-3 py-2 text-xs"
              style={{ background: 'var(--info-bg)', border: '1px solid var(--info-bd)', color: 'var(--info-fg)' }}
            >
              Placed by hand. Use the map's “Add shelters” tool — drag to move, double-click to delete.
            </p>
          )}
          {usesTrays && (
            <label className="block">
              <span className="label">Tray distribution</span>
              <select className="input" value={str(draft.tray_distribution) || 'even'} onChange={(e) => onChange('tray_distribution', e.target.value)}>
                <option value="even">Even</option>
                <option value="proportional">Proportional</option>
              </select>
            </label>
          )}
        </Section>

        {/* Geometry */}
        <Section title="Field geometry">
          <div className="grid grid-cols-2 gap-3">
            <NumField label="Sprayer width" fieldKey="Sprayer_width" draft={draft} onChange={onChange} suffix="ft" />
            <NumField label="Spray angle" fieldKey="Spray_angle" draft={draft} onChange={onChange} suffix="°" />
            <NumField label="Planting angle" fieldKey="Planting_angle" draft={draft} onChange={onChange} suffix="°" />
            {isPivot && <NumField label="Pivot radius" fieldKey="Radius" draft={draft} onChange={onChange} suffix="m" />}
          </div>
        </Section>

        {/* Bays */}
        <Section title="Bays">
          <ToggleRow label="Plant in bays (canola / hybrid seed)" checked={useBays} onChange={(v) => onChange('use_bays', v)} />
          {useBays && (
            <div className="space-y-3 rounded-md bg-overlay p-3">
              <div className="grid grid-cols-2 gap-3">
                <NumField label="Female rows" fieldKey="num_female_rows" draft={draft} onChange={onChange} step="1" />
                <NumField label="Male rows" fieldKey="num_male_rows" draft={draft} onChange={onChange} step="1" />
                <NumField label="Row spacing" fieldKey="row_spacing_in" draft={draft} onChange={onChange} suffix="in" />
                <NumField label="Bay gap" fieldKey="bay_gap_in" draft={draft} onChange={onChange} suffix="in" />
                <label className="block">
                  <span className="label">Bay layout</span>
                  <select className="input" value={layout} onChange={(e) => onChange('row_layout', e.target.value)}>
                    <option value="centered">Centered</option>
                    <option value="outer">Outer</option>
                    <option value="custom">Custom mask</option>
                  </select>
                </label>
                <NumField label="Total rows" fieldKey="total_rows" draft={draft} onChange={onChange} step="1" />
              </div>
              {layout === 'custom' && (
                <label className="block">
                  <span className="label">Custom row mask (M/F per row)</span>
                  <input
                    className="input font-mono"
                    value={str(draft.custom_row_mask)}
                    placeholder="e.g. MFFFFFFFFM"
                    onChange={(e) => onChange('custom_row_mask', e.target.value.toUpperCase())}
                  />
                </label>
              )}
              <ToggleRow label="Swap bay phase each pass" checked={truthy(draft.pass_phase_swap)} onChange={(v) => onChange('pass_phase_swap', v)} />
            </div>
          )}
        </Section>

        {/* Exclusions */}
        <Section title="Exclusions">
          <div className="grid grid-cols-2 gap-3">
            <NumField label="Track exclusion" fieldKey="track_exclusion_ft" draft={draft} onChange={onChange} suffix="ft" />
            <NumField label="Pass edge buffer" fieldKey="pass_edge_buffer_ft" draft={draft} onChange={onChange} suffix="ft" />
          </div>
          <ToggleRow
            label="Keep shelters out of the outside round (green-compliant)"
            checked={excludeOutside}
            onChange={(v) => onChange('shelters_in_outside_pass', v ? 'No' : 'Yes')}
          />
        </Section>

        {/* Advanced */}
        <div>
          <button
            type="button"
            className="text-xs font-mono uppercase tracking-wider text-muted hover:text-secondary"
            onClick={() => setShowAdvanced((v) => !v)}
          >
            {showAdvanced ? '▾' : '▸'} Advanced
          </button>
          {showAdvanced && (
            <div className="mt-3 space-y-3">
              <ToggleRow label="Spray both ways (square grid)" checked={truthy(draft.spray_both_ways)} onChange={(v) => onChange('spray_both_ways', v)} />
              <ToggleRow label="Shelter at pivot centre" checked={truthy(draft.shelter_at_pivot)} onChange={(v) => onChange('shelter_at_pivot', v)} />
              <div className="grid grid-cols-2 gap-3">
                <NumField label="Directional offset" fieldKey="directional_offset" draft={draft} onChange={onChange} suffix="m" />
                <NumField label="Force row count" fieldKey="shelter_rows" draft={draft} onChange={onChange} step="1" suffix="blank = auto" />
              </div>
              {isPivot && (
                <>
                  <ToggleRow label="Second pivot" checked={truthy(draft.two_pivots)} onChange={(v) => onChange('two_pivots', v)} />
                  {truthy(draft.two_pivots) && (
                    <div className="grid grid-cols-2 gap-3 rounded-md bg-overlay p-3">
                      <NumField label="Pivot 2 latitude" fieldKey="PP2_Latitude" draft={draft} onChange={onChange} />
                      <NumField label="Pivot 2 longitude" fieldKey="PP2_Longitude" draft={draft} onChange={onChange} />
                      <NumField label="Pivot 2 radius" fieldKey="Radius2" draft={draft} onChange={onChange} suffix="m" />
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {isPivot && (
          <p className="rounded-md px-3 py-2 text-xs" style={{ background: 'var(--info-bg)', border: '1px solid var(--info-bd)', color: 'var(--info-fg)' }}>
            Tip: click the map to move the pivot centre.
          </p>
        )}
      </div>

      <div className="border-t border-subtle p-3">
        {warnings.length > 0 && (
          <div
            className="mb-2 space-y-1 rounded-md px-3 py-2 text-xs"
            style={{ background: 'var(--warn-bg)', border: '1px solid var(--warn-bd)', color: 'var(--warn-fg)' }}
          >
            <div className="font-semibold">Possible field issues</div>
            {warnings.map((w) => (
              <div key={w}>• {w}</div>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <button className="btn-ghost flex-1" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn-primary flex-1" onClick={onSave} disabled={!dirty}>
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
