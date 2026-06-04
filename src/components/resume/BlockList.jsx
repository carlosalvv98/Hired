import { useState, useRef } from 'react'
import { GripVertical, MoreHorizontal, Plus, Copy, Trash2, ChevronUp, ChevronDown } from 'lucide-react'
import { BlockBody } from './blocks'
import { BLOCK_TYPES, BLOCK_LABELS, emptyBlock, uid } from '../../lib/resumeBlocks'

/**
 * Renders the full block list with drag-reorder, include/exclude checkbox,
 * per-block 3-dot menu, and "Add section" button at the bottom.
 *
 * Reorder uses HTML5 native drag-and-drop — no extra deps. We track the
 * dragged block's id in state and use dragover position to swap.
 */
export default function BlockList({ blocks, onChange }) {
  const [dragId, setDragId] = useState(null)
  const [overId, setOverId] = useState(null)
  const [menuOpen, setMenuOpen] = useState(null)
  const [addOpen, setAddOpen] = useState(false)

  // Count earlier blocks of the same type so we know whether to render the
  // section heading on the first one only (e.g. "Experience" shows above
  // the first experience entry, not every one).
  const firstOfTypeIndex = (idx) => {
    const t = blocks[idx].type
    for (let i = 0; i < idx; i++) if (blocks[i].type === t) return false
    return true
  }

  const updateBlock = (id, next) => {
    onChange(blocks.map(b => b.id === id ? next : b))
  }

  const moveBlock = (id, delta) => {
    const idx = blocks.findIndex(b => b.id === id)
    if (idx === -1) return
    const target = idx + delta
    if (target < 0 || target >= blocks.length) return
    const next = [...blocks]
    const [b] = next.splice(idx, 1)
    next.splice(target, 0, b)
    onChange(next)
  }

  const duplicateBlock = (id) => {
    const idx = blocks.findIndex(b => b.id === id)
    if (idx === -1) return
    const clone = JSON.parse(JSON.stringify(blocks[idx]))
    clone.id = uid()
    // Regenerate nested bullet ids too so React keys stay stable across the pair.
    if (Array.isArray(clone.data?.bullets)) {
      clone.data.bullets = clone.data.bullets.map(p => ({ ...p, id: uid('p') }))
    }
    const next = [...blocks]
    next.splice(idx + 1, 0, clone)
    onChange(next)
  }

  const deleteBlock = (id) => {
    onChange(blocks.filter(b => b.id !== id))
  }

  const toggleIncluded = (id) => {
    onChange(blocks.map(b => b.id === id ? { ...b, included: !b.included } : b))
  }

  const addBlock = (type) => {
    onChange([...blocks, emptyBlock(type)])
    setAddOpen(false)
  }

  // Drag handlers
  const onDragStart = (e, id) => {
    setDragId(id)
    e.dataTransfer.effectAllowed = 'move'
    // Required for Firefox to fire dragstart.
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

  return (
    <div className="rb-list">
      {blocks.map((block, idx) => (
        <BlockRow
          key={block.id}
          block={block}
          isFirstOfType={firstOfTypeIndex(idx)}
          isDragging={dragId === block.id}
          isOver={overId === block.id && dragId && dragId !== block.id}
          menuOpen={menuOpen === block.id}
          onMenuToggle={() => setMenuOpen(menuOpen === block.id ? null : block.id)}
          onMenuClose={() => setMenuOpen(null)}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDrop={onDrop}
          onDragEnd={onDragEnd}
          onChange={(next) => updateBlock(block.id, next)}
          onToggleIncluded={() => toggleIncluded(block.id)}
          onDuplicate={() => duplicateBlock(block.id)}
          onDelete={() => deleteBlock(block.id)}
          onMoveUp={() => moveBlock(block.id, -1)}
          onMoveDown={() => moveBlock(block.id, +1)}
        />
      ))}
      <AddSection open={addOpen} setOpen={setAddOpen} onAdd={addBlock} />
    </div>
  )
}

function BlockRow({
  block, isFirstOfType, isDragging, isOver,
  menuOpen, onMenuToggle, onMenuClose,
  onDragStart, onDragOver, onDrop, onDragEnd,
  onChange, onToggleIncluded, onDuplicate, onDelete, onMoveUp, onMoveDown,
}) {
  const rowRef = useRef(null)

  return (
    <div
      ref={rowRef}
      data-block-id={block.id}
      className={`rb-row ${!block.included ? 'rb-excluded' : ''} ${isDragging ? 'rb-dragging' : ''} ${isOver ? 'rb-drop-target' : ''}`}
      onDragOver={(e) => onDragOver(e, block.id)}
      onDrop={(e) => onDrop(e, block.id)}
    >
      <div className="rb-row-gutter">
        <button
          type="button"
          className="rb-drag"
          draggable
          onDragStart={(e) => onDragStart(e, block.id)}
          onDragEnd={onDragEnd}
          title="Drag to reorder"
          aria-label="Drag to reorder"
        ><GripVertical size={14} /></button>
        <label className="rb-include" title={block.included ? 'Include in resume' : 'Excluded — click to include'}>
          <input
            type="checkbox"
            checked={!!block.included}
            onChange={onToggleIncluded}
            aria-label="Include in resume"
          />
        </label>
      </div>

      <div className="rb-row-body">
        <BlockBody block={block} onChange={onChange} isFirstOfType={isFirstOfType} />
        {!block.included && (
          <div className="rb-excluded-tag">Excluded from this resume</div>
        )}
      </div>

      <div className="rb-row-actions">
        <button type="button" className="rb-menu-btn" onClick={onMenuToggle} aria-label="Block menu">
          <MoreHorizontal size={14} />
        </button>
        {menuOpen && (
          <>
            <div className="rb-menu-scrim" onClick={onMenuClose} />
            <div className="rb-menu" role="menu">
              <button type="button" onClick={() => { onMoveUp(); onMenuClose() }}><ChevronUp size={12} />Move up</button>
              <button type="button" onClick={() => { onMoveDown(); onMenuClose() }}><ChevronDown size={12} />Move down</button>
              <button type="button" onClick={() => { onDuplicate(); onMenuClose() }}><Copy size={12} />Duplicate</button>
              <div className="rb-menu-sep" />
              <button type="button" className="rb-menu-danger" onClick={() => { onDelete(); onMenuClose() }}><Trash2 size={12} />Delete</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function AddSection({ open, setOpen, onAdd }) {
  return (
    <div className="rb-add-wrap">
      {!open ? (
        <button type="button" className="rb-add-section" onClick={() => setOpen(true)}>
          <Plus size={14} />Add section
        </button>
      ) : (
        <div className="rb-add-menu">
          <div className="rb-add-menu-h">Add a section</div>
          <div className="rb-add-menu-grid">
            {BLOCK_TYPES.filter(t => t !== 'header').map(t => (
              <button key={t} type="button" className="rb-add-menu-item" onClick={() => onAdd(t)}>
                {BLOCK_LABELS[t]}
              </button>
            ))}
          </div>
          <button type="button" className="rb-add-menu-cancel" onClick={() => setOpen(false)}>Cancel</button>
        </div>
      )}
    </div>
  )
}
