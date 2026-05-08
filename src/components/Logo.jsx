import { logoColors } from '../lib/logos'

export default function Logo({ co, size = 28 }) {
  const [bg, fg] = logoColors(co)
  const initial = (co && co[0]) || '?'
  const isWhite = bg.toLowerCase() === '#ffffff'
  return (
    <div className="logo" style={{
      background: bg,
      color: fg,
      width: size,
      height: size,
      fontSize: size * 0.42,
      border: isWhite ? '1px solid var(--line)' : 'none',
    }}>{initial}</div>
  )
}
