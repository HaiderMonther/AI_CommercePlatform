import { normalizePhone } from './phone.util';

describe('normalizePhone', () => {
  it.each([
    ['07701234567', '+9647701234567'],
    ['0770 123 4567', '+9647701234567'],
    ['0770-123-4567', '+9647701234567'],
    ['7701234567', '+9647701234567'],
    ['9647701234567', '+9647701234567'],
    ['+964 770 123 4567', '+9647701234567'],
    ['009647701234567', '+9647701234567'],
    ['٠٧٧٠١٢٣٤٥٦٧', '+9647701234567'],
    ['۰۷۷۰۱۲۳۴۵۶۷', '+9647701234567'],
    ['+966501234567', '+966501234567'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each([
    ['', 'empty'],
    ['12345', 'too short'],
    ['0501234567', 'a local number outside the Iraqi mobile format'],
    ['+0123456789', 'a country code starting with zero'],
    ['077012345678', 'an Iraqi number with an extra digit'],
    ['phone', 'letters'],
  ])('rejects %s (%s)', (input) => {
    expect(normalizePhone(input)).toBeNull();
  });

  it('rejects non-string input', () => {
    expect(normalizePhone(undefined)).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });
});
