import { STAGE_LABEL } from '../lib/stages'

export default function StatusPill({ s, sm }) {
  if (!s) return null
  return <span className={`pill ${s}${sm ? ' sm' : ''}`}>{STAGE_LABEL[s] || s}</span>
}
