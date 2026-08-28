/**
 * Everything recorded about one field, on a page you can link to.
 *
 * The office map answers "where do the shelters go"; this answers "what do we
 * know about this field" — acreage, the grower, the legal description, and the
 * full engine parameter set — without loading the authoring surface and its six
 * tool layers.
 *
 * The parameter table is GENERATED from the stored dict rather than written out
 * key by key. The field JSON carries about forty keys and gains one whenever the
 * placement engine does; a hand-maintained list would quietly stop showing the
 * newest thing anyone changed, which is exactly the thing worth seeing.
 */
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Map as MapIcon, Wallet } from 'lucide-react'
import { Badge, Button, Card, EmptyState, PageHeader, StatTile } from '@/components/ui'
import { useData } from '@/data/context'
import type { FieldGeometry } from '@/data/types'
import { BoundaryMap } from './BoundaryMap'

/** Keys already shown as headline stats or drawn on the map. */
const COVERED = new Set([
  'name',
  'company',
  'year',
  'lld',
  'acres',
  'boundary_polygon',
  'PP_Latitude',
  'PP_Longitude',
])

const str = (v: unknown): string => (v === undefined || v === null ? '' : String(v))

/** One stored value as something readable — arrays by size, not by contents. */
function describe(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (Array.isArray(value)) {
    if (value.length === 0) return 'none'
    // Say how much of it there is rather than printing 200 coordinate pairs
    // into a table cell. Two shapes look alike here and are not: a RING is a
    // list of points, while wet zones and access roads are lists of RINGS.
    if (Array.isArray(value[0]) && Array.isArray(value[0][0])) {
      return `${value.length} ring${value.length === 1 ? '' : 's'}`
    }
    if (typeof value[0] === 'object') return `${value.length} point${value.length === 1 ? '' : 's'}`
    return value.join(', ')
  }
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/** `bay_gap_in` → `Bay gap in`. The stored keys are the engine's own names. */
const humanise = (key: string): string =>
  key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())

export default function FieldInfo() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { fields } = useData()
  const field = fields.find((f) => f.id === id)

  if (!field) {
    return (
      <div>
        <PageHeader title="Field" subtitle="Not found" />
        <div className="p-4 md:p-6">
          <EmptyState>
            That field is not on record.{' '}
            <Link to="/" className="text-brand underline">
              Back to the dashboard
            </Link>
            .
          </EmptyState>
        </div>
      </div>
    )
  }

  const geom: FieldGeometry = field.geometry ?? {}
  const year = str(geom.year)
  const company = str(geom.company) || field.client
  const lld = str(geom.lld)
  const acres = Number(geom.acres)

  const params = Object.entries(geom)
    .filter(([k, v]) => !COVERED.has(k) && v !== '' && v !== null && v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))

  return (
    <div>
      <PageHeader
        title={field.name}
        subtitle={[company, year].filter(Boolean).join(' · ') || 'Field details'}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={() => navigate(-1)}>
              <ArrowLeft size={16} /> Back
            </Button>
            <Button variant="ghost" onClick={() => navigate(`/maps?field=${field.id}`)}>
              <MapIcon size={16} /> Open in Shelter Maps
            </Button>
            <Button variant="ghost" onClick={() => navigate('/finances/costs')}>
              <Wallet size={16} /> Field costs
            </Button>
          </div>
        }
      />

      <div className="space-y-6 p-4 md:p-6">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatTile label="Shelters" value={field.shelterCount} hint="placed by the engine" />
          <StatTile label="Acres" value={Number.isFinite(acres) && acres > 0 ? acres.toFixed(1) : '—'} />
          <StatTile label="Season" value={year || '—'} />
          <StatTile label="Shape" value={field.shapeType} hint={lld || undefined} />
        </div>

        <BoundaryMap fields={[field]} className="h-[360px]" />

        <Card>
          <h2 className="mb-3 font-bold text-primary">Record</h2>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <Row label="Grower" value={company} />
            <Row label="Region" value={field.region} />
            <Row label="Legal land description" value={lld} />
            <Row label="Season" value={year} />
            <Row
              label="Last updated"
              value={new Date(field.updatedAt).toLocaleString('en-CA', { timeZone: 'America/Edmonton' })}
            />
            <Row label="Boundary" value={Array.isArray(geom.boundary_polygon) ? `${(geom.boundary_polygon as unknown[]).length} points` : 'from pivot + radius'} />
          </dl>
        </Card>

        <Card>
          <div className="mb-3 flex items-center gap-2">
            <h2 className="font-bold text-primary">Placement parameters</h2>
            <Badge tone="neutral">{params.length}</Badge>
          </div>
          {params.length === 0 ? (
            <p className="text-sm text-muted">Nothing recorded beyond the boundary.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="th text-left">Parameter</th>
                    <th className="th text-left">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {params.map(([key, value]) => (
                    <tr key={key} className="border-t border-subtle">
                      <td className="px-3 py-1.5 text-secondary">{humanise(key)}</td>
                      <td className="px-3 py-1.5 tabular-nums text-primary">{describe(value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-subtle py-1.5 sm:border-0">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right text-primary">{value || '—'}</dd>
    </div>
  )
}
