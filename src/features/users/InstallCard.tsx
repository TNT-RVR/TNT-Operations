/**
 * "Put this on my phone" — one button where a person will look for it.
 *
 * Installing a PWA is a menu item buried in a different place in every browser,
 * and people who are not looking for it will not find it. On Chrome we can hold
 * the browser's own install prompt and replay it from a tap, which is a genuine
 * one-tap install. On iOS there is no such API and never has been, so the same
 * button turns into the three taps to make, written out — which is still far
 * better than "find Share, scroll down".
 *
 * The listener is registered at module load, not when this card mounts:
 * `beforeinstallprompt` fires seconds after the app starts, long before anyone
 * opens Settings, and an event nobody was listening for is gone.
 */
import { useEffect, useState } from 'react'
import { Check, Download, Share } from 'lucide-react'
import { Badge, Button } from '@/components/ui'
import { installAdvice } from '@/domain/installState'

/** The held prompt, plus the standard event shape the DOM types lack. */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferred: InstallPromptEvent | null = null
let installed = false
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((f) => f())

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    // Keep it: without preventDefault the browser shows its own banner once and
    // then will not give us the prompt again.
    e.preventDefault()
    deferred = e as InstallPromptEvent
    notify()
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    installed = true
    notify()
  })
}

function useInstallPrompt() {
  const [, bump] = useState(0)
  useEffect(() => {
    const f = () => bump((n) => n + 1)
    listeners.add(f)
    return () => {
      listeners.delete(f)
    }
  }, [])
  return {
    canPrompt: deferred !== null,
    justInstalled: installed,
    prompt: async () => {
      if (!deferred) return 'unavailable' as const
      await deferred.prompt()
      const { outcome } = await deferred.userChoice
      // A prompt is single-use; Chrome fires beforeinstallprompt again if the
      // person declines and the page reloads.
      deferred = null
      notify()
      return outcome
    },
  }
}

export function InstallCard() {
  const { canPrompt, justInstalled, prompt } = useInstallPrompt()
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  const standalone =
    typeof window !== 'undefined' &&
    (window.matchMedia('(display-mode: standalone)').matches ||
      // iOS marks an installed app this way rather than by display-mode.
      (navigator as Navigator & { standalone?: boolean }).standalone === true)

  const advice = installAdvice({
    ua: typeof navigator === 'undefined' ? '' : navigator.userAgent,
    standalone: standalone || justInstalled,
    canPrompt,
  })

  const install = async () => {
    setBusy(true)
    const outcome = await prompt()
    setBusy(false)
    setNote(
      outcome === 'accepted'
        ? 'Installing — look for the TNT icon with your other apps.'
        : outcome === 'dismissed'
          ? 'No problem. The button stays here if you change your mind.'
          : 'Your browser did not offer the install this time.',
    )
  }

  return (
    <section className="card">
      <div className="mb-1 flex items-center gap-2">
        <Download size={16} className="text-muted" />
        <h2 className="font-bold text-primary">Put TNT on your phone</h2>
        {advice.state === 'installed' && <Badge tone="green">installed</Badge>}
      </div>

      {advice.state === 'installed' ? (
        <p className="text-sm text-muted">
          <Check size={14} className="mr-1 inline" />
          You are using the installed app. It opens without the browser bar and keeps working in the field when
          there is no signal.
        </p>
      ) : (
        <>
          <p className="mb-3 text-sm text-muted">
            Adds a TNT icon to your home screen. It opens full screen, and the map keeps working where there is no
            signal.
          </p>

          {advice.state === 'prompt' ? (
            <Button onClick={() => void install()} disabled={busy}>
              <Download size={16} /> {busy ? 'Installing…' : 'Install the app'}
            </Button>
          ) : (
            <div className="rounded-sm border border-subtle bg-inset p-3">
              <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-primary">
                <Share size={14} /> {advice.title}
              </p>
              <ol className="ml-4 list-decimal space-y-1 text-sm text-secondary">
                {advice.steps.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
            </div>
          )}

          {note && <p className="mt-2 text-xs text-secondary">{note}</p>}
        </>
      )}
    </section>
  )
}
