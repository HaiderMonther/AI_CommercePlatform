import { describe, expect, it } from 'vitest';
import { formatCurrency, formatDate, formatNumber, initialsOf } from '../format';

describe('formatCurrency', () => {
  it('renders IQD with Latin digits and no decimals, as prices are quoted in Iraq', () => {
    expect(formatCurrency(25000)).toBe('25,000 د.ع');
  });

  it('keeps two decimals for USD', () => {
    expect(formatCurrency(19.5, 'USD')).toBe('19.50 USD');
  });

  it('treats a missing amount as zero rather than rendering NaN', () => {
    expect(formatCurrency(null)).toBe('0 د.ع');
    expect(formatCurrency(undefined)).toBe('0 د.ع');
  });

  it('accepts the decimal strings the API returns for money columns', () => {
    expect(formatCurrency('15000')).toBe('15,000 د.ع');
  });

  it('falls back to a dash for an unparseable value', () => {
    expect(formatCurrency('abc')).toBe('—');
  });
});

describe('formatNumber', () => {
  it('uses Latin digits so counts line up in tables', () => {
    expect(formatNumber(1500)).toBe('1,500');
    expect(formatNumber(null)).toBe('0');
  });
});

describe('formatDate', () => {
  it('renders a dash for missing or invalid input instead of "Invalid Date"', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate('not-a-date')).toBe('—');
  });

  it('keeps Arabic month names alongside Latin digits', () => {
    expect(formatDate('2026-03-15T10:00:00.000Z')).toBe('15 آذار 2026');
  });
});

describe('initialsOf', () => {
  it('takes the first letter of the first two words', () => {
    expect(initialsOf('حيدر منذر علي')).toBe('حم');
    expect(initialsOf('Ali')).toBe('A');
  });

  it('handles an empty name without throwing', () => {
    expect(initialsOf('')).toBe('');
  });
});
