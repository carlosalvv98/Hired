import { STAGE_LABEL } from '../lib/stages'

export default function StatusPill({ s }) {
  if (!s) return null
  return <span className={`pill ${s}`}>{STAGE_LABEL[s] || s}</span>
}
