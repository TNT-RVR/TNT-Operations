import { useState, type FormEvent } from 'react'
import { supabase } from '@/data/supabaseClient'

/**
 * Sign-in / sign-up gate for `supabase` mode.
 *
 * New people can create an account here; they land in a "pending" state with no
 * access until an admin approves them in the Users screen (see PendingApproval).
 * On success the session provider takes over — this screen just triggers the auth
 * call and surfaces errors / the confirm-your-email notice.
 */
export function LoginScreen() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [name, setName] = useState('')
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

    if (mode === 'signup') {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { name: name.trim() } },
      })
      if (error) setError(error.message)
      else if (!data.session) {
        // Email confirmation is on — no session yet.
        setNotice('Account created. Check your email to confirm, then sign in.')
        setMode('signin')
      }
      // If a session came back, the provider re-renders into the pending screen.
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) setError(error.message)
    }
    setBusy(false)
  }

  const isSignup = mode === 'signup'

  return (
    <div className="grid min-h-full place-items-center bg-slate-50 p-4">
      <div className="card w-full max-w-sm">
        <div className="mb-5 flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand text-white">🐝</span>
          <div>
            <div className="font-bold tracking-tight text-ink">TNT Operations</div>
            <div className="text-xs text-slate-500">{isSignup ? 'Create your account' : 'Sign in to continue'}</div>
          </div>
        </div>

        <form onSubmit={onSubmit} className="space-y-3">
          {isSignup && (
            <div>
              <label className="label" htmlFor="signup-name">
                Name
              </label>
              <input
                id="signup-name"
                type="text"
                autoComplete="name"
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
          )}

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
              autoComplete={isSignup ? 'new-password' : 'current-password'}
              required
              minLength={6}
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
          {notice && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</p>}

          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy ? 'Working…' : isSignup ? 'Create account' : 'Sign in'}
          </button>
        </form>

        <button
          className="mt-4 w-full text-center text-sm text-brand hover:underline"
          onClick={() => {
            setMode(isSignup ? 'signin' : 'signup')
            setError(null)
            setNotice(null)
          }}
        >
          {isSignup ? 'Have an account? Sign in' : 'Need access? Create an account'}
        </button>

        {isSignup && (
          <p className="mt-3 text-xs text-slate-500">
            New accounts start with no access until an administrator approves you.
          </p>
        )}
      </div>
    </div>
  )
}
