import toast from 'react-hot-toast'

/**
 * In-app confirmation prompt. Replaces native window.confirm so we don't
 * trigger the browser's "localhost says…" chrome.
 *
 * Resolves true when the user clicks the confirm button, false when they
 * dismiss (cancel, scrim click, or auto-dismiss).
 *
 * @param {string} message      - body text shown to the user
 * @param {object} [opts]
 * @param {string} [opts.confirmLabel='Confirm']
 * @param {string} [opts.cancelLabel='Cancel']
 * @param {'danger'|'primary'} [opts.tone='primary'] - styles the confirm button
 */
export function confirmToast(message, opts = {}) {
  const { confirmLabel = 'Confirm', cancelLabel = 'Cancel', tone = 'primary' } = opts
  return new Promise(resolve => {
    const id = toast.custom((t) => (
      <div className={`confirm-toast ${t.visible ? 'in' : 'out'}`}>
        <div className="confirm-toast-msg">{message}</div>
        <div className="confirm-toast-actions">
          <button
            className="btn ghost tiny"
            onClick={() => { toast.dismiss(id); resolve(false) }}>
            {cancelLabel}
          </button>
          <button
            className={tone === 'danger' ? 'btn danger tiny' : 'btn primary tiny'}
            onClick={() => { toast.dismiss(id); resolve(true) }}>
            {confirmLabel}
          </button>
        </div>
      </div>
    ), { duration: Infinity, position: 'bottom-right' })
  })
}
