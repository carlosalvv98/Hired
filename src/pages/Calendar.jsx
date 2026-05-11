import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import AppBar, { PageActions } from '../components/AppBar'
import { listCalendar, deleteCalendarEvent } from '../lib/api'
import { startOfMonth, endOfMonth, startOfWeek, endOfWeek, addDays, addMonths, subMonths, format, isSameDay, isSameMonth, isToday } from 'date-fns'
import AddEventModal from '../components/AddEventModal'
import { useUI } from '../hooks/useUI'
import { confirmToast } from '../lib/confirmToast'
import toast from 'react-hot-toast'

export default function CalendarPage() {
  const [cursor, setCursor] = useState(new Date())
  const [events, setEvents] = useState([])
  const [showAdd, setShowAdd] = useState(false)
  const [defaultDate, setDefaultDate] = useState(null)
  const { openDrawer } = useUI()

  const range = useMemo(() => {
    const start = startOfWeek(startOfMonth(cursor), { weekStartsOn: 0 })
    const end = endOfWeek(endOfMonth(cursor), { weekStartsOn: 0 })
    const days = []
    let d = start
    while (d <= end) { days.push(d); d = addDays(d, 1) }
    return { start, end, days }
  }, [cursor])

  const load = async () => {
    try {
      const e = await listCalendar({ from: range.start.toISOString(), to: range.end.toISOString() })
      setEvents(e)
    } catch { toast.error('Could not load calendar') }
  }
  useEffect(() => { load() }, [cursor])

  const eventsByDay = useMemo(() => {
    const map = {}
    events.forEach(e => {
      const k = format(new Date(e.starts_at), 'yyyy-MM-dd')
      if (!map[k]) map[k] = []
      map[k].push(e)
    })
    return map
  }, [events])

  const onCellClick = (d) => {
    setDefaultDate(d.toISOString())
    setShowAdd(true)
  }

  const onDeleteEvent = async (id) => {
    const ok = await confirmToast('Delete this event?', { confirmLabel: 'Delete', tone: 'danger' })
    if (!ok) return
    try {
      await deleteCalendarEvent(id)
      setEvents(prev => prev.filter(e => e.id !== id))
      toast.success('Deleted')
    } catch { toast.error('Delete failed') }
  }

  return (
    <>
      <AppBar title="Calendar" crumbs="month" />
      <PageActions
        left={
          <h2 className="page-month-h">{format(cursor, 'MMMM yyyy')}</h2>
        }
        right={
          <>
            <button className="btn ghost tiny" onClick={() => setCursor(new Date())}>Today</button>
            <button className="btn ghost icon" onClick={() => setCursor(c => subMonths(c, 1))}><ChevronLeft size={13} /></button>
            <button className="btn ghost icon" onClick={() => setCursor(c => addMonths(c, 1))}><ChevronRight size={13} /></button>
            <button className="btn primary tiny" onClick={() => { setDefaultDate(null); setShowAdd(true) }}><Plus size={13} />Event</button>
          </>
        } />
      <div className="content tight">
        <div className="cal-grid">
          {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => (
            <div key={d} className="cal-head">{d}</div>
          ))}
          {range.days.map(d => {
            const k = format(d, 'yyyy-MM-dd')
            const ev = eventsByDay[k] || []
            return (
              <div key={k}
                className={`cal-cell ${!isSameMonth(d, cursor) ? 'outside' : ''} ${isToday(d) ? 'today' : ''}`}
                onClick={(e) => { if (e.target === e.currentTarget) onCellClick(d) }}>
                <div className="num">{format(d, 'd')}</div>
                {ev.map(x => (
                  <div key={x.id} className={`cal-event pill ${x.application?.stage || 'iv'}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      if (x.application?.id) openDrawer(x.application.id)
                    }}
                    onContextMenu={(e) => { e.preventDefault(); onDeleteEvent(x.id) }}
                    title={`${x.title} — right-click to delete`}>
                    {format(new Date(x.starts_at), 'HH:mm')} · {x.title}
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      </div>
      {showAdd && <AddEventModal onClose={() => setShowAdd(false)} onCreated={() => load()} defaultDate={defaultDate} />}
    </>
  )
}
