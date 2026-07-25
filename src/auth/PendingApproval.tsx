import { Clock } from 'lucide-react'

/**
 * Shown to a signed-in user whose role is still `pending` — they've created an
 * account but an admin hasn't granted access yet. They can see nothing else
 * (RLS also denies pending users any data), just this holding screen.
 */
export function PendingApproval({ name, onSignOut }: { name: string; onSignOut: () => void | Promise<void> }) {
  return (
    <div className="grid min-h-full place-items-center bg-base p-4">
      <div className="card w-full max-w-md text-center">
        <Clock className="mx-auto mb-3 text-brand" size={36} />
        <h1 className="text-lg font-bold text-primary">Waiting for approval</h1>
        <p className="mt-2 text-sm text-secondary">
          Thanks{name ? `, ${name}` : ''} — your account has been created. An administrator needs to grant you
          access before you can use TNT Operations. You'll be able to sign in normally once they do.
        </p>
        <button className="btn-ghost mt-5" onClick={() => onSignOut()}>
          Sign out
        </button>
      </div>
    </div>
  )
}
