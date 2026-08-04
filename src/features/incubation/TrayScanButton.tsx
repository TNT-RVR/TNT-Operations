import { useRef, useState } from 'react'
import { Camera } from 'lucide-react'
import { parseScan } from './trayLookup'
import { ScannerOverlay, type ScanFeedback } from './ScannerOverlay'

/**
 * Scan ONE tray label and hand back the number.
 *
 * Distinct from the Scan screen's continuous mode: there you point at tray
 * after tray and each one saves itself, whereas here you're filling a single
 * field, so the camera closes as soon as something is accepted.
 *
 * `resolve` lets the caller reject a scan — a lookup can say "no tray on
 * record" and keep the camera open rather than closing on a dead end.
 */
export function TrayScanButton({
  onScan,
  resolve,
  disabled,
  label = 'Scan',
  title = 'Scan a tray',
}: {
  onScan: (trayNumber: string) => void
  /** Return ok:false to reject the scan and show a message over the camera. */
  resolve?: (trayNumber: string) => { ok: boolean; title: string; detail?: string }
  disabled?: boolean
  label?: string
  title?: string
}) {
  const [open, setOpen] = useState(false)
  const [feedback, setFeedback] = useState<ScanFeedback | null>(null)
  const seqRef = useRef(0)
  const lastRef = useRef<{ label: string; at: number }>({ label: '', at: 0 })

  function handle(text: string) {
    const found = parseScan(text)
    if (!found) return
    // Ignore the same code re-decoding while it sits in frame.
    const now = Date.now()
    if (found === lastRef.current.label && now - lastRef.current.at < 2000) return
    lastRef.current = { label: found, at: now }

    const r = resolve ? resolve(found) : { ok: true, title: found }
    setFeedback({ kind: r.ok ? 'ok' : 'error', title: r.title, detail: r.detail, seq: ++seqRef.current })
    try {
      navigator.vibrate?.(r.ok ? 40 : [30, 60, 30])
    } catch {
      /* best-effort */
    }
    if (!r.ok) return // keep scanning — a bad read shouldn't end the session
    onScan(found)
    // Let the confirmation land before the camera disappears.
    setTimeout(() => setOpen(false), 550)
  }

  return (
    <>
      <button className="btn-ghost" onClick={() => setOpen(true)} disabled={disabled}>
        <Camera size={16} className="mr-1 inline" />
        {label}
      </button>
      <ScannerOverlay
        open={open}
        title={title}
        feedback={feedback}
        onScan={handle}
        onClose={() => setOpen(false)}
      />
    </>
  )
}
