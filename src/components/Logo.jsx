import { useEffect, useState } from 'react'
import { logoColors } from '../lib/logos'

// Renders a company logo. When a `domain` is known we try to load the real
// logo (Clearbit first, then Google's favicon as a backup); if every source
// fails — or no domain is available — we fall back to the colored initial box.
export default function Logo({ co, domain, size = 28 }) {
  const sources = domain
    ? [
        `https://logo.clearbit.com/${domain}`,
        `https://www.google.com/s2/favicons?domain=${domain}&sz=128`,
      ]
    : []
  const [srcIdx, setSrcIdx] = useState(0)

  // Reset to the first source whenever the domain changes (the component
  // stays mounted across drawer navigations).
  useEffect(() => { setSrcIdx(0) }, [domain])

  const [bg, fg] = logoColors(co)
  const initial = (co && co[0]) || '?'
  const isWhite = bg.toLowerCase() === '#ffffff'

  if (sources[srcIdx]) {
    return (
      <div className="logo" style={{
        width: size, height: size,
        background: '#fff', border: '1px solid var(--line)',
        overflow: 'hidden', padding: 0,
      }}>
        <img
          src={sources[srcIdx]}
          alt={co || ''}
          width={size} height={size}
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
          // Advance to the next source, or fall through to initials when
          // we've exhausted them.
          onError={() => setSrcIdx(i => i + 1)}
        />
      </div>
    )
  }

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
