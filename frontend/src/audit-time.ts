/** Audit instants only. Calendar dates/months continue to use their existing helpers. */
export function formatAuditTimestamp(value: string | null | undefined, timeZone?: string): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return 'Time unavailable';
  const calendar = /^(\d{4})-(\d{2})-(\d{2})(?:T| |$)/i.exec(raw);
  if (calendar) {
    const [, yearText, monthText, dayText] = calendar;
    const year = Number(yearText), month = Number(monthText), day = Number(dayText);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (month < 1 || month > 12 || day < 1 || day > days[month - 1]) return 'Time unavailable';
  }
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) return 'Time unavailable';
  // An unzoned server value does not establish an instant. Do not silently assign
  // the browser's zone or UTC and thereby invent an audit event time.
  if (!/[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)) {
    return `${raw} (time zone not recorded)`;
  }
  try {
    const zone = timeZone || new Intl.DateTimeFormat().resolvedOptions().timeZone;
    const display = new Intl.DateTimeFormat('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit',
      minute: '2-digit', second: '2-digit', hourCycle: 'h23',
      timeZone: zone, timeZoneName: 'longOffset',
    }).format(date);
    return `${display} (${zone})`;
  } catch {
    // A broken/limited Intl implementation must not prevent reviewing records.
    return `${date.toISOString()} (UTC; display time zone unavailable)`;
  }
}
