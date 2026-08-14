import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Check, AlertTriangle, Info, Flashlight, FlashlightOff, Keyboard } from 'lucide-react'

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

/**
 * A one-line description of where this is running.
 *
 * Camera failures are nearly always environmental — the wrong protocol, a
 * home-screen app with its own permission store, an in-app browser — and none
 * of that is visible from a screenshot of "it didn't work".
 */
function diagnostics(): string {
  const standalone =
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as { standalone?: boolean }).standalone === true
  return `[${location.protocol}${standalone ? ' home-screen app' : ' browser'}]`
}
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
  /** Hand-typed entry, for a damaged label or a camera that won't start. */
  const [manualOpen, setManualOpen] = useState(false)
  const [manualCode, setManualCode] = useState('')
  const manualRef = useRef<HTMLInputElement>(null)

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

      /**
       * Ask for the camera FIRST, before loading the scanner library.
       *
       * iOS wants the permission request close to the tap that caused it, and
       * `await import('html5-qrcode')` is a network round trip in between. On
       * an iPad running the home-screen app that gap is enough for the request
       * to be refused without a prompt ever appearing — the camera simply
       * never starts, which is exactly what it looks like from the outside.
       *
       * The stream is stopped immediately; this is about the permission, not
       * the picture. It also gives a REAL DOMException name to report, where
       * the library's own errors are strings that have to be pattern-matched.
       */
      try {
        const probe = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        })
        probe.getTracks().forEach((t) => t.stop())
      } catch (e) {
        if (cancelled) return
        const name = e instanceof DOMException ? e.name : ''
        console.error('[scanner] camera permission probe failed:', name, e)
        setError(
          name === 'NotAllowedError'
            ? 'Camera access is blocked for this app. On an iPad: Settings → Apps → Safari → Camera → Allow, then reopen. Or type the number.'
            : name === 'NotFoundError'
              ? 'No camera was found on this device. Type the number instead.'
              : name === 'NotReadableError'
                ? 'The camera is already in use by another app. Close it and try again.'
                : `Could not open the camera (${name || 'unknown'}). ${diagnostics()} Type the number instead.`,
        )
        return
      }

      try {
        const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode')
        if (cancelled) return

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

        // A FRESH instance per attempt. html5-qrcode marks its state machine
        // "under transition" when start() begins and never unwinds that on
        // failure, so a second start() on the same object always throws
        // "already under transition" — the retry can't work, whatever the
        // original fault was. Reusing the instance is what kept the camera shut.
        const newInstance = () =>
          new Html5Qrcode(readerId, {
            // Use the browser's NATIVE barcode detector where it exists (Chrome
            // on Android). Same engine as the phone's own camera app, and far
            // faster than decoding frames in JavaScript. The library checks
            // support itself and falls back to ZXing.
            useBarCodeDetectorIfSupported: true,
            experimentalFeatures: { useBarCodeDetectorIfSupported: true },
            // Only QR — not a dozen barcode formats per frame.
            formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
            verbose: false,
          })

        /**
         * Ladder from best picture to most compatible. Every rung is a real
         * device difference, so we descend rather than give up:
         *   1. high resolution + continuous autofocus, for small labels
         *   2. bare facingMode, which nearly every phone honours
         *   3. an explicit back-camera deviceId, for phones where facingMode
         *      resolves to nothing
         */
        const buildAttempts = async (): Promise<Array<{ name: string; constraints: MediaTrackConstraints }>> => {
          const list: Array<{ name: string; constraints: MediaTrackConstraints }> = [
            {
              name: 'high-res + autofocus',
              constraints: {
                facingMode: 'environment',
                width: { ideal: 1920 },
                height: { ideal: 1080 },
                // `advanced` is best-effort: a device that can't do continuous
                // focus ignores it instead of refusing the whole request.
                advanced: [{ focusMode: 'continuous' }],
              } as unknown as MediaTrackConstraints,
            },
            { name: 'plain environment', constraints: { facingMode: 'environment' } },
          ]
          try {
            const cams = await Html5Qrcode.getCameras()
            const back = cams.find((c) => /back|rear|environment/i.test(c.label)) ?? cams[cams.length - 1]
            if (back?.id) {
              list.push({ name: `deviceId ${back.label || back.id}`, constraints: { deviceId: { exact: back.id } } })
            }
          } catch (e) {
            // Enumerating needs its own permission grant on some browsers;
            // losing this rung is survivable.
            console.warn('[scanner] could not enumerate cameras:', e)
          }
          return list
        }

        let started: InstanceType<typeof Html5Qrcode> | null = null
        let lastErr: unknown = null
        for (const attempt of await buildAttempts()) {
          if (cancelled) return
          const inst = newInstance()
          try {
            await inst.start(attempt.constraints, scanConfig, onDecode, onFrameMiss)
            started = inst
            console.info(`[scanner] camera started via: ${attempt.name}`)
            break
          } catch (err) {
            lastErr = err
            console.warn(`[scanner] attempt "${attempt.name}" failed:`, err)
            // Release anything this attempt half-opened before the next rung.
            try {
              await inst.stop()
            } catch {
              /* never started; nothing to stop */
            }
          }
        }

        if (cancelled) {
          if (started) void started.stop().catch(() => {})
          return
        }
        // Every rung failed — report the last real error rather than a shrug.
        if (!started) throw lastErr ?? new Error('No camera could be started.')
        scannerRef.current = started

        // Shop lighting is a common reason a label won't read, so offer the
        // torch when the camera has one.
        try {
          const caps = started.getRunningTrackCapabilities() as MediaTrackCapabilities & { torch?: boolean }
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

  useEffect(() => {
    if (manualOpen) manualRef.current?.focus()
  }, [manualOpen])

  // A fresh scanning session starts closed, not holding the last typed code.
  useEffect(() => {
    if (!open) {
      setManualOpen(false)
      setManualCode('')
    }
  }, [open])

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

      {/* Type a code by hand.
          Several error messages tell people to "type the number instead", and
          until now there was nowhere to do it. A label gets torn, muddied or
          sun-bleached, or the camera simply won't start — the work shouldn't
          stop for that. Goes through the SAME handler as a decode, so it gets
          the same checks and the same feedback. */}
      <div className="bg-surface px-4 py-3">
        {manualOpen ? (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              const code = manualCode.trim()
              if (!code) return
              onScanRef.current(code)
              setManualCode('')
            }}
            className="flex gap-2"
          >
            <input
              ref={manualRef}
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
              placeholder="Type the code on the label…"
              className="input flex-1"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
            />
            <button type="submit" className="btn-primary" disabled={!manualCode.trim()}>
              Enter
            </button>
            <button type="button" className="btn-ghost" onClick={() => setManualOpen(false)}>
              Cancel
            </button>
          </form>
        ) : (
          <button className="btn-ghost w-full" onClick={() => setManualOpen(true)}>
            <Keyboard size={16} className="mr-1 inline" />
            Type a code instead
          </button>
        )}
      </div>

      {footer && <div className="bg-surface px-4 py-3">{footer}</div>}
    </div>,
    document.body,
  )
}
