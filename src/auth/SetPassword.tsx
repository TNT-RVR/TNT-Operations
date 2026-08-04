import { useState, type FormEvent } from 'react'
import { supabase } from '@/data/supabaseClient'
import { BeeMark } from '@/components/BeeMark'
import { clearAuthType } from './authLink'

/**
 * Choose-a-password gate, shown when someone arrives from an invite or a
 * password-reset email. Those links sign the person in but leave the account
 * WITHOUT a usable password — so without this screen they could use the app
 * once and never sign back in.
 *
 * The password is set with `updateUser` on their own session; nobody else ever
 * sees or handles it.
 */
export function SetPassword({ invited, onDone }: { invited: boolean; onDone: () => void }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const tooShort = password.length > 0 && password.length < 8
  const mismatch = confirm.length > 0 && password !== confirm
  const canSubmit = password.length >= 8 && password === confirm && !busy

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!supabase || !canSubmit) return
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) {
      setError(error.message)
      return
    }
    clearAuthType()
    onDone()
  }

  return (
    <div className="grid min-h-full place-items-center bg-base p-4">
      <div className="card w-full max-w-sm">
        <div className="mb-5 flex items-center gap-3">
          <span className="shrink-0" style={{ color: 'var(--logo-ink)' }}>
            <BeeMark size={40} />
          </span>
          <div>
            <div className="font-display font-bold tracking-tight text-primary">
              {invited ? 'Welcome to TNT' : 'Set a new password'}
            </div>
            <div className="text-xs text-muted">
              {invited ? 'Choose a password to finish setting up your account' : 'Choose a new password to continue'}
            </div>
          </div>
        </div>

        <form onSubmit={onSubmit} className="space-y-3">
          <label className="block">
            <span className="label">New password</span>
            <input
              className="input"
              type="password"
              required
              autoFocus
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
            />
          </label>
          <label className="block">
            <span className="label">Confirm password</span>
            <input
              className="input"
              type="password"
              required
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </label>

          {(tooShort || mismatch || error) && (
            <p
              className="rounded-md px-3 py-2 text-sm"
              style={{ background: 'var(--danger-bg)', border: '1px solid var(--danger-bd)', color: 'var(--danger-fg)' }}
            >
              {error ?? (tooShort ? 'Use at least 8 characters.' : "Those passwords don't match.")}
            </p>
          )}

          <button className="btn-primary w-full" type="submit" disabled={!canSubmit}>
            {busy ? 'Saving…' : 'Set password and continue'}
          </button>
        </form>
      </div>
    </div>
  )
}
