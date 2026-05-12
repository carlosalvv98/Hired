import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

/**
 * Centered confirmation dialog. Replaces native window.confirm with an
 * in-app modal that takes the center of the screen so destructive
 * actions feel deliberate.
 *
 * Resolves true when the user confirms, false when they cancel / dismiss.
 *
 * Name kept as `confirmToast` so the existing call sites don't need to
 * change — it just happens to render as a modal now rather than a toast.
 *
 * @param {string} message      - body text shown to the user
 * @param {object} [opts]
 * @param {string} [opts.title='Are you sure?']
 * @param {string} [opts.confirmLabel='Confirm']
 * @param {string} [opts.cancelLabel='Cancel']
 * @param {'danger'|'primary'} [opts.tone='primary']
 */
export function confirmToast(message, opts = {}) {
  return new Promise(resolve => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)

    const cleanup = () => {
      // Defer unmount so the close animation can finish.
      setTimeout(() => {
        root.unmount()
        host.remove()
      }, 160)
    }

    const finish = (value) => {
      root.render(
        <ConfirmDialog {...opts} message={message} closing onResult={() => {}} />
      )
      cleanup()
      resolve(value)
    }

    root.render(
      <ConfirmDialog
        {...opts}
        message={message}
        onResult={finish}
      />
    )
  })
}

function ConfirmDialog({
  message,
  title = 'Are you sure?',
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'primary',
  closing = false,
  onResult,
}) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    // Trigger the open animation on next paint.
    requestAnimationFrame(() => setOpen(true))
    const onKey = (e) => {
      if (e.key === 'Escape') onResult(false)
      if (e.key === 'Enter') onResult(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className={`confirm-scrim ${open && !closing ? 'in' : 'out'}`}
      onClick={() => onResult(false)}>
      <div className={`confirm-dialog ${open && !closing ? 'in' : 'out'}`}
        role="dialog" aria-modal="true"
        onClick={(e) => e.stopPropagation()}>
        <h3 className="confirm-dialog-title">{title}</h3>
        <p className="confirm-dialog-msg">{message}</p>
        <div className="confirm-dialog-actions">
          <button className="btn ghost" onClick={() => onResult(false)}>{cancelLabel}</button>
          <button
            className={tone === 'danger' ? 'btn danger' : 'btn primary'}
            autoFocus
            onClick={() => onResult(true)}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
