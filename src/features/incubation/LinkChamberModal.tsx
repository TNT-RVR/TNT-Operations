/**
 * Link a ThingsBoard device to a new chamber.
 *
 * The alternative was a text box for the device id. A ThingsBoard id is a bare
 * UUID, and the failure from getting one wrong is silent and bad: the app reads
 * another chamber's telemetry and sends purge, valve and blast-door commands to
 * the wrong sealed box. Choosing from a list of real device names removes the
 * chance of that rather than warning about it.
 *
 * Devices already linked are shown, greyed, with the chamber using them — so
 * "why isn't mine in the list" has an answer on screen instead of being a
 * puzzle.
 */
import { useEffect, useState } from 'react'
import { useData } from '@/data/context'
import { Button, Input, Modal } from '@/components/ui'
import { RefreshCw } from 'lucide-react'
import type { HypoxiaDevice } from '@/data/types'

export function LinkChamberModal({ onClose }: { onClose: () => void }) {
  const { listHypoxiaDevices, linkHypoxiaDevice } = useData()
  const [devices, setDevices] = useState<HypoxiaDevice[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [picked, setPicked] = useState<HypoxiaDevice | null>(null)
  const [name, setName] = useState('')
  const [location, setLocation] = useState('')
  const [busy, setBusy] = useState(false)

  async function refresh() {
    setLoading(true)
    setError('')
    const r = await listHypoxiaDevices()
    setLoading(false)
    if (r.error) return setError(r.error)
    setDevices(r.devices ?? [])
  }

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function link() {
    if (!picked) return
    setBusy(true)
    setError('')
    const r = await linkHypoxiaDevice({ deviceId: picked.id, name: name.trim(), location: location.trim() })
    setBusy(false)
    if (!r.ok) return setError(r.error ?? 'Could not link')
    onClose()
  }

  return (
    <Modal title="Add a chamber" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-secondary">
          Pick the ThingsBoard device this chamber runs on. The app reads its telemetry and sends its commands
          there, so it has to be the right one.
        </p>

        {error && (
          <p className="rounded border border-danger/40 bg-[color:var(--danger-bg)] p-3 text-xs text-danger">
            {error}
          </p>
        )}

        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={refresh} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> {loading ? 'Looking…' : 'Refresh'}
          </Button>
          {!loading && !error && (
            <span className="text-xs text-muted">
              {devices.length} device{devices.length === 1 ? '' : 's'} found
            </span>
          )}
        </div>

        {!loading && !error && devices.length === 0 && (
          <p className="text-sm text-muted">
            No devices on this ThingsBoard account. Check the chambers are provisioned and that the account can
            see them.
          </p>
        )}

        {devices.length > 0 && (
          <div className="max-h-64 space-y-1 overflow-y-auto">
            {devices.map((d) => {
              const taken = Boolean(d.linkedTo)
              const active = picked?.id === d.id
              return (
                <button
                  key={d.id}
                  disabled={taken}
                  onClick={() => {
                    setPicked(d)
                    // A sensible default the person can overwrite — most device
                    // names are already what the crew calls the chamber.
                    if (!name.trim()) setName(d.label || d.name)
                  }}
                  className={`block w-full rounded-lg border p-3 text-left transition disabled:opacity-50 ${
                    active ? 'border-brand bg-brand-light' : 'border-subtle hover:bg-[color:var(--hover-wash)]'
                  }`}
                >
                  <div className="font-medium text-primary">{d.label || d.name}</div>
                  <div className="text-xs text-muted">
                    {d.type || 'device'}
                    {taken && ` · already linked to ${d.linkedTo}`}
                  </div>
                </button>
              )
            })}
          </div>
        )}

        {picked && (
          <div className="grid gap-3 border-t border-subtle pt-3 sm:grid-cols-2">
            <label className="block">
              <span className="label">Chamber name</span>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Stack A · Pod 1" />
            </label>
            <label className="block">
              <span className="label">Where it is</span>
              <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Shed 2" />
            </label>
          </div>
        )}

        <div className="flex items-center gap-3 border-t border-subtle pt-3">
          <Button onClick={link} disabled={!picked || !name.trim() || busy}>
            {busy ? 'Linking…' : 'Add chamber'}
          </Button>
          <button className="text-xs text-muted underline" onClick={onClose}>
            cancel
          </button>
        </div>
      </div>
    </Modal>
  )
}
