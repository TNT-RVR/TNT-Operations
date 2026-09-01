/**
 * The one and only sight of a chamber's device key.
 *
 * Shown when a chamber is created and again when one is rekeyed. Both paths
 * share this because they are the same moment with the same consequence: only
 * the SHA-256 is stored, so once this closes the key is gone from everywhere
 * except the board it gets flashed onto.
 *
 * It says where the key goes, and specifically that it does NOT go in the
 * `.ino`. That instruction is here rather than only in the setup guide because
 * a real key was once pasted into the sketch and committed to a public repo —
 * the same failure as the ThingsBoard token the original firmware shipped with.
 * The place to say so is the screen handing the key over.
 */
import { useState } from 'react'
import { Button } from '@/components/ui'
import { Check, Copy, TriangleAlert } from 'lucide-react'

export function DeviceKeyReveal({ chamberName, deviceKey }: { chamberName: string; deviceKey: string }) {
  const [copied, setCopied] = useState(false)

  return (
    <div className="space-y-4">
      <div className="rounded border border-warn/40 bg-warn/10 p-3">
        <p className="mb-1 flex items-center gap-2 text-xs font-semibold text-warn">
          <TriangleAlert size={14} /> Shown once
        </p>
        <p className="text-xs text-secondary">
          Only a hash of this key is stored, so it cannot be shown again. If it is lost, issue a new one and
          reflash the board — that is cheaper than a key anyone can look up.
        </p>
      </div>

      <div>
        <span className="label">Device key for {chamberName}</span>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 break-all rounded border border-default bg-inset px-3 py-2 font-mono text-sm text-primary">
            {deviceKey}
          </code>
          <Button
            variant="ghost"
            onClick={() => {
              void navigator.clipboard?.writeText(deviceKey).then(
                () => setCopied(true),
                () => setCopied(false),
              )
            }}
          >
            {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
      </div>

      <div className="space-y-1 text-xs text-secondary">
        <p className="font-semibold text-primary">Put it in secrets.h, not the sketch</p>
        <p>
          In <code>firmware/hypoxia-esp32c3/</code>, copy <code>secrets.example.h</code> to{' '}
          <code>secrets.h</code> and set <code>DEVICE_KEY</code> to this value, then flash the board. The
          repo is public and <code>secrets.h</code> is gitignored — a key pasted into the{' '}
          <code>.ino</code> would be readable by anyone, permanently.
        </p>
        <p>It starts reporting on its next cycle, and the chamber shows live readings here.</p>
      </div>
    </div>
  )
}
