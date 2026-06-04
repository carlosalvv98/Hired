import { useState } from 'react'
import { GripVertical, User, FileText, Briefcase, GraduationCap, Code2, FolderGit2, Award, Plus } from 'lucide-react'

const ICONS = {
  header:         User,
  summary:        FileText,
  experience:     Briefcase,
  education:      GraduationCap,
  skills:         Code2,
  projects:       FolderGit2,
  certifications: Award,
  custom:         Plus,
}

function labelFor(block) {
  const d = block.data || {}
  switch (block.type) {
    case 'header':         return { title: d.name || 'Header', sub: d.title || '' }
    case 'summary':        return { title: 'Summary', sub: '' }
    case 'experience':     return { title: d.company || 'Experience', sub: d.role || '' }
    case 'education':      return { title: d.school || 'Education', sub: d.degree || '' }
    case 'skills':         return { title: 'Skills', sub: '' }
    case 'projects':       return { title: d.name || 'Project', sub: '' }
    case 'certifications': return { title: 'Certifications', sub: '' }
    case 'custom':         return { title: d.title || 'Custom section', sub: '' }
    default:               return { title: block.type, sub: '' }
  }
}

/**
 * Sidebar outline of the resume's blocks. Each row mirrors a block in
 * the main editor and can be dragged to reorder, clicked to scroll-to,
 * or toggled with its include checkbox.
 *
 * Reorder operates on the same `blocks` array the editor uses — drop
 * commits via `onChange`, so the main canvas re-renders in lockstep.
 *
 * Click-to-scroll uses `data-block-id` attributes on the editor rows.
 */
export default function BlockOutline({ blocks, onChange }) {
  const [dragId, setDragId] = useState(null)
  const [overId, setOverId] = useState(null)

  const onDragStart = (e, id) => {
    setDragId(id)
    e.dataTransfer.effectAllowed = 'move'
    try { e.dataTransfer.setData('text/plain', id) } catch { /* noop */ }
  }
  const onDragOver = (e, id) => {
    e.preventDefault()
    if (id !== overId) setOverId(id)
  }
  const onDrop = (e, targetId) => {
    e.preventDefault()
    if (!dragId || dragId === targetId) { setDragId(null); setOverId(null); return }
    const fromIdx = blocks.findIndex(b => b.id === dragId)
    const toIdx   = blocks.findIndex(b => b.id === targetId)
    if (fromIdx === -1 || toIdx === -1) { setDragId(null); setOverId(null); return }
    const next = [...blocks]
    const [moved] = next.splice(fromIdx, 1)
    next.splice(toIdx, 0, moved)
    onChange(next)
    setDragId(null); setOverId(null)
  }
  const onDragEnd = () => { setDragId(null); setOverId(null) }

  const toggleIncluded = (id) => {
    onChange(blocks.map(b => b.id === id ? { ...b, included: !b.included } : b))
  }

  const scrollToBlock = (id) => {
    const el = document.querySelector(`[data-block-id="${id}"]`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      el.classList.add('rb-row-flash')
      setTimeout(() => el.classList.remove('rb-row-flash'), 900)
    }
  }

  return (
    <div className="rb-outline">
      {blocks.map((b) => {
        const Ico = ICONS[b.type] || Plus
        const { title, sub } = labelFor(b)
        const isOver = overId === b.id && dragId && dragId !== b.id
        const isDragging = dragId === b.id
        return (
          <div
            key={b.id}
            className={`rb-outline-row ${!b.included ? 'rb-outline-excluded' : ''} ${isDragging ? 'rb-outline-dragging' : ''} ${isOver ? 'rb-outline-drop-target' : ''}`}
            onDragOver={(e) => onDragOver(e, b.id)}
            onDrop={(e) => onDrop(e, b.id)}
            onClick={() => scrollToBlock(b.id)}
          >
            <button
              type="button"
              className="rb-outline-drag"
              draggable
              onDragStart={(e) => onDragStart(e, b.id)}
              onDragEnd={onDragEnd}
              onClick={(e) => e.stopPropagation()}
              title="Drag to reorder"
              aria-label="Drag to reorder"
            ><GripVertical size={12} /></button>
            <input
              type="checkbox"
              className="rb-outline-check"
              checked={!!b.included}
              onChange={(e) => { e.stopPropagation(); toggleIncluded(b.id) }}
              onClick={(e) => e.stopPropagation()}
              aria-label="Include in resume"
            />
            <Ico size={12} className="rb-outline-ico" />
            <div className="rb-outline-text">
              <div className="rb-outline-title">{title}</div>
              {sub && <div className="rb-outline-sub">{sub}</div>}
            </div>
          </div>
        )
      })}
    </div>
  )
}
