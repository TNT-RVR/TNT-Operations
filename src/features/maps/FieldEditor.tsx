import type { FieldGeometry } from '@/data/types'

/**
 * Field placement editor. Presentational: it renders controls bound to a draft
 * geometry and reports every change up via `onChange` so the parent can recompute
 * `getTentPositions` and redraw the map live. The parent owns the draft + save.
 */
interface Props {
  name: string
  draft: FieldGeometry
  isPivot: boolean
  count: number
  dirty: boolean
  onName: (v: string) => void
  onChange: (key: string, value: unknown) => void
  onSave: () => void
  onCancel: () => void
}

const str = (v: unknown): string => (v === undefined || v === null ? '' : String(v))

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
        {suffix ? <span className="text-slate-400"> ({suffix})</span> : null}
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

export function FieldEditor({ name, draft, isPivot, count, dirty, onName, onChange, onSave, onCancel }: Props) {
  const mode = str(draft.shelter_mode) === 'spacing' ? 'spacing' : 'total'
  const useBays = draft.use_bays !== false && str(draft.use_bays) !== 'false'
  const excludeOutside = str(draft.shelters_in_outside_pass).toLowerCase() === 'no'

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <h2 className="font-bold">Edit field</h2>
        <span className="inline-flex items-center gap-1.5 text-sm">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-brand" />
          <span className="font-semibold text-slate-900">{count}</span>
          <span className="text-slate-500">shelters</span>
        </span>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <label className="block">
          <span className="label">Field name</span>
          <input className="input" value={name} onChange={(e) => onName(e.target.value)} />
        </label>

        <fieldset className="space-y-2">
          <span className="label">Placement</span>
          <div className="flex gap-2">
            {(['total', 'spacing'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => onChange('shelter_mode', m)}
                className={`flex-1 rounded-lg border px-3 py-1.5 text-sm ${
                  mode === m ? 'border-brand bg-brand-light font-semibold' : 'border-slate-300'
                }`}
              >
                {m === 'total' ? 'By count' : 'By spacing'}
              </button>
            ))}
          </div>
          {mode === 'total' ? (
            <NumField label="Number of shelters" fieldKey="num_structures" draft={draft} onChange={onChange} step="1" />
          ) : (
            <NumField label="Spacing" fieldKey="spacing" draft={draft} onChange={onChange} suffix="m" />
          )}
        </fieldset>

        <div className="grid grid-cols-2 gap-3">
          <NumField label="Sprayer width" fieldKey="Sprayer_width" draft={draft} onChange={onChange} suffix="ft" />
          <NumField label="Planting angle" fieldKey="Planting_angle" draft={draft} onChange={onChange} suffix="°" />
          {isPivot && <NumField label="Pivot radius" fieldKey="Radius" draft={draft} onChange={onChange} suffix="m" />}
          <NumField label="Track exclusion" fieldKey="track_exclusion_ft" draft={draft} onChange={onChange} suffix="ft" />
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={useBays}
            onChange={(e) => onChange('use_bays', e.target.checked)}
          />
          <span>Plant in bays (canola / hybrid seed)</span>
        </label>

        {useBays && (
          <div className="grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-3">
            <NumField label="Female rows" fieldKey="num_female_rows" draft={draft} onChange={onChange} step="1" />
            <NumField label="Male rows" fieldKey="num_male_rows" draft={draft} onChange={onChange} step="1" />
            <NumField label="Row spacing" fieldKey="row_spacing_in" draft={draft} onChange={onChange} suffix="in" />
            <label className="block">
              <span className="label">Bay layout</span>
              <select
                className="input"
                value={str(draft.row_layout) || 'centered'}
                onChange={(e) => onChange('row_layout', e.target.value)}
              >
                <option value="centered">Centered</option>
                <option value="outer">Outer</option>
              </select>
            </label>
          </div>
        )}

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={excludeOutside}
            onChange={(e) => onChange('shelters_in_outside_pass', e.target.checked ? 'No' : 'Yes')}
          />
          <span>Keep shelters out of the outside round (green-compliant)</span>
        </label>

        {isPivot && (
          <p className="rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-700">
            Tip: click the map to move the pivot centre.
          </p>
        )}
      </div>

      <div className="flex gap-2 border-t border-slate-200 p-3">
        <button className="btn-ghost flex-1" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn-primary flex-1" onClick={onSave} disabled={!dirty}>
          Save
        </button>
      </div>
    </div>
  )
}
