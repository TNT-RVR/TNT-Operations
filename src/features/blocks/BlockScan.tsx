import { useEffect, useMemo, useRef, useState } from 'react'
import { Camera, MapPin, Scale, Check, Undo2, X } from 'lucide-react'
import { PageHeader, Select, Input, Button, Badge } from '@/components/ui'
import { useData } from '@/data/context'
import { ScannerOverlay, type ScanFeedback } from '@/features/incubation/ScannerOverlay'
import { parseScan } from '@/features/incubation/trayLookup'
import { findBlock, blockStage, kgToLbsWeight, checkWeight } from '@/domain/blocks'
import { useGps } from './useGps'

type Mode = 'place' | 'retrieve' | 'strip'

const MODE_COPY: Record<Mode, { label: string; hint: string }> = {
  place: { label: 'Place', hint: 'Scan each block as it goes out. Location is captured automatically.' },
  retrieve: { label: 'Retrieve', hint: 'Scan a block, then weigh it full.' },
  strip: { label: 'Strip', hint: 'Scan a block, then weigh it empty. The difference is your bee return.' },
}

/**
 * The field workflow: place → retrieve → strip.
 *
 * Place scans CONTINUOUSLY — nothing to type, so the camera never closes and
 * blocks go out as fast as they can be carried. The two weigh modes have to
 * stop for a number, so they scan one block, take the weight, and reopen.
 */
