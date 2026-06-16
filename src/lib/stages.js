export const STAGES = [
  { k: 'new',      n: 'New',          color: 'var(--stage-new)' },
  { k: 'applied',  n: 'Applied',      color: 'var(--stage-applied)' },
  { k: 'screen',   n: 'Screen',       color: 'var(--stage-screen)' },
  { k: 'iv',       n: 'Interviewing', color: 'var(--stage-iv)' },
  { k: 'final',    n: 'Final',        color: 'var(--stage-final)' },
  { k: 'offer',    n: 'Offer',        color: 'var(--stage-offer)' },
  { k: 'accepted', n: 'Accepted',     color: 'var(--stage-accepted)' },
  { k: 'reject',   n: 'Rejected',     color: 'var(--stage-reject)' },
  { k: 'ghost',    n: 'Ghosted',      color: 'var(--stage-ghost)' },
  { k: 'closed',   n: 'Closed',       color: 'var(--stage-closed)' },
];

export const STAGE_LABEL = {
  new: 'New', applied: 'Applied', screen: 'Screen', iv: 'Interviewing',
  final: 'Final', offer: 'Offer', accepted: 'Accepted',
  reject: 'Rejected', ghost: 'Ghosted', closed: 'Closed',
};

// Stages a user advances through linearly via "Move to next stage".
export const STAGE_ORDER = ['new', 'applied', 'screen', 'iv', 'final', 'offer', 'accepted'];

// Logical rank of each stage, matching the order they appear in the status
// dropdown. Used to sort the tracker by status in pipeline order (not
// alphabetically). Unknown stages sort to the end.
export const STAGE_RANK = STAGES.reduce((m, s, i) => { m[s.k] = i; return m; }, {});

export const SOURCES = [
  { k: 'referral',          n: 'Referral' },
  { k: 'connection',        n: 'Connection' },
  { k: 'applied_direct',    n: 'Direct apply' },
  { k: 'recruiter_outbound',n: 'Recruiter outbound' },
  { k: 'recruiter_inbound', n: 'Recruiter inbound' },
  { k: 'job_board',         n: 'Job board' },
  { k: 'network',           n: 'Network' },
];

// Sources that point at a specific person — these are where the tracker ties
// back into the Connections section (a referrer / recruiter / contact).
export const PERSON_SOURCES = new Set(['referral', 'connection', 'recruiter_outbound', 'recruiter_inbound', 'network']);

// Dropdown options for a Source <select>, including the leading "none" row.
export const SOURCE_OPTIONS = [['', '—'], ...SOURCES.map(s => [s.k, s.n])];

export const MODES = [
  { k: 'remote',  n: 'Remote' },
  { k: 'hybrid',  n: 'Hybrid' },
  { k: 'onsite',  n: 'Onsite' },
];

export const formatSalary = (min, max, currency = 'USD') => {
  if (!min && !max) return '—';
  const sym = currency === 'USD' ? '$' : '';
  const k = (n) => Math.round(n / 1000) + 'k';
  if (min && max) return `${sym}${k(min)}–${k(max)}`;
  return `${sym}${k(min || max)}+`;
};
