import { useState } from 'react'
import { X } from 'lucide-react'
import { createTask, listApplications } from '../lib/api'
import { useAuth } from '../hooks/useAuth'
import toast from 'react-hot-toast'
import { useEffect } from 'react'

export default function AddTaskModal({ onClose, onCreated, applicationId = null }) {
  const { user } = useAuth()
  const [title, setTitle] = useState('')
  const [due, setDue] = useState('')
  const [appId, setAppId] = useState(applicationId)
  const [apps, setApps] = useState([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    listApplications().then(setApps).catch(() => {})
  }, [])

  const create = async (e) => {
    e?.preventDefault()
    if (!title) return
    setBusy(true)
    try {
      const t = await createTask({
        title,
        due_at: due ? new Date(due).toISOString() : null,
        application_id: appId || null,
      }, user.id)
      toast.success('Task created')
      onCreated?.(t)
      onClose()
    } catch (e) { toast.error('Could not create task') }
    finally { setBusy(false) }
  }

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <h3>New task</h3>
          <button className="btn ghost icon" onClick={onClose}><X size={14} /></button>
        </div>
        <form className="modal-body" onSubmit={create}>
          <div className="field">
            <label>Title</label>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Follow up with…" autoFocus />
          </div>
          <div className="field">
            <label>Due</label>
            <input type="datetime-local" value={due} onChange={e => setDue(e.target.value)} />
          </div>
          <div className="field">
            <label>Linked application (optional)</label>
            <select value={appId || ''} onChange={e => setAppId(e.target.value || null)}>
              <option value="">— None —</option>
              {apps.map(a => <option key={a.id} value={a.id}>{a.company?.name} · {a.role_title}</option>)}
            </select>
          </div>
        </form>
        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn indigo" onClick={create} disabled={!title || busy}>
            {busy ? 'Creating…' : 'Create task'}
          </button>
        </div>
      </div>
    </div>
  )
}
