import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { createCalendarEvent, listApplications } from '../lib/api'
import { useAuth } from '../hooks/useAuth'
import toast from 'react-hot-toast'

export default function AddEventModal({ onClose, onCreated, defaultDate }) {
  const { user } = useAuth()
  const [title, setTitle] = useState('')
  const [start, setStart] = useState(defaultDate ? new Date(defaultDate).toISOString().slice(0, 16) : '')
  const [end, setEnd] = useState('')
  const [appId, setAppId] = useState(null)
  const [apps, setApps] = useState([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    listApplications().then(setApps).catch(() => {})
  }, [])

  const create = async (e) => {
    e?.preventDefault()
    if (!title || !start) return
    setBusy(true)
    try {
      const ev = await createCalendarEvent({
        title,
        starts_at: new Date(start).toISOString(),
        ends_at: end ? new Date(end).toISOString() : null,
        application_id: appId || null,
      }, user.id)
      toast.success('Event created')
      onCreated?.(ev)
      onClose()
    } catch (err) { toast.error('Could not create event') }
    finally { setBusy(false) }
  }

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <h3>New event</h3>
          <button className="btn ghost icon" onClick={onClose}><X size={14} /></button>
        </div>
        <form className="modal-body" onSubmit={create}>
          <div className="field">
            <label>Title</label>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Tech screen — Anthropic" autoFocus />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div className="field">
              <label>Starts</label>
              <input type="datetime-local" value={start} onChange={e => setStart(e.target.value)} />
            </div>
            <div className="field">
              <label>Ends</label>
              <input type="datetime-local" value={end} onChange={e => setEnd(e.target.value)} />
            </div>
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
          <button className="btn indigo" onClick={create} disabled={!title || !start || busy}>
            {busy ? 'Creating…' : 'Create event'}
          </button>
        </div>
      </div>
    </div>
  )
}
