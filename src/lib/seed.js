// Seed demo data for new accounts. Idempotent: skips if user already has applications.
import { supabase } from './supabase'

const COMPANIES = [
  { name: 'Stripe',    domain: 'stripe.com' },
  { name: 'Anthropic', domain: 'anthropic.com' },
  { name: 'Figma',     domain: 'figma.com' },
  { name: 'Notion',    domain: 'notion.so' },
  { name: 'Linear',    domain: 'linear.app' },
  { name: 'Vercel',    domain: 'vercel.com' },
  { name: 'OpenAI',    domain: 'openai.com' },
  { name: 'Datadog',   domain: 'datadoghq.com' },
  { name: 'Brex',      domain: 'brex.com' },
  { name: 'Ramp',      domain: 'ramp.com' },
]

const SAMPLE_APPS = [
  { co: 'Stripe',    role_title: 'Software Engineer L4',   stage: 'applied', loc: 'Remote',   mode: 'remote', sMin: 170000, sMax: 220000, source: 'referral',         source_detail: 'Lin Wu', applied_days_ago: 12 },
  { co: 'Anthropic', role_title: 'Forward Deployed Eng',   stage: 'screen',  loc: 'NYC',      mode: 'hybrid', sMin: 180000, sMax: 240000, source: 'applied_direct',   source_detail: 'lever.co',applied_days_ago: 10 },
  { co: 'Figma',     role_title: 'Product Designer',       stage: 'final',   loc: 'SF',       mode: 'hybrid', sMin: 160000, sMax: 200000, source: 'recruiter_outbound', source_detail: 'Maya Chen', applied_days_ago: 20 },
  { co: 'Notion',    role_title: 'Forward Deployed',       stage: 'iv',      loc: 'NYC',      mode: 'onsite', sMin: 170000, sMax: 210000, source: 'applied_direct',   source_detail: 'careers',applied_days_ago: 23 },
  { co: 'Vercel',    role_title: 'DX Engineer',            stage: 'reject',  loc: 'Remote',   mode: 'remote', sMin: 150000, sMax: 190000, source: 'job_board',        source_detail: 'LinkedIn', applied_days_ago: 28 },
  { co: 'Linear',    role_title: 'Product Engineer',       stage: 'offer',   loc: 'Remote',   mode: 'remote', sMin: 170000, sMax: 210000, source: 'applied_direct',   source_detail: 'Email',  applied_days_ago: 36 },
  { co: 'OpenAI',    role_title: 'Member of Tech Staff',   stage: 'screen',  loc: 'SF',       mode: 'onsite', sMin: 250000, sMax: 350000, source: 'recruiter_outbound', source_detail: 'Karen Chen', applied_days_ago: 18 },
  { co: 'Datadog',   role_title: 'Solutions Architect',    stage: 'applied', loc: 'NYC',      mode: 'hybrid', sMin: 165000, sMax: 205000, source: 'applied_direct',   source_detail: 'careers', applied_days_ago: 14 },
  { co: 'Brex',      role_title: 'Senior FE Engineer',     stage: 'ghost',   loc: 'SF',       mode: 'onsite', sMin: 210000, sMax: 260000, source: 'applied_direct',   source_detail: 'careers', applied_days_ago: 50 },
  { co: 'Ramp',      role_title: 'Senior FE Engineer',     stage: 'applied', loc: 'NYC',      mode: 'hybrid', sMin: 200000, sMax: 260000, source: 'referral',         source_detail: 'Jaya Park', applied_days_ago: 16 },
]

const STEP_TEMPLATES = {
  applied: ['Recruiter screen', 'Tech screen', 'Hiring manager', 'Onsite', 'Offer'],
  screen:  ['Recruiter screen', 'Tech screen', 'Hiring manager', 'Onsite', 'Offer'],
  iv:      ['Recruiter screen', 'Tech screen', 'Hiring manager', 'Onsite'],
  final:   ['Recruiter screen', 'Tech screen', 'Hiring manager', 'Onsite', 'Offer'],
  offer:   ['Recruiter screen', 'Tech screen', 'Hiring manager', 'Onsite', 'Offer'],
  reject:  ['Recruiter screen', 'Tech screen', 'Hiring manager', 'Onsite'],
  ghost:   ['Recruiter screen', 'Tech screen', 'Hiring manager', 'Onsite'],
}

const STEP_DONE_COUNT = { applied: 0, screen: 1, iv: 2, final: 4, offer: 5, reject: 1, ghost: 0 }

async function ensureCompany(name, domain) {
  const { data: existing } = await supabase.from('companies').select('id,name').ilike('name', name).maybeSingle()
  if (existing) return existing
  const { data, error } = await supabase.from('companies').insert({ name, domain }).select().single()
  if (error) throw error
  return data
}

const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString()
const daysFromNow = (n) => new Date(Date.now() + n * 86400000).toISOString()

