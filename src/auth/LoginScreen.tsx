import { useState, type FormEvent } from 'react'
import { supabase } from '@/data/supabaseClient'
import { BeeMark } from '@/components/BeeMark'

/**
 * Sign-in gate for `supabase` mode.
 *
 * ── Invitation only ──────────────────────────────────────────────────────────
 *
 * There is no "create an account" here any more. Access is granted by an
 * administrator sending an invite from Users & Settings, which carries the
 * person's role in the auth metadata — so an invited user arrives with real
 * permissions instead of landing in a pending queue nobody was told about.
 *
 * Removing the form is the smaller half of that. The enforcing half is
 * "Allow new users to sign up" being OFF in the Supabase dashboard: without it
 * anyone could still POST to /auth/v1/signup directly and create themselves an
 * account. A hidden button is not a permission.
 */
export function LoginScreen() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!supabase) return
    setBusy(true)
    setError(null)
    setNotice(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      // Supabase answers `invalid_credentials` for a wrong password, an unknown
      // address AND an unconfirmed one — the same message every time, so that
      // nobody can probe which accounts exist. Say what to do about it rather
      // than repeating a message that cannot distinguish the three.
      setError(
        /invalid.*credential/i.test(error.message)
          ? 'That email and password did not match. If you have never set a password, use "Forgot password" below.'
          : error.message,
      )
    }
    setBusy(false)
  }

  /**
   * Email a password-reset link. The link returns here with `type=recovery`,
   * which the app turns into the set-password screen (see authLink.ts).
   * Redirects to the site root because that's what Supabase's URL allow list
   * is configured for.
   */
  async function onForgotPassword() {
    if (!supabase) return
    if (!email.trim()) {
      setError('Enter your email address first, then click "Forgot password".')
      return
    }
    setBusy(true)
    setError(null)
    setNotice(null)
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: window.location.origin,
    })
    setBusy(false)
    if (error) setError(error.message)
    else setNotice(`If an account exists for ${email.trim()}, a reset link is on its way.`)
  }

  return (
    <div className="grid min-h-full place-items-center bg-base p-4">
      <div className="card w-full max-w-sm">
        <div className="mb-5 flex items-center gap-3">
          <span className="shrink-0" style={{ color: 'var(--logo-ink)' }}>
            <BeeMark size={40} />
          </span>
          <div>
            <div className="font-display font-bold tracking-tight text-primary">TNT Operations</div>
            <div className="text-xs text-muted">Sign in to continue</div>
          </div>
        </div>

        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <label className="label" htmlFor="login-email">
              Email
            </label>
            <input
              id="login-email"
              type="email"
              autoComplete="email"
              required
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div>
            <label className="label" htmlFor="login-password">
              Password
            </label>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              required
              minLength={6}
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
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
          {notice && (
            <p
              className="rounded-lg px-3 py-2 text-sm"
              style={{ background: 'var(--ok-bg)', border: '1px solid var(--ok-bd)', color: 'var(--ok-fg)' }}
            >
              {notice}
            </p>
          )}

          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy ? 'Working…' : 'Sign in'}
          </button>
        </form>

        <button
          type="button"
          className="mt-3 w-full text-center text-xs text-muted hover:text-secondary hover:underline"
          onClick={onForgotPassword}
          disabled={busy}
        >
          Forgot password?
        </button>

        {/* Says how to get in, so a new person is not left guessing at a form
            that no longer exists. */}
        <p className="mt-4 border-t border-subtle pt-3 text-xs text-muted">
          Access is by invitation. Ask an administrator to send you one from Users &amp; Settings.
        </p>
      </div>
    </div>
  )
}
