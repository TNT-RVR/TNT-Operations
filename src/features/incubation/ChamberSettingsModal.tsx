/**
 * Edit a chamber, reissue its key, or remove it.
 *
 * All three existed on the seam and in the function before this screen did —
 * `rekeyHypoxiaChamber` and `saveHypoxiaChamber` were implemented in both
 * providers and called by nothing, and the setup guide told people to press an
 * "Issue new key" button that had never been built. A capability with no way to
 * reach it is not a capability, and it is worse than a missing one: the docs
 * promise it, so nobody goes looking for the gap until they need it urgently.
 *
 * ── The three are deliberately not equal ─────────────────────────────────────
 *
 * Editing is ordinary and saves on its own. Rekeying and deleting both take the
 * chamber away from you — a rekey silences it until the board is reflashed, and
 * a delete takes its whole history with it — so they sit below a divider, are
 * admin-only, and state their consequence before asking.
 */
import { useState } from 'react'
import { useData } from '@/data/context'
import { useSession } from '@/auth/session'
import { Badge, Button, Input, Modal, Switch } from '@/components/ui'
import { KeyRound, TriangleAlert, Trash2 } from 'lucide-react'
import type { HypoxiaChamber } from '@/data/types'
import { DeviceKeyReveal } from './DeviceKeyReveal'

