import { useEffect, useRef } from 'react'

/**
 * Lightweight contenteditable that emits HTML on change.
 *
 * The parent passes `value` (initial HTML); the field rehydrates only
 * when `value` changes externally (e.g. on load), so React state updates
 * never blow away the user's caret position.
 *
 * Formatting commands (bold/italic/underline/lists) are applied via the
 * shared `RichTextToolbar` — it walks the focused contenteditable and
 * calls document.execCommand. We keep execCommand because it's still
 * the only one-liner that works across every browser for this use case.
 */
export default function RichTextField({
  value,
  onChange,
  onBlur,
  placeholder,
  ariaLabel,
  className = '',
  multiline = true,
  style,
}) {
  const ref = useRef(null)

  // Sync the DOM only when the *external* value changes (e.g. block
  // hydrated from DB). Without this guard, every keystroke would
  // re-write innerHTML and reset the caret to the start.
  useEffect(() => {
    if (!ref.current) return
    if (ref.current.innerHTML !== (value || '')) {
      ref.current.innerHTML = value || ''
    }
  }, [value])

  const handleInput = () => {
    if (!ref.current) return
    onChange?.(ref.current.innerHTML)
  }

  const handleKeyDown = (e) => {
    if (!multiline && e.key === 'Enter') {
      e.preventDefault()
      ref.current?.blur()
    }
  }

  return (
    <div
      ref={ref}
      className={`rt-field ${className}`}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-label={ariaLabel}
      aria-multiline={multiline}
      data-placeholder={placeholder || ''}
      onInput={handleInput}
      onBlur={onBlur}
      onKeyDown={handleKeyDown}
      style={style}
    />
  )
}
