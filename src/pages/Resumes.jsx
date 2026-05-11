import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Sparkles, Plus, Download, Upload } from 'lucide-react'
import AppBar, { PageActions } from '../components/AppBar'
import { listResumes, createResume } from '../lib/api'
import { useAuth } from '../hooks/useAuth'
import { relTime } from '../lib/time'
import toast from 'react-hot-toast'

const STARTER = `# Your Name
Senior Software Engineer · City

## Summary
Senior engineer with X years of experience…

## Experience
**Company · Senior Engineer**  · 2023 – Present
- Bullet 1
- Bullet 2

## Education
**B.S. Computer Science** · University · Year

## Skills
TypeScript · Go · Postgres · React
`

export default function Resumes() {
  const { user } = useAuth()
  const nav = useNavigate()
  const [resumes, setResumes] = useState([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)

  const load = async () => {
    setLoading(true)
    try { setResumes(await listResumes()) } catch { toast.error('Could not load resumes') }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const onNew = async () => {
    setCreating(true)
    try {
      const r = await createResume({
        name: `Resume v${resumes.length + 1}`,
        version: `v${resumes.length + 1}`,
        content_md: STARTER,
      }, user.id)
      toast.success('Resume created')
      nav(`/resumes/${r.id}`)
    } catch { toast.error('Could not create resume') }
    finally { setCreating(false) }
  }

  return (
    <>
      <AppBar title="Resumes" crumbs={`resumes · ${resumes.length} version${resumes.length === 1 ? '' : 's'}`} />
      <PageActions right={
        <>
          <button className="btn ghost tiny" onClick={() => toast('Drag in a PDF or .md to import')}><Upload size={13} />Import</button>
          <button className="btn primary tiny" onClick={onNew} disabled={creating}><Plus size={13} />{creating ? 'Creating…' : 'New'}</button>
        </>
      } />
      <div className="content">
        <div className="resume-grid">
          <div className="resume-card create" onClick={onNew}>
            <div className="ico-big"><Sparkles size={20} /></div>
            <h4>Create from scratch</h4>
            <p>Start with a clean template, then tailor each version to a specific role.</p>
            <div className="mono" style={{ fontSize: 10, color: 'var(--accent)', marginTop: 6, fontWeight: 600, letterSpacing: '0.08em' }}>
              ↗ 5 MIN
            </div>
          </div>
          {loading ? (
            [1,2,3].map(i => <div key={i} className="card skel" style={{ height: 320 }} />)
          ) : resumes.map(r => (
            <div key={r.id} className="resume-card" onClick={() => nav(`/resumes/${r.id}`)}>
              <div className="preview">
                <MiniResume content={r.content_md} />
              </div>
              <div className="meta">
                <h4>{r.name}</h4>
                <div className="sub">{r.version || '—'} · updated {relTime(r.created_at)}</div>
                <div className="stats">
                  <span><b>0</b> apps</span>
                  <span>·</span>
                  <span>ATS <b>—</b></span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

function MiniResume({ content = '' }) {
  const lines = content.split('\n').slice(0, 14)
  return (
    <div style={{ padding: '20px 22px', fontSize: 9, lineHeight: 1.4, color: 'var(--ink-2)' }}>
      {lines.map((l, i) => {
        if (l.startsWith('# ')) return <div key={i} style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>{l.slice(2)}</div>
        if (l.startsWith('## ')) return <div key={i} style={{ fontSize: 9, fontWeight: 600, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: 6 }}>{l.slice(3)}</div>
        if (l.startsWith('**')) return <div key={i} style={{ fontWeight: 600, marginTop: 4 }}>{l.replace(/\*\*/g, '').slice(0, 50)}</div>
        if (l.startsWith('- ')) return <div key={i} style={{ paddingLeft: 6 }}>• {l.slice(2).slice(0, 60)}</div>
        return <div key={i} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.slice(0, 60)}</div>
      })}
    </div>
  )
}
