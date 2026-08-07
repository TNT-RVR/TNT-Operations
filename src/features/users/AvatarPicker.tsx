/**
 * A profile photo you can click to change.
 *
 * Used for your own photo on the Account tab and, for an admin, on any row of
 * the user list. There is one component rather than two because the permission
 * question is settled elsewhere: `profiles self or admin update` (migration
 * 0001) already allows exactly self-or-admin, so the UI only has to decide
 * whether to show the control, not who it is safe for.
 */
import { useRef, useState } from 'react'
import { useSession } from '@/auth/session'
import type { User } from '@/auth/session'
import { Avatar, Button } from '@/components/ui'
import { Camera, Trash2 } from 'lucide-react'
import { type AvatarSize, checkAvatarDataUrl, checkAvatarFile } from '@/domain/avatar'
import { toSquareDataUrl } from '@/components/imageResize'

export function AvatarPicker({
  user,
  canEdit,
  size = 'md',
  showButtons = false,
}: {
  user: Pick<User, 'id' | 'name' | 'email' | 'avatar'>
  canEdit: boolean
  size?: AvatarSize
  /** Account tab wants explicit buttons; the roster wants a clickable circle. */
  showButtons?: boolean
}) {
  const s = useSession()
  const { updateUserAvatar } = s
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const isYou = user.id === s.user.id

  const pick = async (file: File | undefined) => {
    if (!file) return
    setError('')

    const bad = checkAvatarFile(file)
    if (bad) return setError(bad.message)

    setBusy(true)
    try {
      // Downscale BEFORE storing: phone photos are megabytes, and this column
      // is read on every task row.
      const dataUrl = await toSquareDataUrl(file)
      const tooBig = checkAvatarDataUrl(dataUrl)
      if (tooBig) {
        setError(tooBig.message)
        return
      }
      const r = await updateUserAvatar(user.id, dataUrl)
      if (!r.ok) setError(r.error ?? 'Could not save the photo')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that image')
    } finally {
      setBusy(false)
      // Clear the input so re-picking the SAME file fires change again.
      if (input.current) input.current.value = ''
    }
  }

  const hidden = (
    <input
      ref={input}
      type="file"
      accept="image/png,image/jpeg,image/webp,image/gif"
      className="hidden"
      onChange={(e) => void pick(e.target.files?.[0])}
    />
  )

  if (!canEdit) return <Avatar user={user} size={size} isYou={isYou} />

  if (!showButtons) {
    return (
      <>
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={busy}
          title={`Change ${isYou ? 'your' : `${user.name || 'their'}’s`} photo`}
          className="relative rounded-full outline-none ring-brand focus-visible:ring-2"
        >
          <Avatar user={user} size={size} isYou={isYou} className={busy ? 'opacity-50' : ''} />
        </button>
        {hidden}
      </>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <Avatar user={user} size="xl" isYou={isYou} className={busy ? 'opacity-50' : ''} />
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={() => input.current?.click()} disabled={busy}>
            <Camera size={15} /> {busy ? 'Working…' : user.avatar ? 'Replace photo' : 'Add photo'}
          </Button>
          {user.avatar && (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                const r = await updateUserAvatar(user.id, null)
                if (!r.ok) setError(r.error ?? 'Could not remove the photo')
                setBusy(false)
              }}
            >
              <Trash2 size={15} /> Remove
            </Button>
          )}
        </div>
      </div>
      <p className="text-xs text-faint">
        Cropped to a square and resized automatically, so a photo straight off a phone is fine. Without one you
        get your initials.
      </p>
      {error && <p className="text-xs text-danger">{error}</p>}
      {hidden}
    </div>
  )
}
