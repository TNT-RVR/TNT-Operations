/**
 * The second step at sign-in, shown ONLY to someone who chose to enrol.
 *
 * It sits alongside SetPassword and PendingApproval as a gate in the session
 * provider rather than inside LoginScreen, because by this point a session
 * already exists — the password was accepted — and LoginScreen has unmounted.
 * The session is real but at `aal1`, which the database's own policies treat as
 * unproven, so the app must not render behind it.
 */
import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '@/data/supabaseClient'
import { BeeMark } from '@/components/BeeMark'
import { submitCode, verifiedFactors } from './mfa'

export function MfaChallenge({ onVerified, onSignOut }: { onVerified: () => void; onSignOut: () => void }) {
  const [code, setCode] = useState('')
  const [factorId, setFactorId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!supabase) return
    void verifiedFactors(supabase).then((f) => setFactorId(f[0]?.id ?? null))
  }, [])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!supabase || !factorId) return
    setBusy(true)
    setError(null)
    try {
      await submitCode(supabase, factorId, code)
      onVerified()
    } catch (err) {
      // Almost always a stale code: the six digits roll every 30 seconds and a
      // phone clock that drifts is the other common cause. Say both, because
      // "invalid" on its own invites the user to retype the same dead code.
      setError(err instanceof Error ? err.message : 'That code was not accepted.')
      setCode('')
    }
    setBusy(false)
  }

  return (
    <div className="grid min-h-full place-items-center bg-base p-4">
      <div className="card w-full max-w-sm">
        <div className="mb-5 flex items-center gap-3">
          <span className="shrink-0" style={{ color: 'var(--logo-ink)' }}>
            <BeeMark size={40} />
          </span>
          <div>
            <div className="font-display font-bold tracking-tight text-primary">Two-factor</div>
            <div className="text-xs text-muted">Enter the code from your authenticator app</div>
          </div>
        </div>

        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <label className="label" htmlFor="mfa-code">
              Six-digit code
            </label>
            <input
              id="mfa-code"
              // one-time-code lets a phone offer the code from the keyboard,
              // and numeric mode gives a digit pad rather than a full keyboard.
              autoComplete="one-time-code"
              inputMode="numeric"
              pattern="[0-9 ]*"
              maxLength={7}
              autoFocus
              required
              className="input text-center text-lg tracking-[0.4em] tabular-nums"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </div>

          {error && (
            <p
              className="rounded-lg px-3 py-2 text-sm"
              style={{ background: 'var(--danger-bg)', border: '1px solid var(--danger-bd)', color: 'var(--danger-fg)' }}
              role="alert"
            >
              {error}
            </p>
          )}

          <button type="submit" className="btn-primary w-full" disabled={busy || !factorId || code.length < 6}>
            {busy ? 'Checking…' : 'Verify'}
          </button>
        </form>

        {/*
          A way out that is not "clear your cookies". Someone who has lost their
          phone is otherwise stuck on this screen with a valid session and no
          way to reach anything, including the sign-out button in the app.
        */}
        <button
          type="button"
          className="mt-4 w-full text-center text-xs text-muted hover:text-secondary hover:underline"
          onClick={onSignOut}
        >
          Sign out and use a different account
        </button>
        <p className="mt-3 text-xs text-muted">
          Lost your authenticator? An administrator can remove two-factor from your account.
        </p>
      </div>
    </div>
  )
}
