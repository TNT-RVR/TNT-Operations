import { Clock, TriangleAlert } from 'lucide-react'

/**
 * Shown to a signed-in user who cannot use the app yet. Two different reasons
 * land here, and telling them apart matters:
 *
 * - `pending` role — an account exists and an admin has to grant access.
 *   Waiting is the right thing to do, and the original copy said so.
 * - NO profile row — the login works but `public.profiles` has no row for it,
 *   so the app cannot see the account at all. Waiting is then hopeless advice:
 *   they are invisible on the admin's Users screen, so nobody is coming to
 *   approve them. It happened for real (Aug 2026): someone accepted an invite,
 *   signed in, and sat on this screen while the admin re-sent invites that
 *   GoTrue refused because the login already existed. Say what is wrong and
 *   give the admin the words to search for.
 */
export function PendingApproval({
  name,
  email,
  noProfile = false,
  onSignOut,
}: {
  name: string
  email?: string
  noProfile?: boolean
  onSignOut: () => void | Promise<void>
}) {
  return (
    <div className="grid min-h-full place-items-center bg-base p-4">
      <div className="card w-full max-w-md text-center">
        {noProfile ? (
          <TriangleAlert className="mx-auto mb-3 text-warn" size={36} />
        ) : (
          <Clock className="mx-auto mb-3 text-brand" size={36} />
        )}
        <h1 className="text-lg font-bold text-primary">
          {noProfile ? 'Your account is not set up' : 'Waiting for approval'}
        </h1>
        {noProfile ? (
          <>
            <p className="mt-2 text-sm text-secondary">
              Your sign-in works{email ? ` (${email})` : ''}, but there is no TNT profile attached to it, so the
              app has nothing to let you into. This does not fix itself — an administrator has to restore it.
            </p>
            <p className="mt-3 text-xs text-muted">
              Send them this: <strong className="text-secondary">Users &amp; Settings → Users → “Logins with no
              profile”</strong>, then Restore.
            </p>
          </>
        ) : (
          <p className="mt-2 text-sm text-secondary">
            Thanks{name ? `, ${name}` : ''} — your account has been created. An administrator needs to grant you
            access before you can use TNT Operations. You'll be able to sign in normally once they do.
          </p>
        )}
        <button className="btn-ghost mt-5" onClick={() => onSignOut()}>
          Sign out
        </button>
      </div>
    </div>
  )
}
