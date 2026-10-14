import { MessageDeliveryStatus as S } from '@prisma/client';
import { advancesDelivery } from '@modules/messages/delivery-status';
import { classifyGraphError } from './meta-graph.client';

describe('advancesDelivery', () => {
  it.each([
    [S.PENDING, S.SENT],
    [S.SENT, S.DELIVERED],
    [S.SENT, S.READ],
    [S.DELIVERED, S.READ],
    [S.PENDING, S.FAILED],
    [S.SENT, S.FAILED],
  ])('moves %s to %s', (from, to) => {
    expect(advancesDelivery(from, to)).toBe(true);
  });

  it.each([
    [S.READ, S.DELIVERED],
    [S.DELIVERED, S.SENT],
    [S.READ, S.READ],
    [S.DELIVERED, S.FAILED],
    [S.FAILED, S.SENT],
  ])('does not move %s back to %s', (from, to) => {
    expect(advancesDelivery(from, to)).toBe(false);
  });
});

describe('classifyGraphError', () => {
  it('treats an invalid or expired token as an auth problem', () => {
    expect(classifyGraphError(400, 190, null)).toBe('auth');
    expect(classifyGraphError(401, null, null)).toBe('auth');
  });

  it('recognizes replies outside the 24-hour window', () => {
    expect(classifyGraphError(400, 131047, null)).toBe('window');
    expect(classifyGraphError(400, 10, 2018278)).toBe('window');
  });

  it('retries rate limits, server errors and temporary codes', () => {
    expect(classifyGraphError(400, 4, null)).toBe('transient');
    expect(classifyGraphError(400, 130429, null)).toBe('transient');
    expect(classifyGraphError(429, null, null)).toBe('transient');
    expect(classifyGraphError(503, null, null)).toBe('transient');
  });

  it('gives up on anything else', () => {
    expect(classifyGraphError(400, 100, null)).toBe('permanent');
    expect(classifyGraphError(400, 10, null)).toBe('permanent');
  });
});
