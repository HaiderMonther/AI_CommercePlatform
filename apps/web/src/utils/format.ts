/**
 * Arabic labels with Latin digits (`-u-nu-latn`).
 *
 * `ar-IQ` alone renders Arabic-Indic numerals (٠١٢٣), which break tabular alignment in
 * tables and do not match the printed invoices and POS receipts Iraqi merchants use.
 * Month and weekday names stay Arabic.
 */
const AR_LOCALE = 'ar-IQ-u-nu-latn';

/**
 * Iraqi dinar has no commonly used minor unit, so IQD is rendered without decimals
 * while other currencies keep two.
 */
export function formatCurrency(value: number | string | null | undefined, currency = 'IQD'): string {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) {
    return '—';
  }

  const fractionDigits = currency === 'IQD' ? 0 : 2;
  const formatted = new Intl.NumberFormat(AR_LOCALE, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(amount);

  return currency === 'IQD' ? `${formatted} د.ع` : `${formatted} ${currency}`;
}

export function formatNumber(value: number | null | undefined): string {
  return new Intl.NumberFormat(AR_LOCALE).format(Number(value ?? 0));
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';

  return new Intl.DateTimeFormat(AR_LOCALE, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';

  return new Intl.DateTimeFormat(AR_LOCALE, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/** Short relative time ("قبل 5 دقائق") for activity feeds. */
export function formatRelative(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';

  const diffSeconds = Math.round((date.getTime() - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat(AR_LOCALE, { numeric: 'auto' });

  const thresholds: [number, Intl.RelativeTimeFormatUnit][] = [
    [60, 'second'],
    [3600, 'minute'],
    [86400, 'hour'],
    [604800, 'day'],
    [2629800, 'week'],
    [31557600, 'month'],
  ];

  const absolute = Math.abs(diffSeconds);
  let previous = 1;

  for (const [limit, unit] of thresholds) {
    if (absolute < limit) {
      return formatter.format(Math.round(diffSeconds / previous), unit);
    }
    previous = limit;
  }

  return formatter.format(Math.round(diffSeconds / 31557600), 'year');
}

export function initialsOf(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join('');
}
