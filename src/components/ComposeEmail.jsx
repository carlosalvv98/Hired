import { useMemo, useRef, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import {
  X, Minus, Bold, Italic, Underline as UnderlineIcon, List, ListOrdered,
  Link2, Undo2, Redo2, Paperclip, Send, Loader2, FileText, Image as ImageIcon, File,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'

// Floating Gmail-style compose window with a TipTap rich-text body. Sends for
// real through the `email-outbound` edge function (base64 attachments, HTML +
// plain-text bodies). Reusable across New / Reply / Reply All / Forward.

const MAX_FILE_BYTES = 25 * 1024 * 1024 // Postmark's 25MB per-file limit
const ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.png,.jpg,.jpeg,.gif,.zip'
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const TITLES = { new: 'New Message', reply: 'Reply', reply_all: 'Reply All', forward: 'Forward' }

// Split a free-typed recipient field ("a@x.com, b@y.com") into clean addresses.
function parseRecipients(raw) {
  return (raw || '')
    .split(/[,\n;]+/)
    .map(s => s.trim())
    .filter(Boolean)
}

function isHtml(s) {
  return typeof s === 'string' && /<\/?[a-z][\s\S]*>/i.test(s)
}

function escapeHtml(s) {
  return (s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Turn a plain-text body (AI drafts arrive as text with newlines) into simple
// paragraph HTML so TipTap renders it with structure.
function textToHtml(text) {
  const safe = escapeHtml(text).trim()
  if (!safe) return ''
  return safe
    .split(/\n{2,}/)
    .map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`)
    .join('')
}

// Build the quoted "On {date}, {sender} wrote:" block appended below a reply
// or forward. Rendered as an editable blockquote (styled with a left border).
function buildQuote(email, forwarded) {
  if (!email) return ''
  let when = ''
  try { when = new Date(email.received_at).toLocaleString() } catch { when = '' }
  const who = `${email.from_name || ''} <${email.from_email || ''}>`.trim()
  const body = isHtml(email.body_html)
    ? email.body_html
    : textToHtml(email.body_text || email.snippet || '')
  const header = forwarded
    ? '---------- Forwarded message ----------'
    : `On ${when}, ${who} wrote:`
  return `<p></p><p>──────────</p><p>${escapeHtml(header)}</p><blockquote>${body}</blockquote>`
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function fileIconFor(type = '') {
  if (type.startsWith('image/')) return ImageIcon
  if (type === 'application/pdf' || type.includes('word') || type === 'text/plain') return FileText
  return File
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '')
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export default function ComposeEmail({
  mode = 'new',
  originalEmail = null,
  prefillTo = '',
  prefillSubject = '',
  prefillBody = '',
  applicationId = null,
  onClose,
  onSent,
}) {
  const { user, profile } = useAuth()

  // ── Initial recipients / subject derived from mode ───────────────────────
  const init = useMemo(() => {
    const myAddrs = new Set(
      [profile?.forwarding_address, user?.email].filter(Boolean).map(s => s.toLowerCase()),
    )
    let to = prefillTo || ''
    let cc = ''
    let subject = prefillSubject || ''

    if (originalEmail) {
      const baseSubject = originalEmail.subject || ''
      if (mode === 'reply' || mode === 'reply_all') {
        to = to || originalEmail.from_email || ''
        subject = subject || (/^re:/i.test(baseSubject) ? baseSubject : `Re: ${baseSubject}`)
      } else if (mode === 'forward') {
        subject = subject || (/^fwd:/i.test(baseSubject) ? baseSubject : `Fwd: ${baseSubject}`)
      }
      if (mode === 'reply_all') {
        const extra = [...(originalEmail.cc_addresses || []), ...(originalEmail.to_addresses || [])]
          .map(s => (s || '').trim())
          .filter(a => a && !myAddrs.has(a.toLowerCase()) && a.toLowerCase() !== (originalEmail.from_email || '').toLowerCase())
        cc = [...new Set(extra)].join(', ')
      }
    }
    return { to, cc, subject }
  }, [mode, originalEmail, prefillTo, prefillSubject, profile, user])

  const initialContent = useMemo(() => {
    const lead = isHtml(prefillBody) ? prefillBody : textToHtml(prefillBody)
    const quote = (mode === 'reply' || mode === 'reply_all')
      ? buildQuote(originalEmail, false)
      : mode === 'forward'
        ? buildQuote(originalEmail, true)
        : ''
    return `${lead || '<p></p>'}${quote}`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [to, setTo] = useState(init.to)
  const [cc, setCc] = useState(init.cc)
  const [showCc, setShowCc] = useState(!!init.cc)
  const [subject, setSubject] = useState(init.subject)
  const [attachments, setAttachments] = useState([]) // { name, type, size, base64 }
  const [sending, setSending] = useState(false)
  const [minimized, setMinimized] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const fileRef = useRef(null)

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Link.configure({ openOnClick: false, autolink: true }),
      Placeholder.configure({ placeholder: 'Write your message...' }),
    ],
    content: initialContent,
  })

  const hasContent = () =>
    !!to.trim() || !!cc.trim() || !!subject.trim() ||
    !!(editor && editor.getText().trim()) || attachments.length > 0

  // ── Attachments ──────────────────────────────────────────────────────────
  const onPickFiles = async (e) => {
    const files = Array.from(e.target.files || [])
    e.target.value = '' // allow re-selecting the same file
    for (const file of files) {
      if (file.size > MAX_FILE_BYTES) {
        toast.error(`${file.name} is over 25 MB`)
        continue
      }
      try {
        const base64 = await fileToBase64(file)
        setAttachments(prev => [...prev, { name: file.name, type: file.type || 'application/octet-stream', size: file.size, base64 }])
      } catch {
        toast.error(`Could not read ${file.name}`)
      }
    }
  }

  const removeAttachment = (i) => setAttachments(prev => prev.filter((_, idx) => idx !== i))

  // ── Send / draft ─────────────────────────────────────────────────────────
  const buildPayload = (isDraft) => ({
    to: parseRecipients(to),
    cc: showCc ? parseRecipients(cc) : [],
    subject,
    html_body: editor ? editor.getHTML() : '',
    text_body: editor ? editor.getText() : '',
    in_reply_to: originalEmail?.provider_message_id || null,
    thread_id: originalEmail?.thread_id || null,
    attachments: attachments.map(a => ({ name: a.name, content_type: a.type, content_base64: a.base64 })),
    is_draft: isDraft,
    application_id: applicationId || originalEmail?.linked_application_id || null,
  })

  const onSend = async () => {
    if (sending) return
    const toAddresses = parseRecipients(to)
    if (toAddresses.length === 0) { toast.error('Add at least one recipient'); return }
    const bad = toAddresses.find(a => !EMAIL_RE.test(a))
    if (bad) { toast.error(`"${bad}" doesn't look like an email`); return }
    if (showCc) {
      const badCc = parseRecipients(cc).find(a => !EMAIL_RE.test(a))
      if (badCc) { toast.error(`Cc "${badCc}" doesn't look like an email`); return }
    }
    if (!subject.trim() && !window.confirm('Send without a subject?')) return

    setSending(true)
    try {
      const { error } = await supabase.functions.invoke('email-outbound', { body: buildPayload(false) })
      if (error) throw error
      toast.success('Email sent')
      onSent?.()
      onClose?.()
    } catch (err) {
      // The edge function still saved the email (folder 'failed') so the work
      // isn't lost; keep the composer open so the user can retry/edit.
      toast.error('Failed to send — your email has been saved as a draft')
    } finally {
      setSending(false)
    }
  }

  const saveDraftAndClose = async () => {
    setConfirmClose(false)
    try {
      await supabase.functions.invoke('email-outbound', { body: buildPayload(true) })
      toast.success('Saved as draft')
    } catch {
      toast.error('Could not save draft')
    }
    onClose?.()
  }

  const handleClose = () => {
    if (hasContent()) setConfirmClose(true)
    else onClose?.()
  }

  // ── Minimized: just the header bar ───────────────────────────────────────
  if (minimized) {
    return (
      <div className="compose-panel minimized">
        <div className="compose-head" onClick={() => setMinimized(false)}>
          <span className="compose-title">{subject?.trim() || TITLES[mode] || 'New Message'}</span>
          <span style={{ flex: 1 }} />
          <button className="compose-icon" title="Expand" onClick={(e) => { e.stopPropagation(); setMinimized(false) }}><Minus size={13} /></button>
          <button className="compose-icon" title="Close" onClick={(e) => { e.stopPropagation(); handleClose() }}><X size={14} /></button>
        </div>
      </div>
    )
  }

  const tb = (active, onClick, title, children) => (
    <button type="button" className={`compose-tb ${active ? 'on' : ''}`} title={title}
      onMouseDown={(e) => e.preventDefault()} onClick={onClick}>
      {children}
    </button>
  )

  return (
    <div className="compose-panel">
      {/* Header */}
      <div className="compose-head">
        <span className="compose-title">{TITLES[mode] || 'New Message'}</span>
        <span style={{ flex: 1 }} />
        <button className="compose-icon" title="Minimize" onClick={() => setMinimized(true)}><Minus size={13} /></button>
        <button className="compose-icon" title="Close" onClick={handleClose}><X size={14} /></button>
      </div>

      {/* Recipients */}
      <div className="compose-fields">
        <div className="compose-field">
          <label>To</label>
          <input value={to} onChange={e => setTo(e.target.value)} placeholder="recipient@company.com"
            spellCheck={false} autoComplete="off" />
          {!showCc && <button className="compose-cc-toggle" onClick={() => setShowCc(true)}>Cc</button>}
        </div>
        {showCc && (
          <div className="compose-field">
            <label>Cc</label>
            <input value={cc} onChange={e => setCc(e.target.value)} placeholder="cc@company.com"
              spellCheck={false} autoComplete="off" />
          </div>
        )}
        <div className="compose-field">
          <label>Subject</label>
          <input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Subject" />
        </div>
      </div>

      {/* Toolbar */}
      <div className="compose-toolbar">
        {tb(editor?.isActive('bold'), () => editor?.chain().focus().toggleBold().run(), 'Bold', <Bold size={14} />)}
        {tb(editor?.isActive('italic'), () => editor?.chain().focus().toggleItalic().run(), 'Italic', <Italic size={14} />)}
        {tb(editor?.isActive('underline'), () => editor?.chain().focus().toggleUnderline().run(), 'Underline', <UnderlineIcon size={14} />)}
        <span className="compose-tb-sep" />
        {tb(editor?.isActive('bulletList'), () => editor?.chain().focus().toggleBulletList().run(), 'Bullet list', <List size={14} />)}
        {tb(editor?.isActive('orderedList'), () => editor?.chain().focus().toggleOrderedList().run(), 'Numbered list', <ListOrdered size={14} />)}
        {tb(editor?.isActive('link'), () => {
          const prev = editor?.getAttributes('link')?.href || ''
          const url = window.prompt('Link URL', prev)
          if (url === null) return
          if (url === '') editor?.chain().focus().extendMarkRange('link').unsetLink().run()
          else editor?.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
        }, 'Link', <Link2 size={14} />)}
        <span className="compose-tb-sep" />
        {tb(false, () => editor?.chain().focus().undo().run(), 'Undo', <Undo2 size={14} />)}
        {tb(false, () => editor?.chain().focus().redo().run(), 'Redo', <Redo2 size={14} />)}
        <span style={{ flex: 1 }} />
        {tb(false, () => fileRef.current?.click(), 'Attach files', <Paperclip size={14} />)}
        <input ref={fileRef} type="file" multiple accept={ACCEPT} hidden onChange={onPickFiles} />
      </div>

      {/* Editor */}
      <div className="compose-editor">
        <EditorContent editor={editor} />
      </div>

      {/* Attachment chips */}
      {attachments.length > 0 && (
        <div className="compose-attachments">
          {attachments.map((a, i) => {
            const Icon = fileIconFor(a.type)
            return (
              <span key={i} className="attach-pill">
                <Icon size={12} />
                <span className="attach-name">{a.name}</span>
                <span className="attach-size">{formatSize(a.size)}</span>
                <button title="Remove" onClick={() => removeAttachment(i)}><X size={11} /></button>
              </span>
            )
          })}
        </div>
      )}

      {/* Bottom bar */}
      <div className="compose-foot">
        <button className="btn primary" disabled={sending} onClick={onSend}>
          {sending ? <><Loader2 size={13} className="spin" />Sending…</> : <><Send size={13} />Send</>}
        </button>
        {attachments.length > 0 && (
          <span className="compose-attach-count"><Paperclip size={11} />{attachments.length} file{attachments.length === 1 ? '' : 's'}</span>
        )}
        <span style={{ flex: 1 }} />
        <button className="btn ghost tiny" disabled={sending} onClick={handleClose}>Discard</button>
      </div>

      {/* Save-as-draft confirm on close */}
      {confirmClose && (
        <div className="compose-confirm">
          <div className="compose-confirm-card">
            <div className="compose-confirm-msg">Save this email as a draft?</div>
            <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
              <button className="btn ghost tiny" onClick={() => setConfirmClose(false)}>Cancel</button>
              <button className="btn ghost tiny" onClick={() => { setConfirmClose(false); onClose?.() }}>Discard</button>
              <button className="btn primary tiny" onClick={saveDraftAndClose}>Save draft</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
