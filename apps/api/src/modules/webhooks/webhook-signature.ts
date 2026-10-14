import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Checks Meta's `X-Hub-Signature-256: sha256=<hex>` header: an HMAC-SHA256 of the exact
 * request bytes, keyed with the app secret. It must be computed over the raw body — a
 * re-serialized JSON object differs in whitespace and escaping and never matches.
 */
export function isValidMetaSignature(
  rawBody: Buffer | undefined,
  header: string | undefined,
  appSecret: string,
): boolean {
  if (!rawBody || !header || !appSecret) {
    return false;
  }

  const [scheme, signature] = header.split('=', 2);
  if (scheme !== 'sha256' || !signature || !/^[0-9a-f]{64}$/i.test(signature)) {
    return false;
  }

  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  const received = Buffer.from(signature, 'hex');

  // Constant-time comparison, so the response time leaks nothing about the secret.
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export function signMetaPayload(rawBody: string | Buffer, appSecret: string): string {
  return `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
}
