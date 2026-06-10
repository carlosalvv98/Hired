import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useUI } from '../hooks/useUI'
import { useLimit } from '../hooks/useLimit'
import { guardLimit } from '../lib/limitGuard'
import { confirmToast } from '../lib/confirmToast'
import { X, Link as LinkIcon, ArrowRight, Sparkles, FileText, GripVertical, Plus, Trash2, ChevronDown, Bold, Italic, Underline, List, ListOrdered, Archive, ArchiveRestore, Upload, Loader2, Pencil } from 'lucide-react'
import Logo from './Logo'
import OutboundDraft from './OutboundDraft'
import { domainFromUrl } from '../lib/logos'
import StatusPill from './StatusPill'
import { STAGES, STAGE_LABEL, STAGE_ORDER } from '../lib/stages'
import { relTime, shortDate } from '../lib/time'
import {
  getApplication, listEvents, listSteps, upsertSteps, setStepStatus,
  setStage, listEmailsForApp, listAppContacts, updateApplication,
  addStep as apiAddStep, deleteStep as apiDeleteStep, reorderSteps,
  listResumes, deleteApplication, createResume, uploadResumeFile,
  findOrCreateCompany,
} from '../lib/api'
import { useAuth } from '../hooks/useAuth'
import { parseResumeFromFile } from '../lib/agents/resumeImporter'
import { trackUsage } from '../lib/ai'
import toast from 'react-hot-toast'

const TABS = [
  { k: 'overview', n: 'Overview' },
  { k: 'timeline', n: 'Timeline' },
  { k: 'emails',   n: 'Emails' },
  { k: 'contacts', n: 'Contacts' },
  { k: 'notes',    n: 'Notes' },
  { k: 'prep',     n: 'Prep me', accent: true },
]

// Step titles that suggest progress to a specific stage. Lower-cased lookups.
const STEP_TO_STAGE = [
  { match: /^recruiter/i,                 stage: 'screen' },
  { match: /^(phone )?screen/i,           stage: 'screen' },
  { match: /^(interview|technical|case|onsite|hiring manager)/i, stage: 'iv' },
  { match: /^final/i,                     stage: 'final' },
  { match: /^offer/i,                     stage: 'offer' },
]

// Common steps the user can one-click append (de-duplicated against current list).
const SUGGESTED_STEPS = ['Technical Interview', 'Case Study', 'Onsite', 'Hiring Manager', 'Team Match']

