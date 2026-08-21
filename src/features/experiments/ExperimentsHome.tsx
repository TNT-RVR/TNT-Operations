import { useEffect, useMemo, useState } from 'react'
import { ClipboardList, MapPin, QrCode, Trash2, X } from 'lucide-react'
import { PageHeader, EmptyState, Badge, Button } from '@/components/ui'
import { useData } from '@/data/context'
import { useSession } from '@/auth/session'
import { useGps } from '@/features/blocks/useGps'
import { ScannerOverlay, type ScanFeedback } from '@/features/incubation/ScannerOverlay'
import { parseScan, findTrays } from '@/features/incubation/trayLookup'
import { findBlock } from '@/domain/blocks'
import {
  canSaveNote,
  addItem,
  removeItem,
  countItems,
  experimentNames,
  type ItemKind,
  type NoteItem,
} from '@/domain/experiments'
import type { ExperimentNote } from '@/data/types'

const TZ = 'America/Edmonton'

const whenLabel = (iso: string) =>
  new Date(iso).toLocaleString('en-CA', {
    timeZone: TZ,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })

/**
 * Experiment notes — writing down what a trial did, and where it was seen.
 *
 * Deliberately one screen and one box. Trials get written up in the moment, on
 * a phone, often with a glove on, and every extra required field is a reason
 * the note gets taken on paper instead — which is the situation this replaces.
 *
 * So the note text is the only thing that matters. The experiment name, the
 * field, the blocks and trays, the GPS: each is there when the observer has it
 * and absent without complaint when they do not.
 */
