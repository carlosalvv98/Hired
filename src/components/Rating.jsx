import { useState } from 'react'
import { Star } from 'lucide-react'

export default function Rating({ value = 0, onChange, size = 13 }) {
  const [hover, setHover] = useState(0)
  return (
    <span className="rating" onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map(i => {
        const active = i <= value
        const isHover = hover && i <= hover
        return (
          <span key={i}
            className={`s ${active ? 'on' : ''} ${isHover ? 'h' : ''}`}
            onMouseEnter={() => setHover(i)}
            onClick={(e) => { e.stopPropagation(); onChange?.(i === value ? 0 : i) }}>
            <Star size={size} fill={active ? 'currentColor' : 'none'} strokeWidth={1.5} />
          </span>
        )
      })}
    </span>
  )
}