export default function Drawer({ id, onClose }) {
  const nav = useNavigate()
  const { openUpgrade } = useUI()
  const { allowed: prepAllowed } = useLimit('interview_prep')
  const { allowed: tailorAllowed } = useLimit('resume_tailoring')
  const [app, setApp] = useState(null)
  const [tab, setTab] = useState('overview')
  const [events, setEvents] = useState([])
  const [steps, setSteps] = useState([])
  const [emails, setEmails] = useState([])
  const [contacts, setContacts] = useState([])
  const [notes, setNotes] = useState('')
  const [savingNotes, setSavingNotes] = useState(false)
  const [newStepTitle, setNewStepTitle] = useState('')
  const [resumePicker, setResumePicker] = useState(false)
  const [stageMenuOpen, setStageMenuOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  // Inline outbound-email drafter. Holds the chosen draftType (or null when
  // closed); recipient is resolved from the application's contacts at render.
  const [draft, setDraft] = useState(null)
  // Must live above the early-return below — React's rules of hooks require
  // every hook to be called on every render path.
  const dragIndex = useRef(null)

  const load = async () => {
    try {
      const a = await getApplication(id)
      setApp(a)
      setNotes(a.notes_md || '')
      const [ev, st, em, co] = await Promise.all([
        listEvents(id), listSteps(id), listEmailsForApp(id), listAppContacts(id),
      ])
      setEvents(ev); setSteps(st); setEmails(em); setContacts(co)
    } catch (e) {
      toast.error('Could not load application')
      onClose()
    }
  }

  useEffect(() => { setDraft(null); load() }, [id])

  if (!app) {
    return (
      <>
        <div className="drawer-scrim" onClick={onClose} />
        <div className="drawer">
          <div className="drawer-head">
            <div className="skel" style={{ height: 80 }} />
          </div>
        </div>
      </>
    )
  }

  const advance = async () => {
    const idx = STAGE_ORDER.indexOf(app.stage)
    if (idx === -1 || idx === STAGE_ORDER.length - 1) return
    const next = STAGE_ORDER[idx + 1]
    try {
      const updated = await setStage(app.id, next)
      setApp(prev => ({ ...prev, ...updated }))
      toast.success(`Moved to ${STAGE_LABEL[next]}`)
      const ev = await listEvents(id)
      setEvents(ev)
    } catch (e) { toast.error('Could not update stage') }
  }

  const onChangeStage = async (newStage) => {
    try {
      const updated = await setStage(app.id, newStage)
      let finalApp = { ...app, ...updated }
      // Stamp applied_at the first time a row moves past "new" so the
      // Applied column on the tracker fills in automatically.
      const shouldStamp = !app.applied_at
        && !['new', 'reject', 'ghost', 'closed'].includes(newStage)
      if (shouldStamp) {
        const stamped = await updateApplication(app.id, { applied_at: new Date().toISOString() })
        finalApp = { ...finalApp, ...stamped }
      }
      // Terminal stages (Rejected / Closed) auto-archive — there's nothing
      // left to track. Close the drawer since the row leaves the tracker.
      if (['reject', 'closed'].includes(newStage) && !app.archived) {
        await updateApplication(app.id, { archived: true, archived_at: new Date().toISOString() })
        toast.success(`Archived — moved to ${STAGE_LABEL[newStage]}`)
        onClose()
        return
      }
      setApp(finalApp)
      toast.success(`Status: ${STAGE_LABEL[newStage]}`)
      const ev = await listEvents(id)
      setEvents(ev)
    } catch { toast.error('Could not update stage') }
  }

  const onCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.origin + `/?app=${app.id}`)
      toast.success('Link copied')
    } catch { toast.error('Copy failed') }
  }

  // Toggle a step's done/pending state and, when transitioning to done,
  // auto-advance the application stage if the step title implies a later stage.
  const toggleStep = async (step) => {
    const ns = step.status === 'done' ? 'pending' : 'done'
    try {
      await setStepStatus(step.id, ns)
      const nextSteps = steps.map(s => s.id === step.id ? { ...s, status: ns } : s)
      setSteps(nextSteps)
      if (ns === 'done') {
        const inferred = inferStageFromSteps(nextSteps, app.stage)
        if (inferred && inferred !== app.stage) {
          const updated = await setStage(app.id, inferred)
          setApp(prev => ({ ...prev, ...updated }))
          const ev = await listEvents(id)
          setEvents(ev)
        }
      }
    } catch {
      toast.error('Could not update step')
      // Roll back the optimistic UI on failure.
      load()
    }
  }

  const onAddStep = async () => {
    const title = newStepTitle.trim()
    if (!title) return
    try {
      const created = await apiAddStep(app.id, title)
      setSteps(prev => [...prev, created])
      setNewStepTitle('')
    } catch { toast.error('Could not add step') }
  }

  const onAddSuggested = async (title) => {
    try {
      const created = await apiAddStep(app.id, title)
      setSteps(prev => [...prev, created])
    } catch { toast.error('Could not add step') }
  }

  const onDeleteStep = async (stepId) => {
    try {
      await apiDeleteStep(stepId)
      setSteps(prev => prev.filter(s => s.id !== stepId))
    } catch { toast.error('Could not remove step') }
  }

  // Drag-to-reorder steps. We mutate locally first and persist on drop end.
  const onDragStart = (idx) => (e) => {
    dragIndex.current = idx
    e.dataTransfer.effectAllowed = 'move'
  }
  const onDragOver = (idx) => (e) => {
    e.preventDefault()
    const from = dragIndex.current
    if (from == null || from === idx) return
    setSteps(prev => {
      const next = [...prev]
      const [moved] = next.splice(from, 1)
      next.splice(idx, 0, moved)
      dragIndex.current = idx
      return next
    })
  }
  const onDragEnd = async () => {
    dragIndex.current = null
    try { await reorderSteps(app.id, steps.map(s => s.id)) }
    catch { toast.error('Could not save order'); load() }
  }

  // Save the rich-text HTML into `notes_md`. We reuse the existing column
  // (no migration) — the editor knows to render the value as HTML when it
  // starts with a tag and as plain text otherwise (covers legacy plain notes).
  const saveNotesHtml = async (html) => {
    if (savingNotes) return
    setSavingNotes(true)
    try {
      await updateApplication(app.id, { notes_md: html })
      toast.success('Notes saved')
    } catch { toast.error('Save failed') }
    finally { setSavingNotes(false) }
  }

  const onDelete = async () => {
    const ok = await confirmToast(`Delete "${app.role_title}"? This can't be undone.`,
      { confirmLabel: 'Delete', tone: 'danger' })
    if (!ok) return
    try {
      await deleteApplication(app.id)
      toast.success('Application deleted')
      onClose()
    } catch { toast.error('Could not delete') }
  }

  // Persist edits made in the EditJobModal. Company is a separate entity, so
  // when its name changes we resolve (or create) the company row and repoint
  // company_id; everything else writes straight onto the application.
  const onSaveEdit = async (form) => {
    try {
      let company_id = app.company_id
      const newName = (form.company || '').trim()
      if (newName && newName !== (app.company?.name || '')) {
        const co = await findOrCreateCompany(newName)
        company_id = co?.id || null
      }
      const num = (v) => (v == null || v === '' ? null : Number(v))
      await updateApplication(app.id, {
        company_id,
        role_title: form.role_title?.trim() || 'Untitled role',
        location_text: form.location_text?.trim() || null,
        mode: form.mode || null,
        salary_min: num(form.salary_min),
        salary_max: num(form.salary_max),
        salary_type: form.salary_type || null,
        ote_min: num(form.ote_min),
        ote_max: num(form.ote_max),
        equity_text: form.equity_text?.trim() || null,
        source: form.source || null,
      })
      setEditing(false)
      toast.success('Changes saved')
      // Reload so the joined company name and all facts refresh.
      load()
    } catch (e) {
      toast.error(e.message || 'Could not save changes')
    }
  }

  const onToggleArchive = async () => {
    const nextArchived = !app.archived
    try {
      const updated = await updateApplication(app.id, {
        archived: nextArchived,
        archived_at: nextArchived ? new Date().toISOString() : null,
      })
      setApp(prev => ({ ...prev, ...updated }))
      toast.success(nextArchived ? 'Archived' : 'Unarchived')
      // Close so the tracker (which is currently filtering by !archived)
      // refreshes without showing the now-hidden row.
      if (nextArchived) onClose()
    } catch { toast.error('Could not update') }
  }

  const onPickResume = async (resumeId) => {
    try {
      const updated = await updateApplication(app.id, { resume_id: resumeId })
      setApp(prev => ({ ...prev, ...updated, resume: { id: resumeId } }))
      setResumePicker(false)
      toast.success('Resume attached')
      load()
    } catch { toast.error('Could not attach resume') }
  }

  const hasJD = app.jd_text || app.jd_url

  // Recipient prefill for the drafter: first linked contact that has an email.
  const draftContact = contacts.find(c => c.contact?.email)?.contact || contacts[0]?.contact || null

  // Open the inline drafter on the Emails tab with a given purpose.
  const openDraft = (type) => { setDraft({ type }); setTab('emails') }

  // Contextual quick-actions driven by the application's state.
  const daysSinceActivity = app.last_activity_at
    ? (Date.now() - new Date(app.last_activity_at).getTime()) / 86_400_000
    : 0
  const suggestThankYou = ['iv', 'final'].includes(app.stage)
  const suggestFollowUp = ['applied', 'screen'].includes(app.stage) && daysSinceActivity > 14

  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <div className="drawer" role="dialog" aria-modal="true">
        <div className="drawer-head">
          <div className="row" style={{ marginBottom: 14 }}>
            <button className="btn ghost icon" onClick={onClose} title="Close"><X size={14} /></button>
            <span className="mono muted" style={{ fontSize: 10.5 }}>
              APP-{app.id.slice(0, 6).toUpperCase()}
            </span>
            <span style={{ flex: 1 }} />
            <button className="btn ghost tiny" onClick={onCopyLink}>
              <LinkIcon size={13} />Copy link
            </button>
            <button className="btn ghost tiny" onClick={() => setEditing(true)} title="Edit job details">
              <Pencil size={13} />Edit
            </button>
            <button className="btn ghost tiny" onClick={onToggleArchive}
              title={app.archived ? 'Unarchive — put back on tracker' : 'Archive — hide from tracker, keep data'}>
              {app.archived ? <><ArchiveRestore size={13} />Unarchive</> : <><Archive size={13} />Archive</>}
            </button>
            <button className="btn ghost tiny" onClick={onDelete} style={{ color: 'var(--bad)' }} title="Delete application">
              <Trash2 size={13} />Delete
            </button>
          </div>
          <div className="row" style={{ gap: 14, alignItems: 'center' }}>
            <Logo co={app.company?.name} domain={app.company?.domain || domainFromUrl(app.jd_url)} size={64} />
            <div style={{ flex: 1, minWidth: 0 }}>
              {/* Company leads as the headline identity, with location + salary
                  as supporting detail, then the role title. */}
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>
                {app.company?.name || '—'}
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 2 }}>
                {app.location_text || '—'}
                {formatMoney(app.salary_min, app.salary_max, app.salary_currency) !== '—' && (
                  <> · <span className="mono">{formatMoney(app.salary_min, app.salary_max, app.salary_currency)}</span></>
                )}
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.018em', marginTop: 5 }}>{app.role_title}</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 16, alignItems: 'center' }}>
            <button className="btn primary tiny" onClick={advance} disabled={['accepted', 'reject', 'ghost'].includes(app.stage) || STAGE_ORDER.indexOf(app.stage) === STAGE_ORDER.length - 1}>
              <ArrowRight size={12} />Move to next stage
            </button>
            <button className="btn ai tiny" onClick={() => {
              if (!guardLimit({ allowed: prepAllowed, feature: 'interview_prep', openUpgrade })) return
              // Real prep-guide generation lands in a follow-up — for now
              // the guard wires the gate without spending a Claude call.
              toast('Generating prep guide…')
            }}>
              <Sparkles size={13} />Prep me
            </button>
            {/* Status dropdown lives on the right end of the action row so
                its position is identical for every job, regardless of how
                long the role title runs. */}
            <span style={{ flex: 1 }} />
            <StageDropdown
              stage={app.stage}
              open={stageMenuOpen}
              onToggle={() => setStageMenuOpen(v => !v)}
              onClose={() => setStageMenuOpen(false)}
              onPick={(k) => { setStageMenuOpen(false); onChangeStage(k) }}
              align="right"
            />
          </div>
        </div>

        <div className="drawer-tabs">
          {TABS.map(({ k, n, accent }) => (
            <button key={k} className={`${tab === k ? 'on' : ''} ${accent ? 'tab-accent' : ''}`} onClick={() => setTab(k)}>
              {n}{k === 'emails' && emails.length ? ` · ${emails.length}` : ''}
              {k === 'contacts' && contacts.length ? ` · ${contacts.length}` : ''}
            </button>
          ))}
        </div>

        <div className="drawer-body">
          {tab === 'overview' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              {(suggestThankYou || suggestFollowUp) && (
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  {suggestThankYou && (
                    <button className="btn ai tiny" onClick={() => openDraft('thank_you')}>
                      <Sparkles size={12} />Send Thank You
                    </button>
                  )}
                  {suggestFollowUp && (
                    <button className="btn ai tiny" onClick={() => openDraft('follow_up')}>
                      <Sparkles size={12} />Send Follow-Up
                    </button>
                  )}
                </div>
              )}
              <div>
                <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
                  <div className="eyebrow">Resume</div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn ghost tiny" onClick={() => setResumePicker(true)}>
                      <FileText size={12} />{app.resume?.id ? 'Change' : 'Attach'}
                    </button>
                    <button className="btn ai tiny" onClick={() => {
                      if (!guardLimit({ allowed: tailorAllowed, feature: 'resume_tailoring', openUpgrade })) return
                      toast('Resume tailoring is coming online — your quota check passed.')
                    }}>
                      <Sparkles size={12} />Tailor Resume to JD with AI
                    </button>
                  </div>
                </div>
                <div style={{ fontSize: 12.5, color: app.resume?.name ? 'var(--ink-2)' : 'var(--ink-3)' }}>
                  {app.resume?.name ? `${app.resume.name}${app.resume.version ? ` · ${app.resume.version}` : ''}` : 'No resume attached.'}
                </div>
              </div>

              {hasJD && (
                <div>
                  <div className="eyebrow" style={{ marginBottom: 6 }}>Job description</div>
                  {app.jd_text && (
                    <div style={{ fontSize: 12.5, lineHeight: 1.6, color: 'var(--ink-2)', whiteSpace: 'pre-line', marginBottom: 8 }}>
                      {app.jd_text}
                    </div>
                  )}
                  {app.jd_url && (
                    <a className="src-link" href={app.jd_url} target="_blank" rel="noreferrer" style={{ fontSize: 11.5 }}>
                      ↗ View job on external site
                    </a>
                  )}
                </div>
              )}

              <div>
                <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
                  <div className="eyebrow">Interview steps</div>
                  <div className="mono muted" style={{ fontSize: 10.5 }}>
                    {steps.filter(s => s.status === 'done').length}/{steps.length}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {steps.map((s, i) => (
                    <div key={s.id} className="card step-row"
                      draggable
                      onDragStart={onDragStart(i)}
                      onDragOver={onDragOver(i)}
                      onDragEnd={onDragEnd}
                      style={{ padding: 10, display: 'flex', alignItems: 'center', gap: 10, cursor: 'grab' }}>
                      <span className="step-grip" style={{ color: 'var(--ink-3)', flexShrink: 0, display: 'flex' }}>
                        <GripVertical size={13} />
                      </span>
                      <button onClick={() => toggleStep(s)} style={{
                        width: 18, height: 18, borderRadius: 4,
                        border: s.status === 'done' ? 'none' : '1.5px solid var(--line-2)',
                        background: s.status === 'done' ? 'var(--accent)' : '#fff',
                        color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 11, flexShrink: 0,
                      }}>
                        {s.status === 'done' && '✓'}
                      </button>
                      <span style={{ flex: 1, fontSize: 13, textDecoration: s.status === 'done' ? 'line-through' : 'none', color: s.status === 'done' ? 'var(--ink-3)' : 'var(--ink)' }}>
                        {s.title}
                      </span>
                      <button className="btn ghost icon step-del" title="Remove step" onClick={() => onDeleteStep(s.id)}
                        style={{ opacity: 0.6 }}>
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}

                  <form
                    onSubmit={e => { e.preventDefault(); onAddStep() }}
                    style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}>
                    <input
                      value={newStepTitle}
                      onChange={e => setNewStepTitle(e.target.value)}
                      placeholder="Add a step (e.g. Technical Interview)"
                      style={{
                        flex: 1, fontSize: 12.5, padding: '8px 10px',
                        border: '1px solid var(--line)', borderRadius: 7,
                        outline: 'none', background: '#fff',
                      }}
                    />
                    <button type="submit" className="btn ghost tiny" disabled={!newStepTitle.trim()}>
                      <Plus size={12} />Add
                    </button>
                  </form>

                  {SUGGESTED_STEPS.filter(t => !steps.some(s => s.title.toLowerCase() === t.toLowerCase())).length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                      <span className="muted" style={{ fontSize: 10.5, alignSelf: 'center' }}>Quick add:</span>
                      {SUGGESTED_STEPS
                        .filter(t => !steps.some(s => s.title.toLowerCase() === t.toLowerCase()))
                        .map(t => (
                          <button key={t} className="chip" onClick={() => onAddSuggested(t)}
                            style={{ fontSize: 11, padding: '3px 8px' }}>
                            + {t}
                          </button>
                        ))}
                    </div>
                  )}
                </div>
              </div>

              <div>
                <div className="eyebrow" style={{ marginBottom: 10 }}>Details</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <Fact label="Location" value={app.location_text || '—'} />
                  <Fact label="Workplace" value={app.mode ? cap(app.mode) : '—'} />
                  <Fact
                    label={app.salary_type === 'ote' ? 'OTE' : 'Base salary'}
                    value={formatMoney(app.salary_min, app.salary_max, app.salary_currency)}
                    mono
                  />
                  <Fact label="Date Added" value={shortDate(app.created_at)} mono />
                  {app.applied_at && <Fact label="Applied" value={shortDate(app.applied_at)} mono />}
                  {(app.ote_min || app.ote_max) && (
                    <Fact label="OTE" value={formatMoney(app.ote_min, app.ote_max, app.salary_currency)} mono />
                  )}
                  {app.equity_text && <Fact label="Equity" value={app.equity_text} />}
                  <Fact label="Source" value={app.source ? cap(app.source.replace('_', ' ')) : '—'} />
                  <Fact label="Last activity" value={relTime(app.last_activity_at)} />
                </div>
              </div>
            </div>
          )}

          {tab === 'timeline' && (
            <div style={{ position: 'relative' }}>
              <div style={{ position: 'absolute', left: 6, top: 18, bottom: 18, width: 1, background: 'var(--line)' }} />
              {events.length === 0 && <div className="muted" style={{ fontSize: 12 }}>No activity yet.</div>}
              {events.map(ev => (
                <div key={ev.id} style={{ display: 'grid', gridTemplateColumns: '14px 90px 1fr', gap: 12, padding: '10px 0', alignItems: 'flex-start', position: 'relative', zIndex: 1 }}>
                  <div style={{
                    width: 13, height: 13, borderRadius: '50%',
                    background: ev.actor === 'ai' ? 'linear-gradient(135deg, var(--accent), #a78bfa)' : '#fff',
                    border: '2px solid var(--ink)', marginTop: 3,
                  }} />
                  <div className="mono muted" style={{ fontSize: 10.5, paddingTop: 3 }}>{relTime(ev.at)}</div>
                  <div style={{ fontSize: 13 }}>
                    {renderEvent(ev)}
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === 'emails' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {draft ? (
                <OutboundDraft
                  application={app}
                  draftType={draft.type}
                  recipientEmail={draftContact?.email || ''}
                  recipientName={draftContact?.name || ''}
                  onClose={() => setDraft(null)}
                />
              ) : (
                <button className="btn ai tiny" style={{ alignSelf: 'flex-start' }}
                  onClick={() => openDraft('custom')}>
                  <Sparkles size={12} />✍️ Draft an email
                </button>
              )}
              {emails.length === 0 && <div className="muted" style={{ fontSize: 12 }}>No emails linked yet.</div>}
              {emails.map(e => (
                <div key={e.id} className="card card-pad" style={{ padding: 14 }}>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600 }}>{e.from_name || e.from_email}</span>
                    <span className="mono muted" style={{ fontSize: 10.5 }}>{relTime(e.received_at)}</span>
                  </div>
                  <div style={{ fontSize: 12.5, marginTop: 4 }}>{e.subject}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 4, lineHeight: 1.5 }}>
                    {(e.snippet || e.body_text || '').slice(0, 160)}…
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === 'contacts' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {contacts.length === 0 && <div className="muted" style={{ fontSize: 12 }}>No contacts linked yet.</div>}
              {contacts.map((c, i) => {
                const ct = c.contact
                if (!ct) return null
                const initials = (ct.name || '?').split(' ').map(s => s[0]).join('').slice(0, 2)
                return (
                  <div key={c.contact_id} className="card card-pad" style={{ padding: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div className={`av-grad-${i % 6}`} style={{
                      width: 36, height: 36, borderRadius: '50%', color: '#fff',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontWeight: 700, fontSize: 12,
                    }}>{initials}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 12.5 }}>{ct.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                        {ct.role || 'Contact'}{ct.company?.name ? ` · ${ct.company.name}` : ''}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {tab === 'notes' && (
            <RichNotes
              initialHtml={notes}
              saving={savingNotes}
              onSave={(html) => { setNotes(html); return saveNotesHtml(html) }}
            />
          )}

          {tab === 'prep' && (
            <div className="prep-placeholder">
              <div className="prep-head">
                <div className="upgrade-spark"><Sparkles size={14} /></div>
                <div style={{ flex: 1 }}>
                  <h3 style={{ margin: 0, fontSize: 15 }}>AI interview prep</h3>
                  <p style={{ margin: '2px 0 0', fontSize: 12.5, color: 'var(--ink-2)' }}>
                    Tailored study guide based on this role's JD, your resume, and
                    the company.
                  </p>
                </div>
                <span className="tag indigo">Coming soon</span>
              </div>
              <div className="prep-cards">
                <div className="prep-card">
                  <div className="prep-card-h">Likely questions</div>
                  <div className="prep-card-b">
                    A ranked list of behavioral + technical questions this role
                    tends to ask, based on past candidates and the posted JD.
                  </div>
                </div>
                <div className="prep-card">
                  <div className="prep-card-h">Talking points</div>
                  <div className="prep-card-b">
                    The 3–5 strongest stories from your resume to lead with, each
                    framed for this specific job description.
                  </div>
                </div>
                <div className="prep-card">
                  <div className="prep-card-h">Company brief</div>
                  <div className="prep-card-b">
                    Recent funding, leadership, product launches, and culture signals
                    so you walk in informed.
                  </div>
                </div>
                <div className="prep-card">
                  <div className="prep-card-h">Smart questions to ask</div>
                  <div className="prep-card-b">
                    Five role-specific questions for the interviewer that signal
                    depth without being generic.
                  </div>
                </div>
              </div>
              <button className="btn ai lg" disabled style={{ alignSelf: 'flex-start' }}>
                <Sparkles size={13} />Generate prep guide
              </button>
            </div>
          )}
        </div>
      </div>

      {resumePicker && (
        <ResumePicker
          currentId={app.resume?.id}
          onPick={onPickResume}
          onClose={() => setResumePicker(false)}
          onCreateNew={() => { setResumePicker(false); nav('/resumes') }}
        />
      )}

      {editing && (
        <EditJobModal
          app={app}
          onSave={onSaveEdit}
          onClose={() => setEditing(false)}
        />
      )}
    </>
  )
}

// Edit the core job fields after a row already exists. Mirrors the manual
// entry form in AddJobModal, pre-filled from the current application. Stage
// isn't here — that's owned by the StageDropdown in the drawer header.
function EditJobModal({ app, onSave, onClose }) {
  const [busy, setBusy] = useState(false)
  const [f, setF] = useState({
    company: app.company?.name || '',
    role_title: app.role_title || '',
    location_text: app.location_text || '',
    mode: app.mode || '',
    salary_min: app.salary_min ?? null,
    salary_max: app.salary_max ?? null,
    salary_type: app.salary_type || 'base',
    ote_min: app.ote_min ?? null,
    ote_max: app.ote_max ?? null,
    equity_text: app.equity_text || '',
    source: app.source || '',
  })

  const save = async () => {
    setBusy(true)
    try { await onSave(f) }
    finally { setBusy(false) }
  }

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ width: 540 }}>
        <div className="modal-head">
          <h3>Edit job</h3>
          <button className="btn ghost icon" onClick={onClose}><X size={14} /></button>
        </div>
        <div className="modal-body">
          <EditField label="Company" value={f.company} onChange={v => setF({ ...f, company: v })} placeholder="Anthropic" />
          <EditField label="Role title" value={f.role_title} onChange={v => setF({ ...f, role_title: v })} placeholder="Software Engineer" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <EditField label="Location" value={f.location_text} onChange={v => setF({ ...f, location_text: v })} placeholder="New York, NY" />
            <EditSelect label="Workplace" value={f.mode} onChange={v => setF({ ...f, mode: v })}
              options={[['', 'Choose workplace…'], ['remote', 'Remote'], ['hybrid', 'Hybrid'], ['onsite', 'Onsite']]} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            <EditMoney label="Base salary min" value={f.salary_min} onChange={v => setF({ ...f, salary_min: v })} />
            <EditMoney label="Base salary max" value={f.salary_max} onChange={v => setF({ ...f, salary_max: v })} />
            <EditSelect label="Type" value={f.salary_type || 'base'} onChange={v => setF({ ...f, salary_type: v })}
              options={[['base', 'Base'], ['ote', 'OTE'], ['base+ote', 'Base + OTE']]} />
          </div>
          {(f.salary_type === 'ote' || f.salary_type === 'base+ote') && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <EditMoney label="OTE min" value={f.ote_min} onChange={v => setF({ ...f, ote_min: v })} />
              <EditMoney label="OTE max" value={f.ote_max} onChange={v => setF({ ...f, ote_max: v })} />
            </div>
          )}
          <EditField label="Equity" value={f.equity_text} onChange={v => setF({ ...f, equity_text: v })} placeholder="e.g. 0.1% equity or $50k RSUs" />
          <EditSelect label="Source" value={f.source} onChange={v => setF({ ...f, source: v })}
            options={[['', '—'], ['referral', 'Referral'], ['applied_direct', 'Direct apply'], ['recruiter_outbound', 'Recruiter outbound'], ['job_board', 'Job board'], ['network', 'Network']]} />
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 6 }}>
            <button className="btn ghost" onClick={onClose}>Cancel</button>
            <button className="btn indigo" disabled={busy || !f.company.trim() || !f.role_title.trim()} onClick={save}>
              {busy ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function EditField({ label, value, onChange, placeholder }) {
  return (
    <div className="field">
      <label>{label}</label>
      <input type="text" value={value ?? ''} onChange={e => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  )
}

function EditSelect({ label, value, onChange, options }) {
  return (
    <div className="field">
      <label>{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  )
}

// Mirrors AddJobModal's MoneyField: shows "$130,000" while emitting the raw
// number (or null when empty).
function EditMoney({ label, value, onChange, placeholder = 'not listed' }) {
  const display = value == null || value === '' ? '' : `$${Number(value).toLocaleString('en-US')}`
  const handle = (s) => {
    const raw = s.replace(/[^\d.]/g, '')
    if (!raw) return onChange(null)
    const n = Number(raw)
    onChange(Number.isFinite(n) ? n : null)
  }
  return (
    <div className="field">
      <label>{label}</label>
      <input type="text" inputMode="numeric" value={display} onChange={e => handle(e.target.value)} placeholder={placeholder} />
    </div>
  )
}

// Map a checked step's title to the stage it implies, then return whichever
// of (current, implied) sits *later* in the linear stage order. We never
// move backwards via this auto-sync — only forward.
function inferStageFromSteps(steps, currentStage) {
  let furthest = currentStage
  for (const s of steps) {
    if (s.status !== 'done') continue
    for (const rule of STEP_TO_STAGE) {
      if (rule.match.test(s.title)) {
        const a = STAGE_ORDER.indexOf(furthest)
        const b = STAGE_ORDER.indexOf(rule.stage)
        if (b > a) furthest = rule.stage
      }
    }
  }
  return furthest
}

// Bordered button that pops a colored stage menu — used both in the drawer
// header and inline in each tracker row so users can always tell the status
// is editable. Pass align="right" when the button sits near the right edge
// of its container so the menu doesn't clip off-screen.
export function StageDropdown({ stage, open, onToggle, onClose, onPick, align = 'left' }) {
  const current = STAGES.find(s => s.k === stage) || STAGES[0]
  const menuPos = align === 'right'
    ? { right: 0, left: 'auto' }
    : { left: 0, right: 'auto' }
  return (
    <div style={{ position: 'relative', zIndex: open ? 60 : 'auto' }}>
      <button onClick={onToggle} className={`pill ${stage} stage-pill-btn`}>
        {current.n}
        <ChevronDown size={11} style={{ marginLeft: 4, opacity: 0.7 }} />
      </button>
      {open && (
        <>
          <div onClick={onClose}
            style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'transparent' }} />
          <div style={{
            position: 'absolute', top: 'calc(100% + 4px)', ...menuPos, zIndex: 60,
            background: '#fff', border: '1px solid var(--line)', borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)', minWidth: 160, padding: 4,
          }}>
            {STAGES.map(s => (
              <button key={s.k} className={`status-menu-item ${stage === s.k ? 'on' : ''}`}
                onClick={() => onPick(s.k)}>
                <span style={{ background: s.color, width: 6, height: 6, borderRadius: '50%', display: 'inline-block', marginRight: 8 }} />
                {s.n}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// Lightweight contenteditable rich-text editor for application notes.
// Supports bold / italic / underline / unordered + ordered lists via the
// browser's native execCommand. Legacy plain-text notes still load fine —
// we only render as HTML when the saved value clearly looks like HTML.
function RichNotes({ initialHtml, saving, onSave }) {
  const ref = useRef(null)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (!ref.current) return
    const looksLikeHtml = typeof initialHtml === 'string' && /<\w+[^>]*>/.test(initialHtml)
    ref.current.innerHTML = looksLikeHtml
      ? initialHtml
      : (initialHtml ? escapeHtml(initialHtml).replace(/\n/g, '<br>') : '')
    setDirty(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialHtml])

  const exec = (cmd, arg = null) => {
    ref.current?.focus()
    document.execCommand(cmd, false, arg)
    setDirty(true)
  }

  const handleInput = () => setDirty(true)

  const handleSave = async () => {
    const html = ref.current?.innerHTML || ''
    await onSave(html)
    setDirty(false)
  }

  return (
    <div className="card card-pad rich-notes">
      <div className="rich-notes-toolbar" onMouseDown={e => e.preventDefault()}>
        <button type="button" title="Bold (⌘B)" onClick={() => exec('bold')}><Bold size={13} /></button>
        <button type="button" title="Italic (⌘I)" onClick={() => exec('italic')}><Italic size={13} /></button>
        <button type="button" title="Underline (⌘U)" onClick={() => exec('underline')}><Underline size={13} /></button>
        <span className="rich-notes-sep" />
        <button type="button" title="Bulleted list" onClick={() => exec('insertUnorderedList')}><List size={13} /></button>
        <button type="button" title="Numbered list" onClick={() => exec('insertOrderedList')}><ListOrdered size={13} /></button>
      </div>
      <div
        ref={ref}
        className="rich-notes-body"
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        data-placeholder="Notes about this application…"
      />
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
        <button className="btn primary tiny" onClick={handleSave} disabled={saving || !dirty}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function ResumePicker({ currentId, onPick, onClose, onCreateNew }) {
  const { user } = useAuth()
  const { openUpgrade } = useUI()
  const { allowed: importAllowed, refresh: refreshImportLimit } = useLimit('resume_imports')
  const [list, setList] = useState(null)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef(null)

  useEffect(() => {
    listResumes().then(setList).catch(() => setList([]))
  }, [])

  // Upload + (for PDFs) AI-parse, then auto-attach the new resume to the
  // current application. Mirrors the import flow on the Resumes page but
  // skips the navigation step.
  const onUpload = async (file) => {
    if (!file || uploading) return
    setUploading(true)
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
    try {
      const stub = await createResume({
        name: file.name.replace(/\.(pdf|docx?|md|txt)$/i, '') || 'Imported resume',
        version: `v${(list?.length || 0) + 1}`,
        content_md: '',
        source: isPdf ? 'ai_imported' : 'upload',
        file_name: file.name,
        file_size_bytes: file.size,
        file_mime: file.type || null,
      }, user.id)

      const fileMeta = await uploadResumeFile(file, user.id, stub.id)
      // Persist file path on the resume row.
      const { updateResume } = await import('../lib/api')
      await updateResume(stub.id, { file_url: fileMeta.path, file_mime: fileMeta.mime })

      if (isPdf && guardLimit({ allowed: importAllowed, feature: 'resume_imports', openUpgrade })) {
        toast.loading('Parsing your resume with AI…', { id: 'drawer-res-import' })
        try {
          const { blocks, name: derivedName, _usage } = await parseResumeFromFile(fileMeta.path)
          await updateResume(stub.id, { content_blocks: blocks, name: derivedName || stub.name })
          if (user?.id) {
            await trackUsage(user.id, 'resume_imports', _usage.model, _usage.inputTokens, _usage.outputTokens)
            refreshImportLimit()
          }
          toast.success('Resume imported', { id: 'drawer-res-import' })
        } catch (err) {
          toast.error(err.message || 'AI parse failed', { id: 'drawer-res-import' })
        }
      } else if (!isPdf) {
        toast.success('Resume uploaded')
      }
      onPick(stub.id)
    } catch (err) {
      toast.error(err.message || 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ width: 460 }}>
        <div className="modal-head">
          <h3>Attach a resume</h3>
          <button className="btn ghost icon" onClick={onClose}><X size={14} /></button>
        </div>
        <div className="modal-body">
          {list == null ? (
            <div className="muted" style={{ fontSize: 12 }}>Loading…</div>
          ) : list.length === 0 ? (
            <div className="muted" style={{ fontSize: 12.5 }}>You don't have any resumes yet.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {list.map(r => (
                <button key={r.id} className="card card-pad"
                  onClick={() => onPick(r.id)}
                  style={{
                    padding: 12, textAlign: 'left', cursor: 'pointer',
                    borderColor: r.id === currentId ? 'var(--accent)' : undefined,
                  }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <FileText size={14} color="var(--ink-3)" />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{r.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                        {r.version || ''}{r.updated_at ? ` · updated ${relTime(r.updated_at)}` : ''}
                      </div>
                    </div>
                    {r.id === currentId && <span className="tag indigo">attached</span>}
                  </div>
                </button>
              ))}
            </div>
          )}
          <input
            ref={fileRef} type="file"
            accept=".pdf,.docx,.doc,.md,.txt"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); e.target.value = '' }}
            style={{ display: 'none' }}
          />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
            <button className="btn ghost lg" onClick={() => fileRef.current?.click()} disabled={uploading}>
              {uploading ? <Loader2 size={13} className="spin" /> : <Upload size={13} />}
              {uploading ? 'Uploading…' : 'Upload file'}
            </button>
            <button className="btn ghost lg" onClick={onCreateNew}>
              <Plus size={13} />New from scratch
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// Format a min/max money range with full numbers + commas (e.g. "$130,000–$221,000").
function formatMoney(min, max, currency = 'USD') {
  if (!min && !max) return '—'
  const sym = currency === 'USD' ? '$' : ''
  const f = (n) => sym + Number(n).toLocaleString('en-US')
  if (min && max) return `${f(min)}–${f(max)}`
  return `${f(min || max)}+`
}

const cap = s => s ? s[0].toUpperCase() + s.slice(1) : ''

function Fact({ label, value, mono }) {
  return (
    <div>
      <div className="eyebrow" style={{ fontSize: 9.5, marginBottom: 4 }}>{label}</div>
      <div className={mono ? 'mono' : ''} style={{ fontSize: 13 }}>{value}</div>
    </div>
  )
}

function renderEvent(ev) {
  const p = ev.payload_json || {}
  switch (ev.kind) {
    case 'stage_change':
      if (p.initial) return <>Application created</>
      return <>Status changed to <StatusPill s={p.to} />{ev.actor === 'ai' && <> · <span className="tag indigo">AI</span></>}</>
    case 'note':
      return p.text || 'Note added'
    case 'email':
      return <>Email · {p.subject || '—'}</>
    case 'task':
      return <>Task · {p.title || '—'}</>
    default:
      return ev.kind
  }
}
