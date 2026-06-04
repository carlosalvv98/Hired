import { useEffect, useRef } from 'react'

/**
 * Plain-text inline field that grows with its contents.
 *
 * We use contenteditable instead of `<input>` because inputs don't size
 * to their content — they fall back to the `size` attribute or a
 * browser default of ~20 chars, which clips longer roles/titles ("Product
 * Management Specialist" becomes "Product Management Sr"). A
 * contenteditable span naturally takes the width its text needs.
 *
 * `contenteditable="plaintext-only"` strips formatting on paste and
 * disallows bold/italic etc. Supported in Chrome/Safari; Firefox falls
 * back to regular contenteditable, which is fine for our purposes.
 *
 * Enter blurs the field rather than inserting a newline, matching the
 * behavior users expect from an input.
 */
export default function InlineText({
  value,
  onChange,
  placeholder,
  ariaLabel,
  className = '',
  style,
}) {
  const ref = useRef(null)

  useEffect(() => {
    if (!ref.current) return
    if (ref.current.textContent !== (value || '')) {
      ref.current.textContent = value || ''
    }
  }, [value])

  const handleInput = () => {
    if (!ref.current) return
    onChange?.(ref.current.textContent)
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      ref.current?.blur()
    }
  }

  const handlePaste = (e) => {
    // Belt-and-suspenders: even in browsers that ignore plaintext-only,
    // strip formatting on paste.
    e.preventDefault()
    const text = (e.clipboardData || window.clipboardData)?.getData('text/plain') || ''
    document.execCommand('insertText', false, text)
  }

  return (
    <span
      ref={ref}
      className={`rb-inline ${className}`}
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      role="textbox"
      aria-label={ariaLabel}
      aria-multiline="false"
      data-placeholder={placeholder || ''}
      onInput={handleInput}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
      spellCheck={false}
      style={style}
    />
  )
}
