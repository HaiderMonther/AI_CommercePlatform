import { BadRequestAppException } from '@common/exceptions/app.exception';
import {
  MAX_RANGE_DAYS,
  addDays,
  changeRatio,
  daysBetween,
  eachDay,
  localDate,
  previousRange,
  resolveRange,
} from './report-range';
import { csvCell } from './reports.service';

const BAGHDAD = 'Asia/Baghdad';

describe('report ranges', () => {
  it('cuts the day in the company timezone, not UTC', () => {
    // 22:30 UTC on the 13th is already 01:30 on the 14th in Baghdad.
    expect(localDate(new Date('2026-10-13T22:30:00Z'), BAGHDAD)).toBe('2026-10-14');
    expect(localDate(new Date('2026-10-13T22:30:00Z'), 'UTC')).toBe('2026-10-13');
  });

  it('defaults to the last 30 days including today', () => {
    const range = resolveRange({}, BAGHDAD, new Date('2026-10-14T09:00:00Z'));
    expect(range).toEqual({ from: '2026-09-15', to: '2026-10-14', days: 30, timezone: BAGHDAD });
  });

  it('accepts an explicit range and counts days inclusively', () => {
    expect(resolveRange({ from: '2026-10-01', to: '2026-10-01' }, BAGHDAD).days).toBe(1);
    expect(daysBetween('2026-02-01', '2026-03-01')).toBe(29);
  });

  it.each([
    [{ from: '2026-10-10', to: '2026-10-01' }],
    [{ from: '14/10/2026' }],
    [{ from: '2025-01-01', to: addDays('2025-01-01', MAX_RANGE_DAYS) }],
  ])('rejects %j', (input) => {
    expect(() => resolveRange(input, BAGHDAD)).toThrow(BadRequestAppException);
  });

  it('compares with the period of the same length just before', () => {
    const range = resolveRange({ from: '2026-10-01', to: '2026-10-07' }, BAGHDAD);
    expect(previousRange(range)).toMatchObject({ from: '2026-09-24', to: '2026-09-30', days: 7 });
  });

  it('lists every day so quiet days show as zero', () => {
    const range = resolveRange({ from: '2026-02-27', to: '2026-03-02' }, BAGHDAD);
    expect(eachDay(range)).toEqual(['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02']);
  });

  it('reports change as a percentage, or null with nothing to compare', () => {
    expect(changeRatio(150, 100)).toBe(50);
    expect(changeRatio(50, 200)).toBe(-75);
    expect(changeRatio(10, 0)).toBeNull();
  });
});

describe('csvCell', () => {
  it('quotes values with commas, quotes and line breaks', () => {
    expect(csvCell('بغداد، المنصور')).toBe('بغداد، المنصور');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('قال "نعم"')).toBe('"قال ""نعم"""');
    expect(csvCell('سطر\nثاني')).toBe('"سطر\nثاني"');
  });

  it('defuses text that a spreadsheet would run as a formula', () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
  });

  it('keeps phone numbers and numbers as they are', () => {
    expect(csvCell('+9647701234567')).toBe('+9647701234567');
    expect(csvCell(-5000)).toBe('-5000');
    expect(csvCell(null)).toBe('');
  });
});
