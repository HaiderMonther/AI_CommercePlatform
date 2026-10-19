import { describe, expect, it } from 'vitest';
import { compactNumber, labelEvery, niceTicks, shortDay } from '../charts';

describe('niceTicks', () => {
  it('lands on round steps that cover the maximum', () => {
    expect(niceTicks(87_000)).toEqual([0, 25_000, 50_000, 75_000, 100_000]);
    expect(niceTicks(9)).toEqual([0, 2.5, 5, 7.5, 10]);
    expect(niceTicks(100)).toEqual([0, 25, 50, 75, 100]);
  });

  it('gives an empty chart a usable axis', () => {
    expect(niceTicks(0)).toEqual([0, 1]);
    expect(niceTicks(Number.NaN)).toEqual([0, 1]);
  });

  it('always reaches the maximum', () => {
    for (const max of [1, 3, 7, 13, 999, 1234, 45_678, 2_500_001]) {
      const ticks = niceTicks(max);
      expect(ticks[0]).toBe(0);
      expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(max);
      expect(ticks.length).toBeLessThanOrEqual(6);
    }
  });
});

describe('compactNumber', () => {
  it.each([
    [0, '0'],
    [950, '950'],
    [1_200, '1.2K'],
    [45_000, '45K'],
    [250_000, '250K'],
    [1_250_000, '1.3M'],
    [-3_000, '-3K'],
  ])('%d → %s', (value, expected) => {
    expect(compactNumber(value)).toBe(expected);
  });
});

describe('labelEvery', () => {
  it('thins long axes and keeps short ones whole', () => {
    expect(labelEvery(7)).toBe(1);
    expect(labelEvery(14)).toBe(2);
    expect(labelEvery(30)).toBe(5);
  });
});

describe('shortDay', () => {
  it('formats the calendar day it was given, in any timezone', () => {
    expect(shortDay('2026-10-14')).toContain('14');
  });
});
