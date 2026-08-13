import { useEffect, useRef, useState } from 'react'
import { Input } from './ui'

/**
 * A text field that saves when you STOP typing, not on every keystroke.
 *
 * The bug this fixes: a field whose value comes back from an async save is
 * overwritten mid-sentence. Type "Total shelter placement", the save for "T"
 * resolves while you are on "o", React re-renders with the older value, and
 * the letters in between are gone — "Tstal selt pacmn". It reads like a broken
 * keyboard and it gets worse the slower the connection, which means it is
 * worst in the field.
 *
 * So the input owns its text while it is being edited and hands it over on
 * blur. It also flushes on unmount, because closing a dialog with the X is not
 * a reason to lose what was typed.
 */
export function SavedText({
  value,
  onSave,
  disabled,
  placeholder,
  inputMode,
  className,
}: {
  value: string
  onSave: (next: string) => void
  disabled?: boolean
  placeholder?: string
  inputMode?: 'numeric' | 'decimal' | 'text'
  className?: string
}) {
  const [text, setText] = useState(value)
  const dirtyRef = useRef(false)
  const textRef = useRef(value)
  textRef.current = text
  const onSaveRef = useRef(onSave)
  onSaveRef.current = onSave

  // Follow the stored value when it changes underneath — another device, or a
  // different record in the same dialog — but never while this field is being
  // edited, which is what caused the original bug.
  useEffect(() => {
    if (!dirtyRef.current) setText(value)
  }, [value])

  // Flush on unmount: closing the dialog must not discard the last sentence.
  useEffect(() => {
    return () => {
      if (dirtyRef.current) onSaveRef.current(textRef.current)
    }
  }, [])

  const commit = () => {
    if (!dirtyRef.current) return
    dirtyRef.current = false
    onSaveRef.current(textRef.current)
  }

  return (
    <Input
      value={text}
      disabled={disabled}
      placeholder={placeholder}
      inputMode={inputMode}
      className={className}
      onChange={(e) => {
        dirtyRef.current = true
        setText(e.target.value)
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') {
          dirtyRef.current = false
          setText(value)
        }
      }}
    />
  )
}
