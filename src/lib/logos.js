// Deterministic per-company colors. Lookup first, hash fallback.
const KNOWN = {
  Stripe:    ['#635bff', '#fff'],
  Anthropic: ['#cc785c', '#fff'],
  Figma:     ['#1a1a1a', '#fff'],
  Notion:    ['#ffffff', '#000'],
  Linear:    ['#5e6ad2', '#fff'],
  Vercel:    ['#000000', '#fff'],
  Airbnb:    ['#FF5A5F', '#fff'],
  Canva:     ['#00C4CC', '#fff'],
  OpenAI:    ['#10a37f', '#fff'],
  Datadog:   ['#632ca6', '#fff'],
  Supabase:  ['#3ECF8E', '#0a0a0a'],
  Plaid:     ['#000000', '#fff'],
  Ramp:      ['#FFCC2D', '#000'],
  Brex:      ['#fcd853', '#000'],
  Replit:    ['#F26207', '#fff'],
  Mercury:   ['#0F172A', '#fff'],
  Coinbase:  ['#1652f0', '#fff'],
  Discord:   ['#5865f2', '#fff'],
  Rippling:  ['#feca36', '#000'],
};

const PALETTE = [
  ['#4f46e5', '#fff'],
  ['#0f766e', '#fff'],
  ['#9333ea', '#fff'],
  ['#dc2626', '#fff'],
  ['#0891b2', '#fff'],
  ['#65a30d', '#fff'],
  ['#ea580c', '#fff'],
  ['#1f2937', '#fff'],
];

// Job-board / ATS hosts that are NOT the employer's own domain — we can't
// derive a company logo from these, so we bail and let the caller fall back.
const BOARD_HOSTS = [
  /greenhouse\.io$/, /lever\.co$/, /ashbyhq\.com$/, /myworkdayjobs\.com$/,
  /workday\.com$/, /linkedin\.com$/, /indeed\.com$/, /glassdoor\./,
  /smartrecruiters\.com$/, /icims\.com$/, /bamboohr\.com$/, /breezy\.hr$/,
  /workable\.com$/, /jobvite\.com$/, /taleo\.net$/, /paylocity\.com$/,
  /gem\.com$/, /jobs\.gem\.com$/,
];

// Sub-domain labels that don't carry brand identity (careers.acme.com → acme.com).
const STRIP_LABELS = new Set([
  'www', 'careers', 'career', 'jobs', 'job', 'apply', 'boards', 'board',
  'work', 'talent', 'hire', 'hiring', 'recruiting',
]);

// Best-effort employer domain from a job URL. Returns null for job boards or
// anything unparseable. Used as a fallback logo source for jobs that don't
// have a parsed company_domain stored.
export function domainFromUrl(url) {
  if (!url) return null;
  let host;
  try { host = new URL(url).hostname.toLowerCase(); } catch { return null; }
  if (BOARD_HOSTS.some(re => re.test(host))) return null;
  const parts = host.replace(/^www\./, '').split('.');
  while (parts.length > 2 && STRIP_LABELS.has(parts[0])) parts.shift();
  return parts.join('.') || null;
}

export function logoColors(name) {
  if (!name) return ['#1a1a1a', '#fff'];
  if (KNOWN[name]) return KNOWN[name];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xfffffff;
  return PALETTE[h % PALETTE.length];
}
