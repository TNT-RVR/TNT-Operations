/**
 * Add a chamber, and show its device key once.
 *
 * The key is what lets a box post readings and collect purge, valve and
 * blast-door commands. Only its SHA-256 is stored, so this dialog is the only
 * time it can ever be seen — the database cannot reveal it, and neither can a
 * backup or a leaked query.
 *
 * That is deliberate, and it is the fix for how this arrived: the student's
 * firmware carried its ThingsBoard token as a string literal, so anyone who
 * read the source could command the chamber. A credential that can be re-read
 * is one that eventually is, by the wrong person. Losing this one costs a rekey
 * and a reflash, which is the right price.
 */
import { useState } from 'react'
import { useData } from '@/data/context'
import { Button, Input, Modal } from '@/components/ui'
import { DeviceKeyReveal } from './DeviceKeyReveal'

export function LinkChamberModal({ onClose }: { onClose: () => void }) {
  const { createHypoxiaChamber } = useData()
  const [name, setName] = useState('')
  const [location, setLocation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [issued, setIssued] = useState<string | null>(null)

  async function create() {
    setBusy(true)
    setError('')
    const r = await createHypoxiaChamber({ name: name.trim(), location: location.trim() })
    setBusy(false)
    if (!r.ok || !r.deviceKey) return setError(r.error ?? 'Could not create the chamber')
    setIssued(r.deviceKey)
  }

  // ── After creation: the one and only sight of the key ──
  if (issued) {
    return (
      <Modal title="Chamber added — copy its key now" onClose={onClose}>
        <div className="space-y-4">
          <DeviceKeyReveal chamberName={name} deviceKey={issued} />
          <div className="border-t border-subtle pt-3">
            <Button onClick={onClose}>Done — I have copied it</Button>
          </div>
        </div>
      </Modal>
    )
  }

  return (
    <Modal title="Add a chamber" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-secondary">
          Creates the chamber and issues the key its controller uses to report in. You will see the key once,
          on the next screen.
        </p>

        {error && (
          <p className="rounded border border-danger/40 bg-[color:var(--danger-bg)] p-3 text-xs text-danger">
            {error}
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="label">Chamber name</span>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Stack A · Pod 1"
              autoFocus
            />
          </label>
          <label className="block">
            <span className="label">Where it is</span>
            <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Shed 2" />
          </label>
        </div>

        <div className="flex items-center gap-3 border-t border-subtle pt-3">
          <Button onClick={create} disabled={!name.trim() || busy}>
            {busy ? 'Creating…' : 'Add chamber'}
          </Button>
          <button className="text-xs text-muted underline" onClick={onClose}>
            cancel
          </button>
        </div>
      </div>
    </Modal>
  )
}
