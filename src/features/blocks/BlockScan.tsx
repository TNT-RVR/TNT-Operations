import { useEffect, useMemo, useRef, useState } from 'react'
import { Camera, MapPin, Scale, Check } from 'lucide-react'
import { PageHeader, Select, Input, Button, Badge } from '@/components/ui'
import { useData } from '@/data/context'
import { ScannerOverlay, type ScanFeedback } from '@/features/incubation/ScannerOverlay'
import { parseScan } from '@/features/incubation/trayLookup'
import { findBlock, blockStage, kgToLbsWeight } from '@/domain/blocks'
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
  const { fields, blocks, blockPlacements, loadBlocks, placeBlock, weighBlock } = useData()
  const [mode, setMode] = useState<Mode>('place')
  const [fieldId, setFieldId] = useState<string>('')
  const [open, setOpen] = useState(false)
  const [feedback, setFeedback] = useState<ScanFeedback | null>(null)
  const [log, setLog] = useState<Array<{ label: string; text: string; ok: boolean; at: number }>>([])

  // Weigh modes: the block that was scanned and is waiting for a number.
  const [pending, setPending] = useState<{ label: string } | null>(null)
  const [weight, setWeight] = useState('')
  const [unit, setUnit] = useState<'lbs' | 'kg'>('lbs')
  const [saving, setSaving] = useState(false)
  const [weighError, setWeighError] = useState<string | null>(null)
  const weightRef = useRef<HTMLInputElement>(null)

  const seqRef = useRef(0)
  // Same code re-decoding while it sits in frame is not a second block.
  const lastRef = useRef<{ label: string; at: number }>({ label: '', at: 0 })

  useEffect(() => {
    void loadBlocks()
  }, [loadBlocks])

  // GPS only matters while placing, and only while the camera is up.
  const { fix, error: gpsError } = useGps(mode === 'place' && open)

  const season = new Date().getFullYear()
  const canPlace = mode !== 'place' || !!fieldId

  const note = (label: string, text: string, ok: boolean) =>
    setLog((prev) => [{ label, text, ok, at: Date.now() }, ...prev].slice(0, 30))

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
      return note(label, r.created ? `Placed (${where})` : `Moved (${where})`, true)
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

  async function saveWeight() {
    if (!pending) return
    const raw = Number(weight)
    if (!Number.isFinite(raw) || raw <= 0) return setWeighError('Enter a weight.')
    const lbs = unit === 'kg' ? (kgToLbsWeight(raw) ?? raw) : raw

    setSaving(true)
    const r = await weighBlock({ label: pending.label, stage: mode as 'retrieve' | 'strip', weightLbs: lbs, season })
    setSaving(false)
    if (!r.ok) return setWeighError(r.error ?? 'Could not save.')

    note(pending.label, `${raw.toFixed(2)} ${unit} recorded`, true)
    setPending(null)
    setWeight('')
    // Straight back to the camera — this is a repetitive station job.
    setOpen(true)
  }

  useEffect(() => {
    if (pending) weightRef.current?.focus()
  }, [pending])

  const fieldName = useMemo(() => fields.find((f) => f.id === fieldId)?.name ?? '', [fields, fieldId])

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
                onChange={(e) => setWeight(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void saveWeight()}
                className="flex-1 text-lg"
              />
              <Select value={unit} onChange={(e) => setUnit(e.target.value as 'lbs' | 'kg')} className="w-24">
                <option value="lbs">lbs</option>
                <option value="kg">kg</option>
              </Select>
            </div>
            {weighError && <p className="text-sm text-danger">{weighError}</p>}
            <div className="flex gap-2">
              <Button onClick={() => void saveWeight()} disabled={saving}>
                <Check size={16} className="mr-1 inline" />
                {saving ? 'Saving…' : 'Save & scan next'}
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
            <h3 className="mb-2 text-sm font-semibold text-muted">This session</h3>
            <ul className="space-y-1 text-sm">
              {log.map((e) => (
                <li key={e.at} className="flex justify-between gap-2">
                  <span className="font-medium">{e.label}</span>
                  <span className={e.ok ? 'text-muted' : 'text-danger'}>{e.text}</span>
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
