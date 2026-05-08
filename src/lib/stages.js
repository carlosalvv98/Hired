export const STAGES = [
  { k: 'applied', n: 'Applied',   color: 'var(--stage-applied)' },
  { k: 'screen',  n: 'Screen',    color: 'var(--stage-screen)' },
  { k: 'iv',      n: 'Interview', color: 'var(--stage-iv)' },
  { k: 'final',   n: 'Final',     color: 'var(--stage-final)' },
  { k: 'offer',   n: 'Offer',     color: 'var(--stage-offer)' },
  { k: 'reject',  n: 'Rejected',  color: 'var(--stage-reject)' },
  { k: 'ghost',   n: 'Ghosted',   color: 'var(--stage-ghost)' },
];

export const STAGE_LABEL = {
  applied: 'Applied', screen: 'Screen', iv: 'Interview',
  final: 'Final', offer: 'Offer', reject: 'Reject', ghost: 'Ghosted',
};

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
