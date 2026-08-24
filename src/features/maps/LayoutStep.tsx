/**
 * "Use last year's layout on this field?" — with the map and the numbers first.
 *
 * A season copied forward carries its intake facts and no placement layout,
 * because whether last year's rows, angles and spacing still apply depends on
 * the crop and the company and is not a safe assumption. This is where that
 * question gets asked, per field, with the answer shown before it is committed:
 * the field's boundary, last season's settings applied to it, and the three
 * numbers anyone would check — shelters, acres, acres per shelter.
 *
 * The preview runs the SAME engine the map runs (`previewLayout` → the ported
 * `get_tent_positions`). If it says 132 shelters, the map will place 132.
 */
import { useMemo, useState } from 'react'
import { CheckCheck, PencilRuler } from 'lucide-react'
import { Badge, Button, Modal, StatTile } from '@/components/ui'
import type { Field, FieldSeason, PollinationField } from '@/data/types'
import { describeLayout, previewLayout } from '@/domain/seasonLayout'
import { BoundaryMap } from './BoundaryMap'

export function LayoutStep({
  season,
  field,
  previousSeason,
  onClose,
  onUse,
}: {
  season: FieldSeason
  field: PollinationField
  /** The season being copied from — null when there is nothing to reuse. */
  previousSeason: FieldSeason | null
  onClose: () => void
  onUse: (geometry: Record<string, unknown>) => Promise<string | null>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const source = previousSeason?.geometry ?? {}
  const preview = useMemo(() => previewLayout(field.boundary, source), [field.boundary, source])
  const settings = useMemo(() => describeLayout(source), [source])

  /**
   * The map wants a `Field`, and this field is not one yet — it is a place plus
   * a boundary. Shaped here rather than by widening BoundaryMap: the preview is
   * the only caller that has half a field, and giving the map an optional-
   * everything type would make every other caller's contract vaguer.
   */
  const asField: Field = {
    id: field.id,
    name: field.name,
    client: field.grower,
    region: field.region,
    shapeType: field.boundary.boundary_polygon ? 'polygon' : 'pivot',
    shelterCount: preview.shelters,
    updatedAt: new Date().toISOString(),
    geometry: field.boundary,
  }

  const use = async () => {
    setBusy(true)
    setError('')
    const err = await onUse(source)
    setBusy(false)
    if (err) setError(err)
    else onClose()
  }

  return (
    <Modal title={`${field.name} — ${season.year} layout`} onClose={onClose}>
      <div className="space-y-3">
        {previousSeason ? (
          <p className="text-sm text-secondary">
            This is {previousSeason.year}&rsquo;s layout applied to {field.name}&rsquo;s boundary. Nothing is saved
            until you accept it.
          </p>
        ) : (
          <p className="text-sm text-secondary">
            No earlier season to copy from — this field&rsquo;s layout has to be drawn on the map.
          </p>
        )}

        {settings.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {settings.map((s) => (
              <Badge key={s} tone="neutral">
                {s}
              </Badge>
            ))}
          </div>
        )}

        {preview.problem ? (
          <p className="rounded border border-warn/40 bg-warn/10 p-2 text-sm text-secondary">{preview.problem}</p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2">
              <StatTile label="Shelters" value={preview.shelters} />
              <StatTile label="Acres" value={preview.acres ? preview.acres.toFixed(1) : '—'} />
              <StatTile
                label="Acres each"
                value={preview.acresPerShelter ? preview.acresPerShelter.toFixed(2) : '—'}
              />
            </div>
            <BoundaryMap fields={[asField]} pins={preview.pins} className="h-[300px]" />
          </>
        )}

        {season.plannedShelters != null && preview.shelters > 0 && season.plannedShelters !== preview.shelters && (
          // Worth saying out loud: the intake number and what the layout
          // actually places are different claims, and this is the moment the
          // discrepancy is cheap to notice.
          <p className="text-xs text-warn">
            Intake says {season.plannedShelters} shelters planned; this layout places {preview.shelters}.
          </p>
        )}

        {error && <p className="text-xs text-danger">{error}</p>}

        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <Button variant="ghost" type="button" onClick={onClose}>
            <PencilRuler size={15} /> Start fresh
          </Button>
          <Button type="button" disabled={busy || !!preview.problem || preview.shelters === 0} onClick={() => void use()}>
            <CheckCheck size={16} /> {busy ? 'Saving…' : `Use this layout`}
          </Button>
        </div>
        <p className="text-right text-xs text-faint">
          Start fresh leaves the layout empty — draw it on the map when you are ready.
        </p>
      </div>
    </Modal>
  )
}
