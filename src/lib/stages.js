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
];

export const STAGE_LABEL = {
  new: 'New', applied: 'Applied', screen: 'Screen', iv: 'Interviewing',
  final: 'Final', offer: 'Offer', accepted: 'Accepted',
  reject: 'Rejected', ghost: 'Ghosted',
};

// Stages a user advances through linearly via "Move to next stage".
export const STAGE_ORDER = ['new', 'applied', 'screen', 'iv', 'final', 'offer', 'accepted'];

export const SOURCES = [
  { k: 'referral',          n: 'Referral' },
  { k: 'applied_direct',    n: 'Direct apply' },
  { k: 'recruiter_outbound',n: 'Recruiter outbound' },
  { k: 'job_board',         n: 'Job board' },
  { k: 'network',           n: 'Network' },
];

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
