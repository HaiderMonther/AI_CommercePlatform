import { parseDuration } from './token.service';

describe('parseDuration', () => {
  it.each([
    ['30s', 30],
    ['15m', 900],
    ['2h', 7200],
    ['30d', 2_592_000],
    ['900', 900],
  ])('converts %s to %i seconds', (input, expected) => {
    expect(parseDuration(input)).toBe(expected);
  });

  it('rejects an unparseable duration instead of silently defaulting', () => {
    expect(() => parseDuration('soon')).toThrow('Invalid duration: soon');
    expect(() => parseDuration('-5m')).toThrow();
  });
});
