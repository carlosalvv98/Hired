import { formatDistanceToNowStrict, format, isToday, isYesterday, differenceInDays } from 'date-fns';

export const relTime = (d) => {
  if (!d) return '—';
  const date = new Date(d);
  const days = differenceInDays(new Date(), date);
  if (isToday(date)) return formatDistanceToNowStrict(date, { addSuffix: false }) + ' ago';
  if (isYesterday(date)) return 'yest';
  if (days < 7) return days + 'd ago';
  return format(date, 'MMM d');
};

export const shortDate = (d) => d ? format(new Date(d), 'MMM d') : '—';
export const isoDate = (d) => d ? format(new Date(d), 'yyyy-MM-dd') : '';
export const dayMonth = (d) => format(new Date(d), 'MMM d');
export const weekDay = (d) => format(new Date(d), 'EEE').toLowerCase();
export const dayNum = (d) => format(new Date(d), 'd');
export const timeStr = (d) => format(new Date(d), 'HH:mm');
