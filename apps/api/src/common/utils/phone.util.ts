const ARABIC_INDIC_ZERO = 0x0660;
const EXTENDED_ARABIC_INDIC_ZERO = 0x06f0;

/** Merchants and customers type numbers with Arabic-Indic digits (٠٧٧٠…) as often as Latin ones. */
export function toLatinDigits(value: string): string {
  return value.replace(/[٠-٩۰-۹]/g, (digit) => {
    const code = digit.charCodeAt(0);
    const base = code >= EXTENDED_ARABIC_INDIC_ZERO ? EXTENDED_ARABIC_INDIC_ZERO : ARABIC_INDIC_ZERO;
    return String(code - base);
  });
}

/**
 * Normalizes a phone number to E.164 (`+9647701234567`) or returns null when it cannot be
 * read unambiguously.
 *
 * One canonical form matters because the phone is the customer's natural key: the same
 * person typed as `0770 123 4567` on the dashboard and arriving as `9647701234567` from
 * WhatsApp must resolve to one record, not two. Local numbers without a country code are
 * only accepted in the Iraqi mobile format; anything else must carry its country code.
 */
export function normalizePhone(input: string | null | undefined): string | null {
  if (typeof input !== 'string') {
    return null;
  }

  let value = toLatinDigits(input.trim()).replace(/[\s\-().]/g, '');

  if (value.startsWith('00')) {
    value = `+${value.slice(2)}`;
  }

  if (value.startsWith('+')) {
    return /^\+[1-9]\d{7,14}$/.test(value) ? value : null;
  }

  if (/^9647\d{9}$/.test(value)) {
    return `+${value}`;
  }
  if (/^07\d{9}$/.test(value)) {
    return `+964${value.slice(1)}`;
  }
  if (/^7\d{9}$/.test(value)) {
    return `+964${value}`;
  }

  return null;
}
