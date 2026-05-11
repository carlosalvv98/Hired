export default function IvProgress({ steps = [], onAdd }) {
  if (!steps.length) {
    return <span className="iv-prog"><span className="add" onClick={onAdd}>+ add steps</span></span>
  }
  const done = steps.filter(s => s.status === 'done').length
  const total = steps.length
  return (
    <span className="iv-prog">
      <span className="boxes">
        {steps.map((_, i) => <span key={i} className={`b ${i < done ? 'f' : ''}`} />)}
      </span>
      <span className="frac">{done}/{total}</span>
    </span>
  )
}
