import { useEffect, useState } from 'react'
import { Filter, Plus, X, Mail, Link as LinkIcon } from 'lucide-react'
import AppBar, { PageActions } from '../components/AppBar'
import Logo from '../components/Logo'
import { listContacts, createContact, updateContact, findOrCreateCompany } from '../lib/api'
import { useAuth } from '../hooks/useAuth'
import { relTime } from '../lib/time'
import toast from 'react-hot-toast'

export default function Connections() {
  const { user } = useAuth()
  const [contacts, setContacts] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [filter, setFilter] = useState('')

  const load = async () => {
    setLoading(true)
    try { setContacts(await listContacts()) } catch { toast.error('Could not load contacts') }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const filtered = filter
    ? contacts.filter(c =>
        (c.name || '').toLowerCase().includes(filter.toLowerCase()) ||
        (c.email || '').toLowerCase().includes(filter.toLowerCase()) ||
        (c.company?.name || '').toLowerCase().includes(filter.toLowerCase()))
    : contacts

  return (
    <>
      <AppBar title="Contacts & Connections" crumbs="people · auto-extracted" />
      <PageActions
        left={
          <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter…"
            style={{ padding: '5px 9px', border: '1px solid var(--line)', borderRadius: 6, fontSize: 11.5, width: 200 }} />
        }
        right={<button className="btn primary tiny" onClick={() => setShowAdd(true)}><Plus size={13} />Add</button>}
      />
      <div className="content">
        {loading ? (
          <div className="conn-grid">
            {[1,2,3,4,5,6].map(i => <div key={i} className="card skel" style={{ height: 100 }} />)}
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 60, textAlign: 'center', color: 'var(--ink-3)' }}>
            <p>No connections yet.</p>
            <button className="btn indigo" onClick={() => setShowAdd(true)} style={{ marginTop: 12 }}>
              <Plus size={13} />Add your first contact
            </button>
          </div>
        ) : (
          <div className="conn-grid">
            {filtered.map((c, i) => {
              const initials = (c.name || '?').split(' ').map(s => s[0]).join('').slice(0, 2)
              return (
                <div key={c.id} className="card card-pad" style={{ cursor: 'default' }}>
                  <div className="row" style={{ gap: 12, marginBottom: 10 }}>
                    <div className={`av-grad-${i % 6}`} style={{
                      width: 40, height: 40, borderRadius: '50%', color: '#fff',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontWeight: 700, fontSize: 13,
                    }}>{initials}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13.5 }}>{c.name || '—'}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{c.role || 'Contact'}</div>
                    </div>
                    {c.company?.name && <Logo co={c.company.name} size={26} />}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--ink-2)', borderTop: '1px solid var(--line)', paddingTop: 10 }}>
                    <span style={{ display: 'flex', gap: 6 }}>
                      {c.email && <a href={`mailto:${c.email}`} className="src-link"><Mail size={11} /></a>}
                      {c.linkedin_url && <a href={c.linkedin_url} target="_blank" rel="noreferrer" className="src-link"><LinkIcon size={11} /></a>}
                    </span>
                    <span className="mono muted">last contact · {c.last_contacted_at ? relTime(c.last_contacted_at) : 'never'}</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
      {showAdd && <AddContactModal onClose={() => setShowAdd(false)} onCreated={load} />}
    </>
  )
}

function AddContactModal({ onClose, onCreated }) {
  const { user } = useAuth()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('recruiter')
  const [company, setCompany] = useState('')
  const [linkedin, setLinkedin] = useState('')
  const [busy, setBusy] = useState(false)

  const create = async (e) => {
    e?.preventDefault()
    if (!name) return
    setBusy(true)
    try {
      const co = company ? await findOrCreateCompany(company) : null
      await createContact({
        name, email: email || null, role,
        company_id: co?.id || null,
        linkedin_url: linkedin || null,
        last_contacted_at: null,
      }, user.id)
      toast.success('Contact added')
      onCreated()
      onClose()
    } catch { toast.error('Could not create contact') }
    finally { setBusy(false) }
  }

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Add contact</h3>
          <button className="btn ghost icon" onClick={onClose}><X size={14} /></button>
        </div>
        <form className="modal-body" onSubmit={create}>
          <div className="field">
            <label>Name *</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Lin Wu" autoFocus />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div className="field">
              <label>Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="lin@anthropic.com" />
            </div>
            <div className="field">
              <label>Role</label>
              <select value={role} onChange={e => setRole(e.target.value)}>
                <option value="recruiter">Recruiter</option>
                <option value="hiring_manager">Hiring manager</option>
                <option value="referrer">Referrer</option>
                <option value="interviewer">Interviewer</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>
          <div className="field">
            <label>Company</label>
            <input value={company} onChange={e => setCompany(e.target.value)} placeholder="Anthropic" />
          </div>
          <div className="field">
            <label>LinkedIn URL (optional)</label>
            <input value={linkedin} onChange={e => setLinkedin(e.target.value)} placeholder="https://linkedin.com/in/…" />
          </div>
        </form>
        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn indigo" onClick={create} disabled={!name || busy}>{busy ? 'Adding…' : 'Add contact'}</button>
        </div>
      </div>
    </div>
  )
}
