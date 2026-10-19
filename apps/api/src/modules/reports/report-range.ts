import { BadRequestAppException } from '@common/exceptions/app.exception';

/**
 * A reporting period in whole days of the company's own calendar. "Today" in Baghdad
 * starts at 21:00 UTC the day before, so days are cut in the company's timezone; the SQL
 * converts the bounds back to UTC so the createdAt indexes still apply.
 */
export interface ReportRange {
  /** First day, inclusive (YYYY-MM-DD). */
  from: string;
  /** Last day, inclusive (YYYY-MM-DD). */
  to: string;
  days: number;
  timezone: string;
}

export const DEFAULT_RANGE_DAYS = 30;
export const MAX_RANGE_DAYS = 366;

const DAY_MS = 86_400_000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** The calendar date of `now` in the timezone, as YYYY-MM-DD. */
export function localDate(now: Date, timezone: string): string {
  // en-CA formats dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(now);
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
}

export function resolveRange(
  input: { from?: string; to?: string },
  timezone: string,
  now = new Date(),
): ReportRange {
  for (const value of [input.from, input.to]) {
    if (value !== undefined && (!DATE_PATTERN.test(value) || Number.isNaN(Date.parse(value)))) {
      throw new BadRequestAppException('صيغة التاريخ يجب أن تكون YYYY-MM-DD');
    }
  }

  const to = input.to ?? localDate(now, timezone);
  const from = input.from ?? addDays(to, -(DEFAULT_RANGE_DAYS - 1));
  const days = daysBetween(from, to);

  if (days < 1) {
    throw new BadRequestAppException('تاريخ البداية بعد تاريخ النهاية');
  }
  if (days > MAX_RANGE_DAYS) {
    throw new BadRequestAppException(`أقصى مدة للتقرير ${MAX_RANGE_DAYS} يوماً`);
  }

  return { from, to, days, timezone };
}

/** The period of the same length just before, to compare against. */
export function previousRange(range: ReportRange): ReportRange {
  const to = addDays(range.from, -1);
  return { ...range, from: addDays(to, -(range.days - 1)), to };
}

/** Every day of the range, so a chart shows days without activity as zero, not as a gap. */
export function eachDay(range: ReportRange): string[] {
  return Array.from({ length: range.days }, (_, index) => addDays(range.from, index));
}

/** Percentage change, or null when there is nothing to compare with. */
export function changeRatio(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}
