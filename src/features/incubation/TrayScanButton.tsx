import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, X } from 'lucide-react'
import { parseScan } from './trayLookup'

/**
 * Scan ONE tray label and hand back the number.
 *
 * Distinct from the Scan screen's continuous mode: there you point at tray
 * after tray and each one saves itself, whereas here you're filling a single
 * field, so the camera closes as soon as it reads something.
 */
export function TrayScanButton({
  onScan,
  disabled,
  label = 'Scan',
}: {
  onScan: (trayNumber: string) => void
  disabled?: boolean
  label?: string
}) {
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scannerRef = useRef<any>(null)
  // A unique container id, so two scanners can never fight over one element.
  const readerId = useRef(`tray-scan-${Math.random().toString(36).slice(2, 9)}`).current

  const stop = useCallback(async () => {
    const inst = scannerRef.current
    scannerRef.current = null
    setScanning(false)
    if (inst) {
      try {
        await inst.stop()
      } catch {
        /* already stopped */
      }
    }
  }, [])

  useEffect(() => () => void stop(), [stop])

  async function start() {
    setError(null)
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError('Camera needs a secure (https) connection — type the number instead.')
      return
    }
    setScanning(true)
    try {
      const { Html5Qrcode } = await import('html5-qrcode')
      const inst = new Html5Qrcode(readerId)
      scannerRef.current = inst
      await inst.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: 220 },
        (text: string) => {
          const found = parseScan(text)
          if (!found) return
          void stop()
          try {
            navigator.vibrate?.(40)
          } catch {
            /* best-effort */
          }
          onScan(found)
        },
        () => {
          /* per-frame decode misses are normal */
        },
      )
    } catch (e) {
      setScanning(false)
      scannerRef.current = null
      setError(e instanceof Error ? e.message : 'Could not start the camera.')
    }
  }

  return (
    <div>
      {!scanning ? (
        <button className="btn-ghost" onClick={start} disabled={disabled}>
          <Camera size={16} className="mr-1 inline" />
          {label}
        </button>
      ) : (
        <button className="btn-ghost" onClick={() => void stop()}>
          <X size={16} className="mr-1 inline" />
          Cancel
        </button>
      )}
      {/* html5-qrcode injects the video here; must stay mounted while scanning */}
      <div id={readerId} className={scanning ? 'mt-2 overflow-hidden rounded-sm' : 'hidden'} />
      {error && <p className="mt-1 text-xs text-secondary">{error}</p>}
    </div>
  )
}
