import { useState, type FormEvent } from 'react'
import { supabase } from '@/data/supabaseClient'

/**
 * Sign-in gate for `supabase` mode. Accounts are created by an admin (invite /
 * Supabase dashboard) — this screen only signs existing users in; there is no
 * self-serve sign-up (see docs/darren-onboarding.md).
 *
 * On success, `SupabaseSessionProvider`'s auth listener re-renders into the app,
 * so this component just needs to trigger the sign-in and surface errors.
 */
export function LoginScreen() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!supabase) return
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError(error.message)
    setBusy(false)
  }

  return (
    <div className="grid min-h-full place-items-center bg-slate-50 p-4">
      <div className="card w-full max-w-sm">
        <div className="mb-5 flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand text-white">🐝</span>
          <div>
            <div className="font-bold tracking-tight text-ink">TNT Operations</div>
            <div className="text-xs text-slate-500">Sign in to continue</div>
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
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
              {error}
            </p>
          )}

          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="mt-4 text-xs text-slate-500">
          Accounts are created by an admin. Contact your administrator if you need access.
        </p>
      </div>
    </div>
  )
}
