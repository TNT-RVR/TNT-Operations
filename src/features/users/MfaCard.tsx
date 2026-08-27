/**
 * Turn two-factor on or off, for yourself.
 *
 * Optional by design — see `auth/mfa.ts`. Nothing here can enable it for anyone
 * else, and there is no admin control that imposes it: enrolling requires
 * scanning a code with a phone you are holding, which is not something another
 * person can do on your behalf.
 */
import { useCallback, useEffect, useState } from 'react'
import { Check, Shield, ShieldCheck } from 'lucide-react'
import { supabase } from '@/data/supabaseClient'
import { Button, Input } from '@/components/ui'
import { beginEnrol, submitCode, verifiedFactors } from '@/auth/mfa'

type Factor = { id: string; friendly_name?: string; created_at?: string }

export function MfaCard() {
  const [factors, setFactors] = useState<Factor[] | null>(null)
  const [setup, setSetup] = useState<{ factorId: string; qrCode: string; secret: string } | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')

  const refresh = useCallback(async () => {
    if (!supabase) return
    setFactors(await verifiedFactors(supabase))
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const on = (factors?.length ?? 0) > 0

  async function start() {
    if (!supabase) return
    setBusy(true)
    setError('')
    setMsg('')
    try {
      setSetup(await beginEnrol(supabase, `TNT Operations · ${new Date().getFullYear()}`))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start setup.')
    }
    setBusy(false)
  }

  async function confirm() {
    if (!supabase || !setup) return
    setBusy(true)
    setError('')
    try {
      await submitCode(supabase, setup.factorId, code)
      setSetup(null)
      setCode('')
      setMsg('Two-factor is on. You will be asked for a code next time you sign in.')
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That code was not accepted.')
      setCode('')
    }
    setBusy(false)
  }

  async function cancel() {
    // Roll back the half-finished factor rather than leaving it unverified —
    // beginEnrol sweeps these, but cleaning up now keeps the account tidy for
    // anyone reading it in the Supabase dashboard.
    if (supabase && setup) await supabase.auth.mfa.unenroll({ factorId: setup.factorId }).catch(() => {})
    setSetup(null)
    setCode('')
    setError('')
  }

  async function turnOff(factorId: string) {
    if (!supabase) return
    setBusy(true)
    setError('')
    const { error: e } = await supabase.auth.mfa.unenroll({ factorId })
    if (e) setError(e.message)
    else setMsg('Two-factor is off.')
    await refresh()
    setBusy(false)
  }

  return (
    <div className="card space-y-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-muted">
        {on ? <ShieldCheck size={15} className="text-brand" /> : <Shield size={15} />}
        Two-factor authentication
      </h3>

      {!setup && (
        <div className="flex items-start justify-between gap-3">
          <p className="text-xs text-muted">
            {on
              ? 'On. Signing in asks for a six-digit code from your authenticator app.'
              : 'Optional. Adds a six-digit code from an authenticator app when you sign in.'}
          </p>
          {factors !== null &&
            (on ? (
              <Button variant="ghost" onClick={() => turnOff(factors[0].id)} disabled={busy}>
                Turn off
              </Button>
            ) : (
              <Button onClick={start} disabled={busy}>
                {busy ? 'Starting…' : 'Turn on'}
              </Button>
            ))}
        </div>
      )}

      {setup && (
        <div className="space-y-3">
          <p className="text-xs text-muted">
            Scan this with Google Authenticator, 1Password, Authy, or any TOTP app, then enter the code it shows.
          </p>
          {/* Supabase returns the QR as an inline SVG data URI — no library,
              and nothing fetched from another host. */}
          <img
            src={setup.qrCode}
            alt="Two-factor setup QR code"
            className="h-44 w-44 rounded-lg bg-primary p-2"
            width={176}
            height={176}
          />
          <details className="text-xs text-muted">
            <summary className="cursor-pointer hover:text-secondary">Can&rsquo;t scan it?</summary>
            <p className="mt-1">
              Enter this key by hand: <code className="break-all tabular-nums text-secondary">{setup.secret}</code>
            </p>
          </details>

          <label className="block">
            <span className="label">Code from the app</span>
            <Input
              autoComplete="one-time-code"
              inputMode="numeric"
              maxLength={7}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456"
            />
          </label>

          <div className="flex gap-2">
            <Button onClick={confirm} disabled={busy || code.length < 6}>
              <Check size={16} /> {busy ? 'Checking…' : 'Confirm'}
            </Button>
            <Button variant="ghost" onClick={cancel} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {error && <p className="text-xs text-danger">{error}</p>}
      {msg && !error && <p className="text-xs text-ok">{msg}</p>}
    </div>
  )
}
