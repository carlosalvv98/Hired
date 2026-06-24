import { Reply, ReplyAll, Forward, FileText, Image as ImageIcon, File, Download } from 'lucide-react'
import { useUI } from '../hooks/useUI'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'

// Reply / Reply All / Forward action row for a read email. Reply All only
// appears when the email actually has Cc recipients (otherwise it's identical
// to Reply). Each button opens the global floating composer.
export function EmailActions({ email, compact = false }) {
  const { openCompose } = useUI()
  if (!email) return null

  const hasCc = Array.isArray(email.cc_addresses) && email.cc_addresses.length > 0

  const open = (mode) => openCompose({
    mode,
    originalEmail: email,
    applicationId: email.linked_application_id || null,
  })

  const size = compact ? 13 : 14
  return (
    <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
      <button className="btn ghost tiny" onClick={() => open('reply')}><Reply size={size} />Reply</button>
      {hasCc && <button className="btn ghost tiny" onClick={() => open('reply_all')}><ReplyAll size={size} />Reply All</button>}
      <button className="btn ghost tiny" onClick={() => open('forward')}><Forward size={size} />Forward</button>
    </div>
  )
}

function iconFor(type = '') {
  if (type.startsWith('image/')) return ImageIcon
  if (type === 'application/pdf' || type.includes('word') || type === 'text/plain') return FileText
  return File
}

function fmtSize(bytes) {
  if (!bytes && bytes !== 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// Downloadable chips for attachments stored on an inbound/outbound email
// (parse_json.attachments). Generates a short-lived signed URL on click.
export function EmailAttachments({ email }) {
  const list = email?.parse_json?.attachments
  if (!Array.isArray(list) || list.length === 0) return null

  const onOpen = async (att) => {
    if (!att.path) { toast.error('Attachment unavailable'); return }
    try {
      const { data, error } = await supabase.storage
        .from('email-attachments')
        .createSignedUrl(att.path, 3600)
      if (error || !data?.signedUrl) throw error || new Error('no url')
      window.open(data.signedUrl, '_blank', 'noopener')
    } catch {
      toast.error('Could not open attachment')
    }
  }

  return (
    <div className="compose-attachments" style={{ marginTop: 14 }}>
      {list.map((att, i) => {
        const Icon = iconFor(att.content_type)
        return (
          <button key={i} className="attach-pill" onClick={() => onOpen(att)} title="Download" style={{ cursor: 'pointer' }}>
            <Icon size={12} />
            <span className="attach-name">{att.name}</span>
            {att.size != null && <span className="attach-size">{fmtSize(att.size)}</span>}
            <Download size={11} />
          </button>
        )
      })}
    </div>
  )
}