export async function seedIfEmpty(userId) {
  // Already seeded?
  const { count, error: countErr } = await supabase
    .from('applications')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
  if (countErr) throw countErr
  if (count && count > 0) return false

  // Companies
  const companies = {}
  for (const c of COMPANIES) {
    companies[c.name] = await ensureCompany(c.name, c.domain)
  }

  // Applications + steps
  const appIdByName = {}
  for (const s of SAMPLE_APPS) {
    const co = companies[s.co]
    const { data: app } = await supabase.from('applications').insert({
      user_id: userId,
      company_id: co.id,
      role_title: s.role_title,
      location_text: s.loc,
      mode: s.mode,
      salary_min: s.sMin, salary_max: s.sMax,
      stage: s.stage,
      source: s.source,
      source_detail: s.source_detail,
      applied_at: daysAgo(s.applied_days_ago),
      last_activity_at: daysAgo(Math.floor(s.applied_days_ago / 4)),
      rating: Math.floor(Math.random() * 3) + 3,
      starred: ['offer', 'final'].includes(s.stage),
    }).select().single()
    if (!app) continue
    appIdByName[s.co] = app.id

    // Steps
    const titles = STEP_TEMPLATES[s.stage] || []
    const doneN = STEP_DONE_COUNT[s.stage] || 0
    const stepRows = titles.map((t, i) => ({
      application_id: app.id, idx: i, title: t,
      status: i < doneN ? 'done' : 'pending',
      learned_from_cohort: true,
    }))
    if (stepRows.length) await supabase.from('interview_steps').insert(stepRows)

    // Initial event
    await supabase.from('application_events').insert({
      application_id: app.id, kind: 'stage_change', actor: 'user',
      payload_json: { to: s.stage, initial: true }, at: daysAgo(s.applied_days_ago),
    })
  }

  // Contacts
  const contacts = [
    { name: 'Lin Wu',      email: 'lin@anthropic.com',    role: 'recruiter',       co: 'Anthropic', last: 1 },
    { name: 'Maya Chen',   email: 'maya@figma.com',       role: 'recruiter',       co: 'Figma',     last: 2 },
    { name: 'Daniel Chen', email: 'daniel@anthropic.com', role: 'interviewer',     co: 'Anthropic', last: 4 },
    { name: 'Jaya Park',   email: 'jaya@ramp.com',        role: 'referrer',        co: 'Ramp',      last: 14 },
    { name: 'Karen Chen',  email: 'karen@openai.com',     role: 'recruiter',       co: 'OpenAI',    last: 1 },
  ]
  const contactIds = {}
  for (const c of contacts) {
    const { data: ct } = await supabase.from('contacts').insert({
      user_id: userId, name: c.name, email: c.email, role: c.role,
      company_id: companies[c.co]?.id || null,
      last_contacted_at: daysAgo(c.last),
    }).select().single()
    if (ct) contactIds[c.name] = ct.id
  }

  // Link a contact or two to applications
  if (contactIds['Lin Wu'] && appIdByName['Anthropic']) {
    await supabase.from('application_contacts').insert({
      application_id: appIdByName['Anthropic'], contact_id: contactIds['Lin Wu'], role_in_loop: 'recruiter',
    })
  }
  if (contactIds['Daniel Chen'] && appIdByName['Anthropic']) {
    await supabase.from('application_contacts').insert({
      application_id: appIdByName['Anthropic'], contact_id: contactIds['Daniel Chen'], role_in_loop: 'panelist',
    })
  }
  if (contactIds['Maya Chen'] && appIdByName['Figma']) {
    await supabase.from('application_contacts').insert({
      application_id: appIdByName['Figma'], contact_id: contactIds['Maya Chen'], role_in_loop: 'recruiter',
    })
  }

  // Emails (with parse_json so the parsed strip lights up)
  const emails = [
    {
      from_name: 'Lin Wu', from_email: 'lin@anthropic.com',
      subject: "Re: FDE next steps — let's schedule",
      body_text: `Hey Sam — really enjoyed our chat. Wanted to set up a 30-min technical screen with our staff engineer Daniel Chen.

  • Wed, 11:00 AM PT
  • Wed, 4:00 PM PT
  • Thu, 10:00 AM PT

Let me know which works.

— Lin`,
      snippet: 'Hey Sam — really enjoyed our chat. Wanted to set up a 30-min technical screen…',
      received_days_ago: 0.1, is_unread: true,
      linked_app: 'Anthropic',
      parse_json: { company: 'Anthropic', stage_signal: 'screen', contact: { name: 'Lin Wu', email: 'lin@anthropic.com', role: 'recruiter' } },
    },
    {
      from_name: 'Stripe Recruiting', from_email: 'jobs@stripe.com',
      subject: 'Application received — SWE L4',
      body_text: 'Thanks for applying to the Senior Software Engineer role at Stripe. We will be in touch within 5 business days.',
      snippet: 'Thanks for applying to the Senior Software Engineer role at Stripe…',
      received_days_ago: 0.2, is_unread: true,
      linked_app: 'Stripe',
      parse_json: { company: 'Stripe', stage_signal: 'applied' },
    },
    {
      from_name: 'Greenhouse · Figma', from_email: 'no-reply@greenhouse.io',
      subject: 'Final round confirmation',
      body_text: 'Your onsite is confirmed for next Monday at 9:00 AM PT. Find the agenda below…',
      snippet: 'Your onsite is confirmed for next Monday at 9:00 AM PT…',
      received_days_ago: 0.3, is_unread: true,
      linked_app: 'Figma',
      parse_json: { company: 'Figma', stage_signal: 'final' },
    },
    {
      from_name: 'Linear Recruiting', from_email: 'jobs@linear.app',
      subject: 'Offer letter attached',
      body_text: 'Sam, we are thrilled to extend an offer for the Product Engineer role at Linear. Please review the attached letter.',
      snippet: 'We are thrilled to extend an offer for the Product Engineer role at Linear…',
      received_days_ago: 3, is_unread: false,
      linked_app: 'Linear',
      parse_json: { company: 'Linear', stage_signal: 'offer', amounts: { base: 190000, equity_text: '$60k equity', currency: 'USD' } },
    },
    {
      from_name: 'Brex Recruiting', from_email: 'recruiter@brex.com',
      subject: 'Touching base',
      body_text: 'Just wanted to check in on your application from a few weeks back. Are you still interested?',
      snippet: 'Just wanted to check in on your application from a few weeks back…',
      received_days_ago: 5, is_unread: false,
      parse_json: { company: 'Brex' },
      parse_status: 'needs_review',
    },
  ]
  for (const e of emails) {
    const linkedId = e.linked_app ? appIdByName[e.linked_app] : null
    await supabase.from('emails').insert({
      user_id: userId,
      mailbox_source: 'hired_forward',
      from_name: e.from_name, from_email: e.from_email,
      subject: e.subject, body_text: e.body_text, snippet: e.snippet,
      received_at: daysAgo(e.received_days_ago),
      is_unread: e.is_unread,
      linked_application_id: linkedId,
      linked_confidence: e.parse_status === 'needs_review' ? 0.62 : 0.94,
      parse_status: e.parse_status || 'parsed',
      parse_json: e.parse_json,
      folder: 'inbox',
    })
  }

  // Calendar events (tied to apps)
  const events = [
    { app: 'Anthropic', title: 'Tech screen — Anthropic', in_days: 2, hour: 11, dur: 30 },
    { app: 'Stripe',    title: 'Phone screen — Stripe',   in_days: 3, hour: 14, dur: 30 },
    { app: 'Notion',    title: 'HM chat — Notion',        in_days: 4, hour: 15, dur: 30 },
    { app: 'Figma',     title: 'Onsite — Figma',          in_days: 7, hour: 9, dur: 240 },
  ]
  for (const ev of events) {
    const start = new Date()
    start.setDate(start.getDate() + ev.in_days)
    start.setHours(ev.hour, 0, 0, 0)
    const end = new Date(start.getTime() + ev.dur * 60000)
    await supabase.from('calendar_events').insert({
      user_id: userId,
      application_id: appIdByName[ev.app] || null,
      source: 'manual',
      title: ev.title,
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
    })
  }

  // Tasks
  const tasks = [
    { title: 'Prep for Anthropic tech screen', due_in_days: 1 },
    { title: 'Follow up with Lin Wu',          due_in_days: 2 },
    { title: 'Update resume — add Q3 metrics', due_in_days: 3 },
    { title: 'Thank-you note · Figma onsite',  due_in_days: 5 },
    { title: 'Decide on Linear offer',         due_in_days: 1 },
  ]
  for (const t of tasks) {
    await supabase.from('tasks').insert({
      user_id: userId,
      title: t.title,
      due_at: daysFromNow(t.due_in_days),
      done: false,
    })
  }

  // AI nudges
  const nudges = [
    { kind: 'follow_up', cta_label: 'Linear offer expires Friday', body_md: 'You have 2 days to respond. Want help drafting a counter? Avg comp data for Linear staff: $235k base, $80k equity.' },
    { kind: 'stale_app', cta_label: 'Brex hasn\'t replied in 50 days', body_md: 'You applied a while back — never heard back. Send a friendly follow-up?' },
    { kind: 'prep_reminder', cta_label: 'Anthropic screen in 2 days', body_md: 'Lin Wu replied. Pull up the prep doc and review distributed-systems fundamentals.' },
  ]
  for (const n of nudges) {
    await supabase.from('ai_nudges').insert({
      user_id: userId, kind: n.kind, body_md: n.body_md, cta_label: n.cta_label,
    })
  }

  return true
}