export default function BlockScan() {
  const { fields, blocks, blockPlacements, loadBlocks, placeBlock, weighBlock, undoPlacement } = useData()
  const [mode, setMode] = useState<Mode>('place')
  const [fieldId, setFieldId] = useState<string>('')
  const [open, setOpen] = useState(false)
  const [feedback, setFeedback] = useState<ScanFeedback | null>(null)
  /**
   * What happened this session. Placement entries carry their placement id so
   * a mis-scan can be taken back on the spot — the moment someone notices is
   * while they are still standing there, not that evening in a spreadsheet.
   */
  const [log, setLog] = useState<
    Array<{ label: string; text: string; ok: boolean; at: number; placementId?: string; undone?: boolean }>
  >([])
  const [undoing, setUndoing] = useState<string | null>(null)
  const [undoError, setUndoError] = useState<string | null>(null)

  // Weigh modes: the block that was scanned and is waiting for a number.
  const [pending, setPending] = useState<{ label: string } | null>(null)
  const [weight, setWeight] = useState('')
  const [unit, setUnit] = useState<'lbs' | 'kg'>('lbs')
  const [saving, setSaving] = useState(false)
  const [weighError, setWeighError] = useState<string | null>(null)
  /** A suspicious weight, held back until it's confirmed. */
  const [weighWarn, setWeighWarn] = useState<string | null>(null)
  const weightRef = useRef<HTMLInputElement>(null)

  const seqRef = useRef(0)
  // Same code re-decoding while it sits in frame is not a second block.
  const lastRef = useRef<{ label: string; at: number }>({ label: '', at: 0 })

  // Scanning always works in the current season, so that is all it loads.
  useEffect(() => {
    void loadBlocks(new Date().getFullYear())
  }, [loadBlocks])

  // GPS only matters while placing, and only while the camera is up.
  const { fix, error: gpsError } = useGps(mode === 'place' && open)

  const season = new Date().getFullYear()
  const canPlace = mode !== 'place' || !!fieldId

  const note = (label: string, text: string, ok: boolean, placementId?: string) =>
    setLog((prev) => [{ label, text, ok, at: Date.now(), placementId }, ...prev].slice(0, 30))

  /** Take back a placement scan. */
  async function undo(entry: { label: string; placementId?: string; at: number }) {
    if (!entry.placementId) return
    setUndoing(entry.placementId)
    setUndoError(null)
    const r = await undoPlacement(entry.placementId)
    setUndoing(null)
    if (!r.ok) {
      setUndoError(`${entry.label}: ${r.error ?? 'Could not undo.'}`)
      return
    }
    setLog((prev) => prev.map((e) => (e.at === entry.at ? { ...e, undone: true, text: 'Undone' } : e)))
    flash('ok', entry.label, r.blockRemoved ? 'Scan undone' : 'Placement removed')
  }

  /** The most recent placement still standing — what "undo last" acts on. */
  const lastUndoable = log.find((e) => e.ok && e.placementId && !e.undone)

  const flash = (kind: ScanFeedback['kind'], title: string, detail?: string) => {
    setFeedback({ kind, title, detail, seq: ++seqRef.current })
    try {
      navigator.vibrate?.(kind === 'ok' ? 40 : [30, 60, 30])
    } catch {
      /* best-effort */
    }
  }

  async function handleScan(text: string) {
    const label = parseScan(text)
    if (!label) return
    const now = Date.now()
    if (label === lastRef.current.label && now - lastRef.current.at < 2000) return
    lastRef.current = { label, at: now }

    if (mode === 'place') {
      // Refuse rather than record a placement we can't attribute to a field.
      if (!fieldId) return flash('error', label, 'Pick a field first.')
      const r = await placeBlock({ label, fieldId, lat: fix?.lat ?? null, lng: fix?.lng ?? null, season })
      if (!r.ok) {
        flash('error', label, r.error ?? 'Could not save.')
        return note(label, r.error ?? 'Could not save.', false)
      }
      const where = fix ? `±${Math.round(fix.acc)} m` : 'no GPS fix'

      // Moving a block between fields is almost always the wrong field being
      // selected — easy to do when re-walking a season, and invisible until
      // the returns come out wrong. Warn rather than confirm.
      if (r.movedFromFieldId) {
        const from = fields.find((f) => f.id === r.movedFromFieldId)?.name ?? 'another field'
        flash('warn', label, `Moved from ${from} → ${fieldName}. Is the right field selected?`)
        return note(label, `MOVED from ${from}`, false)
      }

      flash('ok', label, r.created ? `Placed · ${where}` : `Location updated · ${where}`)
      return note(label, r.created ? `Placed (${where})` : `Moved (${where})`, true, r.placementId)
    }

    // Weigh modes: check the block makes sense BEFORE stopping to type a
    // number, so a bad scan costs a beep rather than a wasted weigh-in.
    const block = findBlock(blocks, label)
    if (!block) return flash('error', label, 'No block on record.')
    const placement = blockPlacements.find((p) => p.blockId === block.id && p.season === season)
    if (!placement) return flash('error', block.label, `Not placed in ${season}.`)
    const stage = blockStage(placement)
    if (mode === 'retrieve' && stage !== 'placed')
      return flash('warn', block.label, `Already ${stage}. Re-weighing will overwrite.`)
    if (mode === 'strip' && stage === 'placed')
      return flash('warn', block.label, 'Not retrieved yet — weigh it full first.')

    flash('ok', block.label, 'Now weigh it')
    setPending({ label: block.label })
    setWeight('')
    setWeighError(null)
    setOpen(false)
  }

  async function saveWeight(confirmed = false) {
    if (!pending) return
    const raw = Number(weight)
    const lbs = unit === 'kg' ? (kgToLbsWeight(raw) ?? raw) : raw

    // Sanity-check before writing. The mistake being guarded against is a
    // decimal point — a valid number in a valid field that quietly ruins the
    // return — so it's checked against what this season's other blocks weigh.
    const block = findBlock(blocks, pending.label)
    const placement = block
      ? (blockPlacements.find((p) => p.blockId === block.id && p.season === season) ?? null)
      : null
    const peers = blockPlacements
      .filter((p) => p.season === season)
      .map((p) => (mode === 'strip' ? p.strippedWeightLbs : p.grossWeightLbs))
      .filter((w): w is number => w != null)

    const check = checkWeight(lbs, mode as 'retrieve' | 'strip', placement, peers)
    if (check?.level === 'error') {
      setWeighWarn(null)
      return setWeighError(check.message)
    }
    if (check?.level === 'warn' && !confirmed) {
      // Stop once, show the number back, and make saving it deliberate.
      setWeighError(null)
      return setWeighWarn(check.message)
    }

    setSaving(true)
    const r = await weighBlock({ label: pending.label, stage: mode as 'retrieve' | 'strip', weightLbs: lbs, season })
    setSaving(false)
    if (!r.ok) return setWeighError(r.error ?? 'Could not save.')

    note(pending.label, `${raw.toFixed(2)} ${unit} recorded`, true)
    setPending(null)
    setWeight('')
    setWeighWarn(null)
    // Straight back to the camera — this is a repetitive station job.
    setOpen(true)
  }

  useEffect(() => {
    if (pending) weightRef.current?.focus()
  }, [pending])

  const fieldName = useMemo(() => fields.find((f) => f.id === fieldId)?.name ?? '', [fields, fieldId])

  /** What the block being stripped weighed full — shown so the pair can be eyeballed. */
  const pendingGross = useMemo(() => {
    if (!pending) return null
    const b = findBlock(blocks, pending.label)
    if (!b) return null
    return blockPlacements.find((p) => p.blockId === b.id && p.season === season)?.grossWeightLbs ?? null
  }, [pending, blocks, blockPlacements, season])

  return (
    <div>
      <PageHeader title="Block scanning" subtitle={MODE_COPY[mode].hint} />

      <div className="space-y-4 p-4 md:p-6">
        {/* Mode picker — the three scans, in the order they happen. */}
        <div className="flex gap-2">
          {(Object.keys(MODE_COPY) as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => {
                setMode(m)
                setPending(null)
              }}
              className={`flex-1 rounded-lg border px-3 py-2 text-sm font-semibold transition ${
                mode === m ? 'border-brand bg-brand/10 text-brand' : 'border-default text-muted hover:border-brand'
              }`}
            >
              {MODE_COPY[m].label}
            </button>
          ))}
        </div>

        {mode === 'place' && (
          <div className="card space-y-2">
            <label className="text-sm font-medium">Field these blocks are going into</label>
            <Select value={fieldId} onChange={(e) => setFieldId(e.target.value)}>
              <option value="">Select a field…</option>
              {fields.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </Select>
            {!fieldId && <p className="text-xs text-muted">Needed before scanning — it's how returns get attributed.</p>}
          </div>
        )}

        {/* Weigh entry. Replaces the camera while a number is expected. */}
        {pending ? (
          <div className="card space-y-3">
            <div className="flex items-center gap-2">
              <Scale size={18} className="text-brand" />
              <span className="font-bold">{pending.label}</span>
              <Badge tone={mode === 'retrieve' ? 'amber' : 'green'}>
                {mode === 'retrieve' ? 'Full weight' : 'Empty weight'}
              </Badge>
            </div>
            <div className="flex gap-2">
              <Input
                ref={weightRef}
                type="number"
                inputMode="decimal"
                step="0.01"
                placeholder="0.00"
                value={weight}
                onChange={(e) => {
                  setWeight(e.target.value)
                  // A new number deserves a fresh judgement.
                  setWeighWarn(null)
                  setWeighError(null)
                }}
                onKeyDown={(e) => e.key === 'Enter' && void saveWeight()}
                className="flex-1 text-lg"
              />
              <Select value={unit} onChange={(e) => setUnit(e.target.value as 'lbs' | 'kg')} className="w-24">
                <option value="lbs">lbs</option>
                <option value="kg">kg</option>
              </Select>
            </div>
            {weighError && <p className="text-sm text-danger">{weighError}</p>}
            {weighWarn && (
              <div className="rounded-sm border border-danger p-2">
                <p className="text-sm text-danger">{weighWarn}</p>
                <p className="mt-1 text-xs text-muted">
                  Correct it above, or save anyway if the block really is like that.
                </p>
              </div>
            )}
            {/* Previous weight, so a full/empty pair can be sanity-checked by eye. */}
            {mode === 'strip' && pendingGross != null && (
              <p className="text-xs text-muted">
                Weighed full at <span className="font-semibold text-primary">{pendingGross.toFixed(1)} lbs</span>
                {weight && Number(weight) > 0 && (
                  <>
                    {' '}
                    · return would be{' '}
                    <span className="font-semibold text-primary">
                      {(pendingGross - (unit === 'kg' ? (kgToLbsWeight(Number(weight)) ?? 0) : Number(weight))).toFixed(1)} lbs
                    </span>
                  </>
                )}
              </p>
            )}
            <div className="flex gap-2">
              <Button onClick={() => void saveWeight(!!weighWarn)} disabled={saving}>
                <Check size={16} className="mr-1 inline" />
                {saving ? 'Saving…' : weighWarn ? 'Save anyway' : 'Save & scan next'}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setPending(null)
                  setOpen(true)
                }}
              >
                Skip
              </Button>
            </div>
          </div>
        ) : (
          <Button onClick={() => setOpen(true)} disabled={!canPlace} className="w-full py-3 text-base">
            <Camera size={18} className="mr-2 inline" />
            {mode === 'place' ? 'Scan blocks into the field' : `Scan a block to weigh`}
          </Button>
        )}

        {/* What just happened — so a mis-scan is caught on the spot. */}
        {log.length > 0 && (
          <div className="card">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-muted">This session</h3>
              {/* One tap for the common case: the scan you just took was wrong
                  and you know it immediately. */}
              {lastUndoable && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!!undoing}
                  onClick={() => void undo(lastUndoable)}
                >
                  <Undo2 size={14} className="mr-1 inline" />
                  Undo {lastUndoable.label}
                </Button>
              )}
            </div>
            {undoError && <p className="mb-2 text-sm text-danger">{undoError}</p>}
            <ul className="space-y-1 text-sm">
              {log.map((e) => (
                <li key={e.at} className="flex items-center justify-between gap-2">
                  <span className={`font-medium ${e.undone ? 'text-faint line-through' : ''}`}>{e.label}</span>
                  <span className="flex items-center gap-2">
                    <span className={e.undone ? 'text-faint' : e.ok ? 'text-muted' : 'text-danger'}>
                      {e.text}
                    </span>
                    {e.placementId && !e.undone && (
                      <button
                        className="text-muted hover:text-danger disabled:opacity-40"
                        aria-label={`Undo ${e.label}`}
                        disabled={!!undoing}
                        onClick={() => void undo(e)}
                      >
                        <X size={14} />
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <ScannerOverlay
        open={open}
        title={mode === 'place' ? `Placing into ${fieldName}` : `${MODE_COPY[mode].label} — scan a block`}
        feedback={feedback}
        onScan={(t) => void handleScan(t)}
        onClose={() => setOpen(false)}
        footer={
          mode === 'place' ? (
            <div className="flex items-center gap-2 text-sm text-white/80">
              <MapPin size={14} />
              {fix ? (
                <span>
                  {fix.lat.toFixed(5)}, {fix.lng.toFixed(5)} · ±{Math.round(fix.acc)} m
                </span>
              ) : (
                <span>{gpsError ?? 'Getting a GPS fix…'}</span>
              )}
            </div>
          ) : null
        }
      />
    </div>
  )
}
