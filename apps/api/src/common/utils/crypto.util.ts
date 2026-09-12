import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const SALT = 'ai-commerce-platform';

/** SHA-256 hex digest. Used for refresh-token lookup keys, never for passwords. */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function deriveKey(secret: string): Buffer {
  return scryptSync(secret, SALT, 32);
}

/**
 * Envelope encryption for channel credentials at rest (access tokens, app secrets).
 * Format: base64(iv) . base64(authTag) . base64(ciphertext)
 */
export function encryptSecret(plaintext: string, secret: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, deriveKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString('base64'), authTag.toString('base64'), encrypted.toString('base64')].join('.');
}

export function decryptSecret(payload: string, secret: string): string {
  const [ivPart, tagPart, dataPart] = payload.split('.');
  if (!ivPart || !tagPart || !dataPart) {
    throw new Error('Malformed encrypted payload');
  }
  const decipher = createDecipheriv(ALGORITHM, deriveKey(secret), Buffer.from(ivPart, 'base64'));
  decipher.setAuthTag(Buffer.from(tagPart, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataPart, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
