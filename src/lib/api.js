import { supabase } from './supabase'

// Companies (lazy create + lookup)
export async function findOrCreateCompany(name, domain = null, website = null) {
  if (!name) return null;
  const { data: existing } = await supabase
    .from('companies').select('*').ilike('name', name).maybeSingle();
  if (existing) {
    // Backfill a domain/website we just learned about (domain drives logos)
    // if the row doesn't already have them. Best-effort — don't fail the
    // caller on error.
    const patch = {};
    if (domain && !existing.domain) patch.domain = domain;
    if (website && !existing.website) patch.website = website;
    if (Object.keys(patch).length) {
      const { data: updated } = await supabase
        .from('companies').update(patch).eq('id', existing.id).select().single();
      return updated || existing;
    }
    return existing;
  }
  const { data, error } = await supabase
    .from('companies').insert({ name, domain, website }).select().single();
  if (error) throw error;
  return data;
}

// Update a company row directly (e.g. editing its website/domain from the
// drawer). Unlike findOrCreateCompany's backfill, this overwrites.
export async function updateCompany(id, patch) {
  if (!id) return null;
  const { data, error } = await supabase
    .from('companies').update(patch).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function listCompanies() {
  const { data, error } = await supabase.from('companies').select('*').order('name');
  if (error) throw error;
  return data || [];
}

// Applications
// Pass `includeArchived: true` to return ALL applications (live + archived);
// otherwise the result is filtered to `archived` (default: live only).
export async function listApplications({ stage, archived = false, includeArchived = false } = {}) {
  let q = supabase.from('applications')
    .select('*, company:companies(*), resume:resumes(id,name,version)')
    .order('last_activity_at', { ascending: false });
  if (!includeArchived) q = q.eq('archived', archived);
  if (stage) q = q.eq('stage', stage);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function getApplication(id) {
  const { data, error } = await supabase
    .from('applications')
    .select('*, company:companies(*), resume:resumes(*)')
    .eq('id', id).single();
  if (error) throw error;
  return data;
}

export async function createApplication(payload, userId) {
  const { data, error } = await supabase
    .from('applications').insert({ ...payload, user_id: userId }).select().single();
  if (error) throw error;
  await logEvent(data.id, 'stage_change', 'user', { to: data.stage, initial: true });
  return data;
}

export async function updateApplication(id, patch) {
  const { data, error } = await supabase
    .from('applications')
    .update({ ...patch, last_activity_at: new Date().toISOString() })
    .eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function setStage(id, stage, actor = 'user') {
  const prev = await getApplication(id);
  if (prev.stage === stage) return prev;
  const next = await updateApplication(id, { stage });
  await logEvent(id, 'stage_change', actor, { from: prev.stage, to: stage });
  return next;
}

// Stage change WITHOUT touching last_activity_at — used by the auto-ghost /
// auto-close sweep so the idle clock keeps running (and the Undo can restore
// the exact prior state). Pass `archived` to also (un)archive. Logged as a
// 'system' actor event.
export async function autoSetStage(id, stage, archived = undefined) {
  const prev = await getApplication(id);
  const patch = { stage };
  if (archived !== undefined) {
    patch.archived = archived;
    patch.archived_at = archived ? new Date().toISOString() : null;
  }
  const { data, error } = await supabase
    .from('applications').update(patch).eq('id', id).select().single();
  if (error) throw error;
  if (prev.stage !== stage) {
    await logEvent(id, 'stage_change', 'system', { from: prev.stage, to: stage, auto: true });
  }
  return data;
}

export async function deleteApplication(id) {
  const { error } = await supabase.from('applications').delete().eq('id', id);
  if (error) throw error;
}

// Application events (timeline)
export async function logEvent(applicationId, kind, actor, payload = {}) {
  const { error } = await supabase.from('application_events')
    .insert({ application_id: applicationId, kind, actor, payload_json: payload });
  if (error) throw error;
}

export async function listEvents(applicationId) {
  const { data, error } = await supabase.from('application_events')
    .select('*').eq('application_id', applicationId)
    .order('at', { ascending: false });
  if (error) throw error;
  return data || [];
}

// All stage_change events across applications since a given ISO timestamp.
// Used by the calendar analytics chart to plot interviews/offers over time.
export async function listStageEvents(sinceISO) {
  const { data, error } = await supabase.from('application_events')
    .select('application_id, kind, payload_json, at')
    .eq('kind', 'stage_change')
    .gte('at', sinceISO)
    .order('at', { ascending: true });
  if (error) throw error;
  return data || [];
}

// Interview steps
export async function listSteps(applicationId) {
  const { data, error } = await supabase.from('interview_steps')
    .select('*').eq('application_id', applicationId)
    .order('idx');
  if (error) throw error;
  return data || [];
}

export async function upsertSteps(applicationId, steps) {
  const { error: delErr } = await supabase.from('interview_steps')
    .delete().eq('application_id', applicationId);
  if (delErr) throw delErr;
  if (!steps.length) return [];
  const rows = steps.map((s, idx) => ({
    application_id: applicationId,
    idx,
    title: s.title,
    status: s.status || 'pending',
    learned_from_cohort: !!s.learned_from_cohort,
    scheduled_at: s.scheduled_at || null,
  }));
  const { data, error } = await supabase.from('interview_steps').insert(rows).select();
  if (error) throw error;
  return data;
}

export async function setStepStatus(stepId, status) {
  const { data, error } = await supabase.from('interview_steps')
    .update({ status }).eq('id', stepId).select().single();
  if (error) throw error;
  return data;
}

// Append a single step to the end of an application's step list.
export async function addStep(applicationId, title) {
  const { data: existing, error: lErr } = await supabase.from('interview_steps')
    .select('idx').eq('application_id', applicationId).order('idx', { ascending: false }).limit(1);
  if (lErr) throw lErr;
  const nextIdx = existing && existing.length ? existing[0].idx + 1 : 0;
  const { data, error } = await supabase.from('interview_steps')
    .insert({ application_id: applicationId, idx: nextIdx, title, status: 'pending', learned_from_cohort: false })
    .select().single();
  if (error) throw error;
  return data;
}

export async function deleteStep(stepId) {
  const { error } = await supabase.from('interview_steps').delete().eq('id', stepId);
  if (error) throw error;
}

// Persist a new ordering of step ids.
export async function reorderSteps(applicationId, orderedIds) {
  for (let i = 0; i < orderedIds.length; i++) {
    const { error } = await supabase.from('interview_steps')
      .update({ idx: i }).eq('id', orderedIds[i]);
    if (error) throw error;
  }
}

// Emails
export async function listEmails({ folder = 'inbox', applicationId = null } = {}) {
  let q = supabase.from('emails')
    .select('*, application:linked_application_id(id,role_title,stage,company:companies(name))')
    .order('received_at', { ascending: false });
  if (folder === 'archive') q = q.eq('folder', 'archive');
  else if (folder === 'starred') q = q.eq('is_starred', true);
  else if (folder === 'parsed') q = q.eq('parse_status', 'parsed');
  else if (folder === 'unlinked') q = q.eq('parse_status', 'needs_review');
  else q = q.eq('folder', 'inbox');
  if (applicationId) q = q.eq('linked_application_id', applicationId);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function getEmail(id) {
  const { data, error } = await supabase.from('emails')
    .select('*, application:linked_application_id(id,role_title,stage,company:companies(name))')
    .eq('id', id).single();
  if (error) throw error;
  return data;
}

export async function updateEmail(id, patch) {
  const { data, error } = await supabase.from('emails')
    .update(patch).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

// All emails for an application — inbound AND outbound (sent) — newest first.
// Unlike listEmails() this isn't scoped to the inbox folder, so manually
// composed/sent emails show up in the drawer's email history too.
export async function listEmailsForApp(applicationId) {
  const { data, error } = await supabase.from('emails')
    .select('*, application:linked_application_id(id,role_title,stage,company:companies(name))')
    .eq('linked_application_id', applicationId)
    .order('received_at', { ascending: false, nullsFirst: false });
  if (error) throw error;
  return data || [];
}

// Log an email the user wrote/sent from the drawer. We can't send through the
// user's mailbox (compose opens their mail client via mailto), so this records
// an outbound copy so it appears in the email history/timeline.
export async function createOutboundEmail({ applicationId, to, subject, body }, userId) {
  const text = (body || '').trim();
  const { data, error } = await supabase.from('emails').insert({
    user_id: userId,
    mailbox_source: 'outbound',
    from_name: 'You',
    to_addresses: to ? [to] : null,
    subject: subject?.trim() || null,
    body_text: text || null,
    snippet: text ? text.slice(0, 200) : null,
    received_at: new Date().toISOString(),
    linked_application_id: applicationId,
    folder: 'sent',
    parse_status: 'parsed',
    is_unread: false,
  }).select().single();
  if (error) throw error;
  return data;
}

// Tasks
export async function listTasks({ done, applicationId } = {}) {
  let q = supabase.from('tasks').select('*').order('due_at', { ascending: true, nullsFirst: false });
  if (done !== undefined) q = q.eq('done', done);
  if (applicationId) q = q.eq('application_id', applicationId);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function createTask(payload, userId) {
  const { data, error } = await supabase.from('tasks')
    .insert({ ...payload, user_id: userId }).select().single();
  if (error) throw error;
  return data;
}

export async function updateTask(id, patch) {
  const { data, error } = await supabase.from('tasks').update(patch).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteTask(id) {
  const { error } = await supabase.from('tasks').delete().eq('id', id);
  if (error) throw error;
}

// Calendar
export async function listCalendar({ from, to } = {}) {
  let q = supabase.from('calendar_events')
    .select('*, application:applications(id,role_title,stage,company:companies(name))')
    .order('starts_at');
  if (from) q = q.gte('starts_at', from);
  if (to)   q = q.lte('starts_at', to);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function createCalendarEvent(payload, userId) {
  const { data, error } = await supabase.from('calendar_events')
    .insert({ ...payload, user_id: userId, source: payload.source || 'manual' })
    .select().single();
  if (error) throw error;
  return data;
}

export async function updateCalendarEvent(id, patch) {
  const { data, error } = await supabase.from('calendar_events').update(patch).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteCalendarEvent(id) {
  const { error } = await supabase.from('calendar_events').delete().eq('id', id);
  if (error) throw error;
}

// Resumes
export async function listResumes() {
  const { data, error } = await supabase.from('resumes')
    .select('*').eq('archived', false).order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function getResume(id) {
  const { data, error } = await supabase.from('resumes').select('*').eq('id', id).single();
  if (error) throw error;
  return data;
}

export async function createResume(payload, userId) {
  const { data, error } = await supabase.from('resumes')
    .insert({ ...payload, user_id: userId }).select().single();
  if (error) throw error;
  return data;
}

// Clone an existing resume so the user can iterate from a known-good
// version without overwriting the original. The new row gets a bumped
// version label and an indication of provenance.
export async function duplicateResume(id, userId) {
  const src = await getResume(id);
  const newName = `${src.name} (copy)`;
  return createResume({
    name: newName,
    version: src.version ? `${src.version}-copy` : 'copy',
    content_md: src.content_md,
    content_blocks: src.content_blocks,
    source: 'duplicate',
  }, userId);
}

// Upload a resume file to the per-user folder in the `resumes` Storage
// bucket. Path convention is `<user_id>/<resume_id>.<ext>` so the RLS
// policy on storage.objects (which inspects the first path segment) lets
// the owner — and only the owner — read it.
export async function uploadResumeFile(file, userId, resumeId) {
  if (!file) throw new Error('No file provided');
  const ext = (file.name.split('.').pop() || 'bin').toLowerCase();
  const path = `${userId}/${resumeId}.${ext}`;
  const { error } = await supabase.storage
    .from('resumes').upload(path, file, { upsert: true, contentType: file.type });
  if (error) throw error;
  return { path, ext, mime: file.type, size: file.size, name: file.name };
}

// Generate a short-lived signed URL for downloading a resume file. The
// bucket is private so direct public URLs don't work.
export async function getResumeFileSignedUrl(path, expiresInSec = 300) {
  if (!path) return null;
  const { data, error } = await supabase.storage
    .from('resumes').createSignedUrl(path, expiresInSec);
  if (error) throw error;
  return data?.signedUrl || null;
}

export async function deleteResumeFile(path) {
  if (!path) return;
  await supabase.storage.from('resumes').remove([path]);
}

// Read a file from Storage and return it as a base64 string. Used when
// we send a PDF to Claude for AI parsing — Anthropic's `document` content
// block expects base64-encoded source data.
export async function downloadResumeFileBase64(path) {
  const { data, error } = await supabase.storage.from('resumes').download(path);
  if (error) throw error;
  return await blobToBase64(data);
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      const r = fr.result;
      // result is `data:<mime>;base64,<payload>` — strip the prefix.
      const comma = typeof r === 'string' ? r.indexOf(',') : -1;
      resolve(typeof r === 'string' && comma >= 0 ? r.slice(comma + 1) : '');
    };
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

export async function updateResume(id, patch) {
  const { data, error } = await supabase.from('resumes').update(patch).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function listResumeScores(resumeId) {
  const { data, error } = await supabase.from('resume_scores')
    .select('*, application:applications(id,role_title,company:companies(name))')
    .eq('resume_id', resumeId).order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function createResumeScore(payload) {
  const { data, error } = await supabase.from('resume_scores').insert(payload).select().single();
  if (error) throw error;
  return data;
}

// Contacts
export async function listContacts() {
  const { data, error } = await supabase.from('contacts')
    .select('*, company:companies(*)').order('last_contacted_at', { ascending: false, nullsFirst: false });
  if (error) throw error;
  return data || [];
}

export async function getContact(id) {
  const { data, error } = await supabase.from('contacts')
    .select('*, company:companies(*)').eq('id', id).single();
  if (error) throw error;
  return data;
}

export async function createContact(payload, userId) {
  const { data, error } = await supabase.from('contacts')
    .insert({ ...payload, user_id: userId }).select().single();
  if (error) throw error;
  return data;
}

export async function updateContact(id, patch) {
  const { data, error } = await supabase.from('contacts').update(patch).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function listAppContacts(applicationId) {
  const { data, error } = await supabase.from('application_contacts')
    .select('*, contact:contacts(*, company:companies(*))')
    .eq('application_id', applicationId);
  if (error) throw error;
  return data || [];
}

export async function linkContact(applicationId, contactId, roleInLoop) {
  const { error } = await supabase.from('application_contacts')
    .insert({ application_id: applicationId, contact_id: contactId, role_in_loop: roleInLoop });
  if (error) throw error;
}

export async function unlinkContact(applicationId, contactId) {
  const { error } = await supabase.from('application_contacts')
    .delete().eq('application_id', applicationId).eq('contact_id', contactId);
  if (error) throw error;
}

// Nudges
export async function listNudges() {
  const { data, error } = await supabase.from('ai_nudges')
    .select('*').is('dismissed_at', null)
    .order('created_at', { ascending: false }).limit(5);
  if (error) throw error;
  return data || [];
}

export async function dismissNudge(id) {
  const { error } = await supabase.from('ai_nudges')
    .update({ dismissed_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

// All of a user's nudges (active + dismissed) — used to de-dupe generation so
// we don't re-nag about something already shown or dismissed.
export async function listAllNudges(userId, sinceISO) {
  let q = supabase.from('ai_nudges').select('id, kind, application_id, dismissed_at, created_at')
    .eq('user_id', userId);
  if (sinceISO) q = q.gte('created_at', sinceISO);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

// Insert generated nudges (best-effort; returns the created rows).
export async function createNudges(rows) {
  if (!rows?.length) return [];
  const { data, error } = await supabase.from('ai_nudges').insert(rows).select();
  if (error) throw error;
  return data || [];
}

export async function updateUser(id, patch) {
  const { data, error } = await supabase.from('users')
    .update(patch).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

// Users
export async function getUserProfile(id) {
  const { data, error } = await supabase.from('users').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

// Dashboard summary (derived)
export async function getDashboardSummary() {
  const { data: apps } = await supabase.from('applications').select('stage,applied_at,last_activity_at,archived').eq('archived', false);
  const list = apps || [];
  const counts = { new: 0, applied: 0, screen: 0, iv: 0, final: 0, offer: 0, accepted: 0, reject: 0, ghost: 0 };
  list.forEach(a => { counts[a.stage] = (counts[a.stage] || 0) + 1; });
  return { total: list.length, byStage: counts };
}