export default function ExperimentsHome() {
  const {
    fields,
    blocks,
    trays,
    experimentNotes,
    loadExperimentNotes,
    saveExperimentNote,
    deleteExperimentNote,
  } = useData()
  const session = useSession()
  const canEdit = session.can('blocks', 'edit')

  useEffect(() => {
    void loadExperimentNotes()
  }, [loadExperimentNotes])

  // ── The note being written ────────────────────────────────────────────────
  const [open, setOpen] = useState(false)
  const [experiment, setExperiment] = useState('')
  const [notes, setNotes] = useState('')
  const [fieldId, setFieldId] = useState('')
  const [items, setItems] = useState<NoteItem[]>([])
  const [scanning, setScanning] = useState<ItemKind | null>(null)
  const [toast, setToast] = useState<ScanFeedback | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // GPS runs only while a note is open. A screen that reads the phone's
  // position for as long as it sits on this tab is a screen that flattens a
  // battery in a truck.
  const { fix } = useGps(open)

  const names = useMemo(() => experimentNames(experimentNotes), [experimentNotes])

  const reset = () => {
    setExperiment('')
    setNotes('')
    setFieldId('')
    setItems([])
    setError(null)
    setToast(null)
  }

  /**
   * A scan, resolved as far as it can be.
   *
   * An unmatched label is KEPT rather than refused: a block from another
   * operation, a tag from a previous season, a mis-read — each is something
   * somebody deliberately pointed a camera at, and each is worth having in the
   * record with the note beside it.
   */
  function handleScan(text: string) {
    const kind = scanning
    if (!kind) return
    const label = parseScan(text)
    if (!label) return

    const next: NoteItem =
      kind === 'tray'
        ? {
            kind,
            label,
            trayId: findTrays(trays, label)[0]?.id ?? null,
            lat: fix?.lat ?? null,
            lng: fix?.lng ?? null,
          }
        : {
            kind,
            label,
            blockId: findBlock(blocks, label)?.id ?? null,
            lat: fix?.lat ?? null,
            lng: fix?.lng ?? null,
          }

    const res = addItem(items, next)
    setItems(res.items)
    const known = kind === 'tray' ? next.trayId : next.blockId
    // seq bumps every scan so scanning the same tag twice still flashes —
    // otherwise a repeat looks identical to the camera not having fired.
    setToast({
      kind: res.added ? 'ok' : 'warn',
      title: label,
      detail: !res.added
        ? 'Already on this note'
        : known
          ? `${kind === 'tray' ? 'Tray' : 'Block'} added`
          : 'Not in the system — kept anyway',
      seq: (toast?.seq ?? 0) + 1,
    })
  }

  async function save() {
    const check = canSaveNote({ notes, items })
    if (!check.ok) {
      setError(check.reason)
      return
    }
    setSaving(true)
    setError(null)
    const res = await saveExperimentNote({
      experiment,
      notes,
      fieldId: fieldId || null,
      lat: fix?.lat ?? null,
      lng: fix?.lng ?? null,
      accuracyM: fix?.acc ?? null,
      observedAt: new Date().toISOString(),
      items: items.map((it) => ({
        kind: it.kind,
        label: it.label,
        blockId: it.blockId ?? null,
        trayId: it.trayId ?? null,
        lat: it.lat ?? null,
        lng: it.lng ?? null,
      })),
    })
    setSaving(false)
    if (!res.ok) {
      setError(res.error ?? 'Could not save that note.')
      return
    }
    reset()
    setOpen(false)
  }

  const fieldName = (id: string | null) =>
    id ? (fields.find((f) => f.id === id)?.name ?? 'a deleted field') : null

  return (
    <div>
      <PageHeader
        title="Experiments"
        subtitle="Notes from trials — what was seen, where, and on which blocks and trays"
        actions={
          canEdit && !open ? (
            <Button onClick={() => setOpen(true)}>
              <ClipboardList size={15} className="mr-1 inline" />
              New note
            </Button>
          ) : undefined
        }
      />

      <div className="space-y-4 p-4 md:p-6">
        {open && (
          <div className="card space-y-3">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-primary">New note</span>
              <button
                className="ml-auto text-faint hover:text-primary"
                onClick={() => {
                  setOpen(false)
                  reset()
                }}
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>

            {/* The box. First, biggest, and the only thing required. */}
            <label className="block">
              <span className="label">Notes</span>
              <textarea
                className="input w-full"
                rows={6}
                autoFocus
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="What did you see? Anything worth knowing in six months."
              />
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="label">Experiment</span>
                {/* A typed name, with the ones already used offered beneath it:
                    enough to keep spellings together without a setup screen. */}
                <input
                  className="input w-full"
                  list="experiment-names"
                  value={experiment}
                  onChange={(e) => setExperiment(e.target.value)}
                  placeholder="e.g. Tray density 2026"
                />
                <datalist id="experiment-names">
                  {names.map((n) => (
                    <option key={n} value={n} />
                  ))}
                </datalist>
              </label>

              <label className="block">
                <span className="label">Field (optional)</span>
                <select
                  className="input w-full"
                  value={fieldId}
                  onChange={(e) => setFieldId(e.target.value)}
                >
                  <option value="">No field</option>
                  {fields.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {/* Blocks and trays. Scanned, and both optional. */}
            <div>
              <span className="label">Blocks and trays (optional)</span>
              <div className="mt-1 flex flex-wrap gap-2">
                <Button variant="ghost" size="sm" onClick={() => setScanning('block')}>
                  <QrCode size={14} className="mr-1 inline" />
                  Scan block
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setScanning('tray')}>
                  <QrCode size={14} className="mr-1 inline" />
                  Scan tray
                </Button>
              </div>

              {items.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {items.map((it, i) => {
                    const known = it.kind === 'tray' ? it.trayId : it.blockId
                    return (
                      <li
                        key={`${it.kind}-${it.label}-${i}`}
                        className="flex items-center gap-2 rounded-md border border-default px-2 py-1 text-sm"
                      >
                        <Badge tone={it.kind === 'tray' ? 'green' : 'amber'}>
                          {it.kind === 'tray' ? 'Tray' : 'Block'}
                        </Badge>
                        <span className="font-mono text-primary">{it.label}</span>
                        {/* Said plainly rather than hidden: a label nothing
                            matched is the one worth a second look later. */}
                        {!known && <span className="text-xs text-amber-600">not in the system</span>}
                        {it.lat != null && <MapPin size={12} className="text-faint" />}
                        <button
                          className="ml-auto text-faint hover:text-primary"
                          onClick={() => setItems(removeItem(items, i))}
                          aria-label={`Remove ${it.label}`}
                        >
                          <X size={14} />
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>

            <p className="text-xs text-faint">
              {fix
                ? `Location will be saved (±${Math.round(fix.acc)} m).`
                : 'No GPS fix yet — the note saves without a location.'}
            </p>

            {error && (
              <p className="text-sm" style={{ color: 'var(--danger-fg)' }}>
                {error}
              </p>
            )}

            <div className="flex gap-2">
              <Button onClick={() => void save()} disabled={saving}>
                {saving ? 'Saving…' : 'Save note'}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setOpen(false)
                  reset()
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {experimentNotes.length === 0 ? (
          <EmptyState>
            No experiment notes yet. Write one from the field — the note itself is the only part
            that matters; everything else is optional.
          </EmptyState>
        ) : (
          <div className="space-y-2">
            {experimentNotes.map((n: ExperimentNote) => {
              const counts = countItems(n.items)
              return (
                <div key={n.id} className="rounded-md border border-default p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-primary">
                      {n.experiment.trim() || 'Unfiled'}
                    </span>
                    <span className="text-xs text-faint">{whenLabel(n.observedAt)}</span>
                    {fieldName(n.fieldId) && (
                      <span className="text-sm text-secondary">
                        <MapPin size={12} className="mr-1 inline text-faint" />
                        {fieldName(n.fieldId)}
                      </span>
                    )}
                    {counts.blocks > 0 && <Badge tone="amber">{counts.blocks} blocks</Badge>}
                    {counts.trays > 0 && <Badge tone="green">{counts.trays} trays</Badge>}
                    {canEdit && (
                      <button
                        className="ml-auto text-faint hover:text-primary"
                        onClick={() => void deleteExperimentNote(n.id)}
                        aria-label="Delete this note"
                        title="Delete this note"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                  {n.notes.trim() !== '' && (
                    <p className="mt-2 whitespace-pre-wrap text-sm text-secondary">{n.notes}</p>
                  )}
                  {n.items.length > 0 && (
                    <p className="mt-2 font-mono text-xs text-faint">
                      {n.items.map((i) => i.label).join(' · ')}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      <ScannerOverlay
        open={scanning != null}
        title={scanning === 'tray' ? 'Scan a tray' : 'Scan a block'}
        feedback={toast}
        onScan={handleScan}
        onClose={() => {
          setScanning(null)
          setToast(null)
        }}
      />
    </div>
  )
}
