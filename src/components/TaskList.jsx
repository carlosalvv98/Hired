import { Check, Plus } from 'lucide-react'
import { shortDate } from '../lib/time'

// Today's tasks card. Shared by the dashboard and the calendar page.
export default function TaskList({ tasks, overdue, onToggle, onAdd }) {
  return (
    <div className="card card-pad">
      <div style={{ display: 'flex', alignItems: 'baseline' }}>
        <h3 style={{ margin: 0 }}>Today's tasks <span className="count">{tasks.length}{overdue ? ` · ${overdue} overdue` : ''}</span></h3>
        <span style={{ flex: 1 }} />
        <button className="btn ghost tiny" onClick={onAdd}><Plus size={11} /></button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 10 }}>
        {tasks.length === 0 && <div className="muted" style={{ fontSize: 12 }}>No tasks. Quiet day. ✨</div>}
        {tasks.map((t, i) => (
          <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 4px', borderBottom: i < tasks.length - 1 ? '1px dashed var(--line)' : 'none', opacity: t.done ? 0.55 : 1 }}>
            <button onClick={() => onToggle(t)} style={{
              width: 16, height: 16, borderRadius: 4,
              border: t.done ? 'none' : '1.5px solid var(--line-2)',
              background: t.done ? 'var(--ink)' : '#fff',
              color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>{t.done && <Check size={11} />}</button>
            <span style={{ flex: 1, fontSize: 12.5, textDecoration: t.done ? 'line-through' : 'none', color: t.done ? 'var(--ink-3)' : 'var(--ink)' }}>{t.title}</span>
            {t.due_at && <span className="mono muted" style={{ fontSize: 10.5 }}>{shortDate(t.due_at)}</span>}
          </div>
        ))}
      </div>
    </div>
  )
}
