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
  multiline,
  minRows = 3,
}: {
  value: string
  onSave: (next: string) => void
  disabled?: boolean
  placeholder?: string
  inputMode?: 'numeric' | 'decimal' | 'text'
  className?: string
  /** Render a box that shows the whole text and grows as it is written. */
  multiline?: boolean
  /** How tall it starts, in lines. */
  minRows?: number
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

  /**
   * Grow the box to fit what is in it.
   *
   * A note worth writing is usually three lines about which gate to use, and
   * reading it through a one-line window means scrolling a sentence sideways.
   * It stops growing at 60vh and scrolls after that, so a long note cannot
   * push the buttons off the bottom of a phone.
   */
  const fit = (el: HTMLTextAreaElement | null) => {
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }

  if (multiline) {
    return (
      <textarea
        ref={fit}
        value={text}
        disabled={disabled}
        placeholder={placeholder}
        rows={minRows}
        className={`input w-full resize-y ${className ?? ''}`}
        style={{ maxHeight: '60vh' }}
        onChange={(e) => {
          dirtyRef.current = true
          setText(e.target.value)
          fit(e.currentTarget)
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          // Enter makes a new line here; it is a note, not a field. Escape
          // still throws the edit away, and blur still saves it.
          if (e.key === 'Escape') {
            dirtyRef.current = false
            setText(value)
          }
        }}
      />
    )
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
