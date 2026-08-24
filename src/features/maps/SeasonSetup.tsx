/**
 * Season Setup — the one place a year's fields are declared.
 *
 * Everything downstream reads this: the Overall Checklist's rows, Field Mode's
 * field list, the scanners, the season's analysis. Entering a field here is
 * meant to be the only time anyone types its name.
 *
 * ── Two records, not one ─────────────────────────────────────────────────────
 *
 * A FIELD is a place — its name is its identity and its boundary does not
 * change. A SEASON is one year's plan for it: company, crop, acres, how many
 * shelters are meant to go on it. Adding a field that already exists creates
 * only the season; the place is reused, which is what keeps four years of
 * history attached to one row rather than four spellings of it.
 *
 * ── Geometry is not here on purpose ──────────────────────────────────────────
 *
 * Copying a season forward brings the intake facts and deliberately leaves the
 * placement layout empty. Whether last year's rows, angles and spacing still
 * apply is a real question with a real alternative, and it deserves the map and
 * the measurements in front of you before you answer it. That step comes next.
 */
import { useEffect, useMemo, useState } from 'react'
import { CopyPlus, Plus, Trash2 } from 'lucide-react'
import { useData } from '@/data/context'
import { useSession } from '@/auth/session'
import { Badge, Button, EmptyState, Input, Modal, PageHeader, Select, StatTile } from '@/components/ui'
import type { FieldSeason, SeasonStatus } from '@/data/types'

const STATUSES: SeasonStatus[] = ['planned', 'active', 'complete', 'dropped']

const statusTone = (s: SeasonStatus): 'brand' | 'green' | 'neutral' | 'amber' =>
  s === 'active' ? 'green' : s === 'complete' ? 'neutral' : s === 'dropped' ? 'amber' : 'brand'

