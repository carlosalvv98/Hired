import { supabase } from './supabase'

// Companies (lazy create + lookup)
export async function findOrCreateCompany(name, domain = null) {
  if (!name) return null;
  const { data: existing } = await supabase
    .from('companies').select('*').ilike('name', name).maybeSingle();
  if (existing) return existing;
  const { data, error } = await supabase
    .from('companies').insert({ name, domain }).select().single();
  if (error) throw error;
  return data;
}

export async function listCompanies() {
  const { data, error } = await supabase.from('companies').select('*').order('name');
  if (error) throw error;
  return data || [];
}

// Applications
export async function listApplications({ stage, archived = false } = {}) {
  let q = supabase.from('applications')
    .select('*, company:companies(*), resume:resumes(id,name,version)')
    .eq('archived', archived)
    .order('last_activity_at', { ascending: false });
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
    .select('*, application:linked_application_id(id,role_title,company:companies(name))')
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

export async function updateEmail(id, patch) {
  const { data, error } = await supabase.from('emails')
    .update(patch).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function listEmailsForApp(applicationId) {
  return listEmails({ applicationId });
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
