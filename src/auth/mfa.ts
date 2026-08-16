/**
 * Two-factor authentication (TOTP), per user and OPTIONAL.
 *
 * ── The rule ─────────────────────────────────────────────────────────────────
 *
 * Anyone may turn it on for themselves; nobody is forced. There is no policy
 * that demands it and no admin switch that imposes it — a crew tablet shared by
 * four people at 5 a.m. in a field is not a place to require an authenticator
 * app, and locking one out mid-season would be worse than the risk it removes.
 *
 * ── How "optional" is actually enforced ──────────────────────────────────────
 *
 * Supabase models this as an assurance level. A password alone is `aal1`. A
 * verified TOTP factor raises what the account REQUIRES to `aal2` — so
 * `nextLevel` is only ever `aal2` for someone who chose to enrol. Everyone else
 * signs in exactly as before, with no code and no prompt.
 *
 * That is why the gate below compares the two levels rather than reading a
 * setting of our own: enrolment IS the setting, and it cannot drift out of step
 * with what the auth server will actually demand.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export interface MfaState {
  /** A verified factor exists, so this account signs in with a code. */
  enrolled: boolean
  /** Signed in, enrolled, but the code has not been given yet this session. */
  challengeRequired: boolean
}

export const MFA_OFF: MfaState = { enrolled: false, challengeRequired: false }

/**
 * Read where this session stands.
 *
 * `currentLevel` is what the session has proved; `nextLevel` is what the
 * account can reach. They differ in exactly one interesting case — enrolled,
 * but only a password shown so far — and that is the case that must be gated.
 *
 * Errors resolve to MFA_OFF rather than throwing. This runs on the sign-in
 * path, and a transient failure here must not lock out a user who does not use
 * MFA at all. Someone who DOES is still protected: the auth server refuses
 * aal1 sessions on its own, so a failure here cannot grant access, only fail to
 * prompt.
 */
export async function readMfaState(sb: SupabaseClient): Promise<MfaState> {
  try {
    const { data, error } = await sb.auth.mfa.getAuthenticatorAssuranceLevel()
    if (error || !data) return MFA_OFF
    return {
      enrolled: data.nextLevel === 'aal2',
      challengeRequired: data.nextLevel === 'aal2' && data.currentLevel !== data.nextLevel,
    }
  } catch {
    return MFA_OFF
  }
}

/**
 * Begin enrolment: returns the QR code and the typed secret.
 *
 * Abandoned attempts are cleared first. Starting enrolment and never finishing
 * it — closing the dialog, losing the phone, changing your mind — leaves an
 * unverified factor behind, and Supabase rejects a second enrolment while one
 * with the same name exists. Without this sweep, one abandoned attempt makes
 * the button permanently broken for that user, with an error naming a factor
 * they never knowingly created.
 */
export async function beginEnrol(sb: SupabaseClient, friendlyName: string) {
  const { data: existing } = await sb.auth.mfa.listFactors()
  for (const f of existing?.all ?? []) {
    if (f.status === 'unverified') await sb.auth.mfa.unenroll({ factorId: f.id })
  }

  const { data, error } = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName })
  if (error || !data) throw new Error(error?.message ?? 'Could not start setup.')
  return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret }
}

/** Finish enrolment, or prove a code at sign-in. Both are challenge + verify. */
export async function submitCode(sb: SupabaseClient, factorId: string, code: string) {
  const { error } = await sb.auth.mfa.challengeAndVerify({ factorId, code: code.replace(/\s+/g, '') })
  if (error) throw new Error(error.message)
}

/**
 * The verified factors on this account, for listing and for the sign-in prompt.
 *
 * Resolves to empty rather than rejecting when there is no session to ask
 * about. This is called from a render effect, where an unhandled rejection
 * would surface as a crash rather than as the empty state it actually means.
 */
export async function verifiedFactors(sb: SupabaseClient) {
  try {
    const { data } = await sb.auth.mfa.listFactors()
    return (data?.all ?? []).filter((f) => f.status === 'verified')
  } catch {
    return []
  }
}