export default function SeasonSetup() {
  const {
    fieldSeasons,
    seasonsLoading,
    loadFieldSeasons,
    addFieldSeason,
    saveFieldSeason,
    removeFieldSeason,
    copySeasonForward,
  } = useData()
  const canEdit = useSession().can('maps', 'edit')

  const thisYear = new Date().getFullYear()
  const [year, setYear] = useState(String(thisYear))
  const [adding, setAdding] = useState(false)
  const [copying, setCopying] = useState(false)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')

  const prevYear = String(Number(year) - 1)

  useEffect(() => {
    void loadFieldSeasons(year)
  }, [loadFieldSeasons, year])
  // The previous season is loaded too — "copy forward" needs a list to offer,
  // and the totals below say what is already carried over.
  useEffect(() => {
    void loadFieldSeasons(prevYear)
  }, [loadFieldSeasons, prevYear])

  const rows = useMemo(
    () =>
      fieldSeasons
        .filter((s) => s.year === year)
        .sort((a, b) => (a.field?.name ?? '').localeCompare(b.field?.name ?? '')),
    [fieldSeasons, year],
  )
  const previous = useMemo(() => fieldSeasons.filter((s) => s.year === prevYear), [fieldSeasons, prevYear])

  const totals = useMemo(() => {
    const acres = rows.reduce((sum, r) => sum + (r.acres ?? 0), 0)
    const shelters = rows.reduce((sum, r) => sum + (r.plannedShelters ?? 0), 0)
    const missing = rows.filter((r) => !r.acres || !r.company).length
    return { acres, shelters, missing }
  }, [rows])

  const years = useMemo(() => {
    const ys = new Set<string>([String(thisYear), String(thisYear + 1)])
    for (const s of fieldSeasons) ys.add(s.year)
    return [...ys].sort().reverse()
  }, [fieldSeasons, thisYear])

  const patch = async (id: string, p: Parameters<typeof saveFieldSeason>[1]) => {
    setError('')
    const r = await saveFieldSeason(id, p)
    if (!r.ok) setError(r.error ?? 'Could not save')
  }

  const drop = async (s: FieldSeason) => {
    if (!window.confirm(`Take ${s.field?.name ?? 'this field'} out of ${year}? The field itself is kept.`)) return
    setError('')
    const r = await removeFieldSeason(s.id)
    if (!r.ok) setError(r.error ?? 'Could not remove')
  }

  return (
    <div>
      <PageHeader
        title="Season Setup"
        subtitle="The fields being pollinated this year, and what we know about each"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Select value={year} onChange={(e) => setYear(e.target.value)} className="w-28">
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </Select>
            {canEdit && (
              <>
                <Button variant="ghost" onClick={() => setCopying(true)} disabled={previous.length === 0}>
                  <CopyPlus size={16} /> Copy {prevYear}
                </Button>
                <Button onClick={() => setAdding(true)}>
                  <Plus size={16} /> Add field
                </Button>
              </>
            )}
          </div>
        }
      />

      <div className="space-y-4 p-4 md:p-6">
        {error && <p className="text-xs text-danger">{error}</p>}
        {note && <p className="rounded border border-subtle bg-overlay p-2 text-xs text-secondary">{note}</p>}

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatTile label="Fields" value={rows.length} hint={`${year} season`} />
          <StatTile label="Acres" value={totals.acres ? totals.acres.toFixed(0) : '—'} />
          <StatTile label="Shelters planned" value={totals.shelters || '—'} />
          <StatTile
            label="Needs detail"
            value={totals.missing}
            hint="missing acres or company"
            tone={totals.missing > 0 ? 'warn' : 'good'}
          />
        </div>

        {rows.length === 0 ? (
          <EmptyState>
            {seasonsLoading
              ? 'Loading…'
              : `Nothing set up for ${year} yet. ${
                  previous.length > 0 ? `Copy ${prevYear} forward, or add fields one at a time.` : 'Add the first field.'
                }`}
          </EmptyState>
        ) : (
          <div className="card overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="th text-left">Field</th>
                  <th className="th text-left">Company</th>
                  <th className="th text-left">Crop</th>
                  <th className="th text-right">Acres</th>
                  <th className="th text-right">Shelters</th>
                  <th className="th text-left">Status</th>
                  {canEdit && <th className="th" />}
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id} className="border-t border-subtle">
                    <td className="px-3 py-2">
                      <div className="font-medium text-primary">{s.field?.name ?? '—'}</div>
                      <div className="text-xs text-muted">
                        {[s.field?.grower, s.field?.lld].filter(Boolean).join(' · ')}
                        {s.copiedFrom && <span className="ml-1 text-faint">· copied forward</span>}
                      </div>
                    </td>
                    <td className="px-2 py-1">
                      <Input
                        aria-label={`Company for ${s.field?.name ?? 'field'}`}
                        defaultValue={s.company}
                        disabled={!canEdit}
                        onBlur={(e) => e.target.value !== s.company && void patch(s.id, { company: e.target.value })}
                      />
                    </td>
                    <td className="px-2 py-1">
                      <Input
                        aria-label={`Crop for ${s.field?.name ?? 'field'}`}
                        defaultValue={s.crop}
                        disabled={!canEdit}
                        onBlur={(e) => e.target.value !== s.crop && void patch(s.id, { crop: e.target.value })}
                      />
                    </td>
                    <td className="px-2 py-1">
                      <Input
                        type="number"
                        className="text-right tabular-nums"
                        aria-label={`Acres for ${s.field?.name ?? 'field'}`}
                        defaultValue={s.acres ?? ''}
                        disabled={!canEdit}
                        onBlur={(e) => {
                          const v = e.target.value === '' ? null : Number(e.target.value)
                          if (v !== s.acres) void patch(s.id, { acres: v })
                        }}
                      />
                    </td>
                    <td className="px-2 py-1">
                      <Input
                        type="number"
                        className="text-right tabular-nums"
                        aria-label={`Planned shelters for ${s.field?.name ?? 'field'}`}
                        defaultValue={s.plannedShelters ?? ''}
                        disabled={!canEdit}
                        onBlur={(e) => {
                          const v = e.target.value === '' ? null : Number(e.target.value)
                          if (v !== s.plannedShelters) void patch(s.id, { plannedShelters: v })
                        }}
                      />
                    </td>
                    <td className="px-2 py-1">
                      {canEdit ? (
                        <Select
                          value={s.status}
                          className="w-32"
                          onChange={(e) => void patch(s.id, { status: e.target.value as SeasonStatus })}
                        >
                          {STATUSES.map((st) => (
                            <option key={st} value={st}>
                              {st}
                            </option>
                          ))}
                        </Select>
                      ) : (
                        <Badge tone={statusTone(s.status)}>{s.status}</Badge>
                      )}
                    </td>
                    {canEdit && (
                      <td className="px-2 py-1 text-right">
                        <button
                          className="rounded-sm p-1.5 text-faint transition hover:bg-[color:var(--hover-wash)] hover:text-danger"
                          aria-label={`Remove ${s.field?.name ?? 'field'} from ${year}`}
                          onClick={() => void drop(s)}
                        >
                          <Trash2 size={15} />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-xs text-faint">
          Editing a box saves when you leave it. Removing a field takes it out of {year} only — the field, its
          boundary and its history stay.
        </p>
      </div>

      {adding && (
        <AddFieldDialog
          year={year}
          onClose={() => setAdding(false)}
          onAdd={async (input) => {
            const r = await addFieldSeason({ year, ...input })
            if (!r.ok) return r.error ?? 'Could not add'
            setNote(`${input.name} added to ${year}.`)
            return null
          }}
        />
      )}

      {copying && (
        <CopyForwardDialog
          fromYear={prevYear}
          toYear={year}
          seasons={previous}
          alreadyIn={new Set(rows.map((r) => r.fieldId))}
          onClose={() => setCopying(false)}
          onCopy={async (fieldIds) => {
            setError('')
            const r = await copySeasonForward({ fromYear: prevYear, toYear: year, fieldIds })
            if (!r.ok) {
              setError(r.error ?? 'Could not copy')
              return
            }
            setNote(
              `${r.created} field${r.created === 1 ? '' : 's'} carried into ${year}. Layouts are not copied — that is asked per field with a preview.`,
            )
            setCopying(false)
          }}
        />
      )}
    </div>
  )
}

/** Add one field to the season, creating the place if the name is new. */
function AddFieldDialog({
  year,
  onClose,
  onAdd,
}: {
  year: string
  onClose: () => void
  onAdd: (input: {
    name: string
    grower?: string
    lld?: string
    company?: string
    crop?: string
    acres?: number | null
  }) => Promise<string | null>
}) {
  const [name, setName] = useState('')
  const [grower, setGrower] = useState('')
  const [lld, setLld] = useState('')
  const [company, setCompany] = useState('')
  const [crop, setCrop] = useState('')
  const [acres, setAcres] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    const err = await onAdd({
      name,
      grower,
      lld,
      company,
      crop,
      acres: acres === '' ? null : Number(acres),
    })
    setBusy(false)
    if (err) setError(err)
    else onClose()
  }

  return (
    <Modal title={`Add a field to ${year}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <label className="block">
          <span className="label">Field name</span>
          <Input required autoFocus value={name} onChange={(e) => setName(e.target.value)} />
          <span className="text-xs text-faint">
            A name already on record is reused — you get this year&rsquo;s plan, not a second field.
          </span>
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="label">Grower</span>
            <Input value={grower} onChange={(e) => setGrower(e.target.value)} />
          </label>
          <label className="block">
            <span className="label">Company</span>
            <Input value={company} onChange={(e) => setCompany(e.target.value)} />
          </label>
          <label className="block">
            <span className="label">Crop</span>
            <Input value={crop} onChange={(e) => setCrop(e.target.value)} placeholder="Canola" />
          </label>
          <label className="block">
            <span className="label">Acres</span>
            <Input type="number" value={acres} onChange={(e) => setAcres(e.target.value)} />
          </label>
        </div>
        <label className="block">
          <span className="label">Legal land description</span>
          <Input value={lld} onChange={(e) => setLld(e.target.value)} placeholder="SW-35-8-21-W4" />
        </label>
        {error && <p className="text-xs text-danger">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || !name.trim()}>
            <Plus size={16} /> {busy ? 'Adding…' : 'Add field'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

/** Carry last season's fields forward — the annual job, as a list of ticks. */
function CopyForwardDialog({
  fromYear,
  toYear,
  seasons,
  alreadyIn,
  onClose,
  onCopy,
}: {
  fromYear: string
  toYear: string
  seasons: FieldSeason[]
  alreadyIn: Set<string>
  onClose: () => void
  onCopy: (fieldIds: string[]) => Promise<void>
}) {
  // Everything not already in the new season starts ticked: most fields come
  // back, so the quick job should be un-ticking the ones that do not.
  const available = seasons.filter((s) => !alreadyIn.has(s.fieldId))
  const [picked, setPicked] = useState<Set<string>>(() => new Set(available.map((s) => s.fieldId)))
  const [busy, setBusy] = useState(false)

  return (
    <Modal title={`Copy ${fromYear} into ${toYear}`} onClose={onClose}>
      <div className="space-y-3">
        {available.length === 0 ? (
          <p className="text-sm text-secondary">Every {fromYear} field is already in {toYear}.</p>
        ) : (
          <>
            <p className="text-sm text-secondary">
              Company, crop, acres and shelter counts come across. The placement layout does not — whether last
              year&rsquo;s rows still apply is asked per field, with the map in front of you.
            </p>
            <div className="max-h-72 space-y-1 overflow-y-auto rounded-sm border border-subtle p-2">
              {available.map((s) => (
                <label key={s.id} className="flex items-center gap-2 rounded-sm px-2 py-1 text-sm hover:bg-overlay">
                  <input
                    type="checkbox"
                    checked={picked.has(s.fieldId)}
                    onChange={(e) =>
                      setPicked((prev) => {
                        const next = new Set(prev)
                        if (e.target.checked) next.add(s.fieldId)
                        else next.delete(s.fieldId)
                        return next
                      })
                    }
                  />
                  <span className="flex-1 text-primary">{s.field?.name ?? s.fieldId}</span>
                  <span className="text-xs text-muted">{[s.company, s.crop].filter(Boolean).join(' · ')}</span>
                </label>
              ))}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-muted">
                {picked.size} of {available.length} selected
              </span>
              <div className="flex gap-2">
                <Button variant="ghost" type="button" onClick={() => setPicked(new Set())}>
                  None
                </Button>
                <Button
                  variant="ghost"
                  type="button"
                  onClick={() => setPicked(new Set(available.map((s) => s.fieldId)))}
                >
                  All
                </Button>
              </div>
            </div>
          </>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={busy || picked.size === 0}
            onClick={async () => {
              setBusy(true)
              await onCopy([...picked])
              setBusy(false)
            }}
          >
            <CopyPlus size={16} /> {busy ? 'Copying…' : `Carry ${picked.size} forward`}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