export function ChamberSettingsModal({
  chamber,
  onClose,
}: {
  chamber: HypoxiaChamber
  onClose: () => void
}) {
  const { saveHypoxiaChamber, rekeyHypoxiaChamber, deleteHypoxiaChamber } = useData()
  const s = useSession()

  const [name, setName] = useState(chamber.name)
  const [location, setLocation] = useState(chamber.location)
  const [pod, setPod] = useState(String(chamber.pod))
  const [notes, setNotes] = useState(chamber.notes)
  const [active, setActive] = useState(chamber.active)

  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  const [issued, setIssued] = useState<string | null>(null)
  const [confirmingRekey, setConfirmingRekey] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState('')
  const [deleting, setDeleting] = useState(false)

  const canEdit = s.can('incubation', 'edit')
  // Mirrors the function's own rule. The function is the gate; this only
  // decides whether to draw a control that would be refused.
  const canManage = s.user.role === 'admin' || s.user.role === 'developer'

  const dirty =
    name !== chamber.name ||
    location !== chamber.location ||
    pod !== String(chamber.pod) ||
    notes !== chamber.notes ||
    active !== chamber.active

  async function save() {
    setBusy('save')
    setError('')
    const r = await saveHypoxiaChamber(chamber.id, {
      name: name.trim(),
      location: location.trim(),
      pod: Number(pod) || 1,
      notes,
      active,
    })
    setBusy('')
    if (!r.ok) return setError(r.error ?? 'Could not save')
    setSaved(true)
  }

  async function rekey() {
    setBusy('rekey')
    setError('')
    const r = await rekeyHypoxiaChamber(chamber.id)
    setBusy('')
    setConfirmingRekey(false)
    if (!r.ok || !r.deviceKey) return setError(r.error ?? 'Could not issue a new key')
    setIssued(r.deviceKey)
  }

  async function remove() {
    setBusy('delete')
    setError('')
    const r = await deleteHypoxiaChamber(chamber.id, confirmDelete.trim())
    setBusy('')
    if (!r.ok) return setError(r.error ?? 'Could not delete')
    onClose()
  }

  // ── After a rekey: the one and only sight of the new key ──
  if (issued) {
    return (
      <Modal title={`New key for ${chamber.name}`} onClose={onClose}>
        <div className="space-y-4">
          <div className="rounded border border-danger/40 bg-[color:var(--danger-bg)] p-3 text-xs text-secondary">
            <p className="mb-1 flex items-center gap-2 font-semibold text-danger">
              <TriangleAlert size={14} /> This chamber is now silent
            </p>
            <p>
              The old key stopped working the moment this was issued, so the board cannot report until it is
              reflashed with the key below. That is the point of a rekey — but it means the chamber is
              unmonitored until you do it.
            </p>
          </div>
          <DeviceKeyReveal chamberName={chamber.name} deviceKey={issued} />
          <div className="border-t border-subtle pt-3">
            <Button onClick={onClose}>Done — I have copied it</Button>
          </div>
        </div>
      </Modal>
    )
  }

  return (
    <Modal title={`${chamber.name} — settings`} onClose={onClose}>
      <div className="space-y-5">
        {error && (
          <p className="rounded border border-danger/40 bg-[color:var(--danger-bg)] p-3 text-xs text-danger">
            {error}
          </p>
        )}

        {/* ── Details ── */}
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="label">Chamber name</span>
              <Input value={name} onChange={(e) => setName(e.target.value)} disabled={!canEdit} />
            </label>
            <label className="block">
              <span className="label">Where it is</span>
              <Input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Shed 2"
                disabled={!canEdit}
              />
            </label>
            <label className="block">
              <span className="label">Pod number</span>
              <Input
                value={pod}
                inputMode="numeric"
                onChange={(e) => setPod(e.target.value)}
                disabled={!canEdit}
              />
              <span className="mt-1 block text-xs text-faint">
                What the Nano calls itself in its telemetry. Only used to match a stray line back to a chamber.
              </span>
            </label>
            <label className="block">
              <span className="label">Notes</span>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!canEdit} />
            </label>
          </div>

          <div className="rounded border border-default p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm text-primary">In service</p>
                <p className="mt-1 text-xs text-secondary">
                  Turned off, the chamber keeps every reading it has but stops being watched — it will not
                  raise a silence alert. That is what to use for a box deliberately shut down, rather than
                  deleting it.
                </p>
              </div>
              {canEdit ? (
                <Switch checked={active} onChange={setActive} label="In service" />
              ) : (
                <Badge tone={active ? 'green' : 'neutral'}>{active ? 'In service' : 'Out of service'}</Badge>
              )}
            </div>
          </div>

          {canEdit && (
            <div className="flex items-center gap-3">
              <Button onClick={save} disabled={!dirty || busy === 'save'}>
                {busy === 'save' ? 'Saving…' : 'Save changes'}
              </Button>
              {saved && !dirty && <span className="text-xs text-secondary">Saved.</span>}
            </div>
          )}
        </div>

        {/* ── Key ── */}
        {canManage && (
          <div className="space-y-2 border-t border-subtle pt-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-primary">
              <KeyRound size={15} /> Device key
            </p>
            <p className="text-xs text-secondary">
              {chamber.hasKey
                ? `A key ending ${chamber.keyHint} is in use. The key itself is not stored — only its hash — so it cannot be shown again.`
                : 'No key has been issued yet, so this chamber cannot report. Issue one and flash the board.'}
            </p>

            {confirmingRekey ? (
              <div className="rounded border border-warn/40 bg-warn/10 p-3">
                <p className="mb-2 text-xs text-secondary">
                  Issuing a new key stops the old one immediately. The chamber goes silent until its board is
                  reflashed — do this if the key may have leaked, or if you no longer have it.
                </p>
                <div className="flex items-center gap-3">
                  <Button variant="danger" onClick={rekey} disabled={busy === 'rekey'}>
                    {busy === 'rekey' ? 'Issuing…' : 'Issue new key'}
                  </Button>
                  <button className="text-xs text-muted underline" onClick={() => setConfirmingRekey(false)}>
                    cancel
                  </button>
                </div>
              </div>
            ) : (
              <Button variant="ghost" onClick={() => setConfirmingRekey(true)}>
                {chamber.hasKey ? 'Issue new key' : 'Issue key'}
              </Button>
            )}
          </div>
        )}

        {/* ── Delete ── */}
        {canManage && (
          <div className="space-y-2 border-t border-subtle pt-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-danger">
              <Trash2 size={15} /> Delete this chamber
            </p>
            <p className="text-xs text-secondary">
              Removes the chamber and <strong>every reading and command it ever recorded</strong>. There is no
              undo. If the box is simply out of service, turn off <em>In service</em> above instead — that
              keeps the history.
            </p>
            <label className="block">
              <span className="label">Type “{chamber.name}” to confirm</span>
              <Input
                value={confirmDelete}
                onChange={(e) => setConfirmDelete(e.target.value)}
                placeholder={chamber.name}
              />
            </label>
            <div className="flex items-center gap-3">
              <Button
                variant="danger"
                onClick={() => setDeleting(true)}
                disabled={confirmDelete.trim() !== chamber.name || busy === 'delete'}
              >
                Delete chamber
              </Button>
              {deleting && (
                <>
                  <span className="text-xs text-danger">Certain?</span>
                  <Button variant="danger" onClick={remove} disabled={busy === 'delete'}>
                    {busy === 'delete' ? 'Deleting…' : 'Yes, delete'}
                  </Button>
                  <button className="text-xs text-muted underline" onClick={() => setDeleting(false)}>
                    cancel
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
