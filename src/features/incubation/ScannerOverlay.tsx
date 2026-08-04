import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Check, AlertTriangle, Info, Flashlight, FlashlightOff } from 'lucide-react'

/** Result of handling a scan, shown over the camera and then faded out. */
export interface ScanFeedback {
  kind: 'ok' | 'warn' | 'error'
  /** Big line — usually the tray number. */
  title: string
  /** Small line — what happened to it. */
  detail?: string
  /** Bump this for every scan so repeats of the same label still flash. */
  seq: number
}

/** How long each kind of toast stays up. Failures linger; successes get out of the way. */
const TOAST_MS: Record<ScanFeedback['kind'], number> = { ok: 1400, warn: 2200, error: 3500 }
/** Nothing decoded for this long → say so, rather than leaving a dead camera. */
const IDLE_HINT_MS = 8000

/**
 * Full-screen camera for scanning tray labels.
 *
 * Full screen because this is used at arm's length over a stack of trays — a
 * thumbnail preview makes it guesswork to tell what the camera is actually
 * pointed at.
 */
export function ScannerOverlay({
  open,
  title,
  feedback,
  footer,
  onScan,
  onClose,
}: {
  open: boolean
  title: string
  /** Set by the parent after it handles a scan; rendered as a toast. */
  feedback?: ScanFeedback | null
  /** Controls kept on the camera (e.g. which sample is being filled). */
  footer?: React.ReactNode
  onScan: (text: string) => void
  onClose: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [idle, setIdle] = useState(false)
  const [toast, setToast] = useState<ScanFeedback | null>(null)
  const [torchOn, setTorchOn] = useState(false)
  const [hasTorch, setHasTorch] = useState(false)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scannerRef = useRef<any>(null)
  const lastDecodeRef = useRef<number>(Date.now())
  const readerId = useRef(`scanner-${Math.random().toString(36).slice(2, 9)}`).current
  // Held in a ref so restarting the camera never depends on the handler identity.
  const onScanRef = useRef(onScan)
  onScanRef.current = onScan

  const stop = useCallback(async () => {
    const inst = scannerRef.current
    scannerRef.current = null
    if (inst) {
      try {
        await inst.stop()
      } catch {
        /* already stopped */
      }
    }
  }, [])

  // Start/stop with `open`, and always stop on unmount so the camera light
  // never stays on after the screen is gone.
  useEffect(() => {
    if (!open) {
      void stop()
      return
    }
    let cancelled = false
    setError(null)
    setIdle(false)
    setTorchOn(false)
    setHasTorch(false)
    lastDecodeRef.current = Date.now()
    ;(async () => {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setError('The camera needs a secure (https) connection. Type the number instead.')
        return
      }
      try {
        const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode')
        if (cancelled) return
        const inst = new Html5Qrcode(readerId, {
          // Use the browser's NATIVE barcode detector where it exists (Chrome on
          // Android). It's the same engine the phone's own camera app uses, and
          // it's far faster than decoding frames in JavaScript.
          useBarCodeDetectorIfSupported: true,
          experimentalFeatures: { useBarCodeDetectorIfSupported: true },
          // Only QR — not trying a dozen barcode formats per frame.
          formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
          verbose: false,
        })
        scannerRef.current = inst

        const scanConfig = {
          fps: 20,
          // No qrbox on purpose: it restricts decoding to a small centre
          // square, so a label anywhere else in view is ignored. Native
          // scanners read the whole frame, which is why they feel instant.
          disableFlip: true,
        }
        const onDecode = (text: string) => {
          lastDecodeRef.current = Date.now()
          setIdle(false)
          onScanRef.current(text)
        }
        const onFrameMiss = () => {
          /* per-frame misses are normal; the idle timer covers a real stall */
        }

        // Preferred stream: enough resolution for a small label, and autofocus.
        // `advanced` entries are BEST-EFFORT — a device that can't do continuous
        // focus ignores them. Asking for focusMode at the top level makes it a
        // REQUIRED constraint, and phones without it throw OverconstrainedError,
        // which is what stopped the camera opening at all.
        const preferred = {
          facingMode: 'environment',
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          advanced: [{ focusMode: 'continuous' }],
        } as unknown as MediaTrackConstraints

        try {
          await inst.start(preferred, scanConfig, onDecode, onFrameMiss)
        } catch (preferredErr) {
          if (cancelled) return
          // Never let a preference cost us the camera: fall back to the plainest
          // request that any device can satisfy.
          console.warn('[scanner] preferred constraints refused, retrying plain:', preferredErr)
          // A failed start can leave the instance mid-transition, and starting
          // again in that state throws. Settle it first; it may already be
          // stopped, which is fine.
          try {
            await inst.stop()
          } catch {
            /* already stopped */
          }
          if (cancelled) return
          await inst.start({ facingMode: 'environment' }, scanConfig, onDecode, onFrameMiss)
        }
        // Shop lighting is a common reason a label won't read, so offer the
        // torch when the camera has one.
        try {
          const caps = inst.getRunningTrackCapabilities() as MediaTrackCapabilities & { torch?: boolean }
          setHasTorch(!!caps?.torch)
        } catch {
          setHasTorch(false)
        }
      } catch (e) {
        if (cancelled) return
        // Log the real error: the generic message below hid an
        // OverconstrainedError once already, which cost a round of guessing.
        console.error('[scanner] camera failed to start:', e)
        const msg = e instanceof Error ? e.message : String(e)
        setError(
          /permission|denied|notallowed/i.test(msg)
            ? 'Camera permission was refused. Allow it in your browser settings, or type the number.'
            : /notfound|no camera|devicenotfound/i.test(msg)
              ? 'No camera was found on this device. Type the number instead.'
              : /notreadable|in use|trackstart/i.test(msg)
                ? 'The camera is already in use by another app. Close it and try again.'
                : `Could not start the camera. Type the number instead. (${msg})`,
        )
      }
    })()
    return () => {
      cancelled = true
      void stop()
    }
  }, [open, readerId, stop])

  // Flash the parent's result, then clear it.
  useEffect(() => {
    if (!feedback) return
    setToast(feedback)
    const t = setTimeout(() => setToast(null), TOAST_MS[feedback.kind])
    return () => clearTimeout(t)
  }, [feedback])

  // "Nothing is being read" — distinct from a code that read but didn't match.
  useEffect(() => {
    if (!open || error) return
    const t = setInterval(() => {
      setIdle(Date.now() - lastDecodeRef.current > IDLE_HINT_MS)
    }, 1000)
    return () => clearInterval(t)
  }, [open, error])

  // Escape closes, matching every other full-screen thing.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const toastTone: Record<ScanFeedback['kind'], string> = {
    ok: 'var(--green-500)',
    warn: 'var(--amber-500)',
    error: 'var(--red-500)',
  }
  const ToastIcon = toast?.kind === 'ok' ? Check : toast?.kind === 'warn' ? Info : AlertTriangle

  // Rendered into <body>: a full-screen overlay must not inherit layout from
  // wherever it happens to be mounted. (Inside a `space-y-*` parent it picked up
  // a 16px top margin, which offsets even a fixed element.)
  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <span className="font-display font-bold text-white">{title}</span>
        <div className="flex items-center gap-2">
          {hasTorch && (
            <button
              onClick={async () => {
                const next = !torchOn
                try {
                  await scannerRef.current?.applyVideoConstraints({
                    advanced: [{ torch: next }],
                  } as unknown as MediaTrackConstraints)
                  setTorchOn(next)
                } catch {
                  /* some devices refuse mid-stream; leave the toggle as it was */
                }
              }}
              className="rounded-sm p-2 text-white"
              style={{ background: torchOn ? 'var(--brand)' : 'rgba(255,255,255,0.14)' }}
              aria-label={torchOn ? 'Turn the light off' : 'Turn the light on'}
              aria-pressed={torchOn}
            >
              {torchOn ? <Flashlight size={22} /> : <FlashlightOff size={22} />}
            </button>
          )}
          <button
            onClick={onClose}
            className="rounded-sm p-2 text-white"
            style={{ background: 'rgba(255,255,255,0.14)' }}
            aria-label="Close scanner"
          >
            <X size={22} />
          </button>
        </div>
      </div>

      {/* Camera fills the space between header and footer. */}
      <div className="relative min-h-0 flex-1">
        <div
          id={readerId}
          className="h-full w-full [&_video]:h-full [&_video]:w-full [&_video]:object-cover"
        />

        {/* Aiming guide only — the whole frame is scanned, not just this box. */}
        {!error && !toast && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <div
              className="h-56 w-56 rounded-lg"
              style={{ boxShadow: '0 0 0 2px rgba(255,255,255,0.55), 0 0 0 9999px rgba(0,0,0,0.25)' }}
            />
          </div>
        )}

        {error && (
          <div className="absolute inset-0 grid place-items-center p-6 text-center">
            <div>
              <AlertTriangle size={32} className="mx-auto mb-2 text-white" />
              <p className="text-sm text-white">{error}</p>
            </div>
          </div>
        )}

        {/* Idle hint — the camera is live but nothing is decoding. */}
        {!error && idle && !toast && (
          <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center px-4">
            <div
              className="rounded-sm px-3 py-2 text-center text-sm text-white"
              style={{ background: 'rgba(0,0,0,0.65)' }}
            >
              No code detected — hold the label steady, 10–20 cm away, and keep it well lit.
            </div>
          </div>
        )}

        {/* Result of the last scan, big enough to read at arm's length. */}
        {toast && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center p-6">
            <div
              className="flex items-center gap-3 rounded-lg px-5 py-4 shadow-lg"
              style={{ background: toastTone[toast.kind], color: 'var(--ink-950)' }}
              role="status"
              aria-live="polite"
            >
              <ToastIcon size={28} />
              <div className="min-w-0">
                <div className="font-mono text-xl font-bold leading-tight">{toast.title}</div>
                {toast.detail && <div className="text-sm leading-tight">{toast.detail}</div>}
              </div>
            </div>
          </div>
        )}
      </div>

      {footer && <div className="bg-surface px-4 py-3">{footer}</div>}
    </div>,
    document.body,
  )
}
