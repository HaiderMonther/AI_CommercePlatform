import { decryptSecret, encryptSecret, sha256 } from './crypto.util';

describe('crypto utils', () => {
  const key = 'a-very-long-development-encryption-key-32';

  it('round-trips an encrypted channel credential', () => {
    const secret = 'EAAG...meta-access-token';
    expect(decryptSecret(encryptSecret(secret, key), key)).toBe(secret);
  });

  it('produces a different ciphertext each time (random IV)', () => {
    expect(encryptSecret('same', key)).not.toBe(encryptSecret('same', key));
  });

  it('refuses to decrypt with the wrong key', () => {
    const payload = encryptSecret('secret', key);
    expect(() => decryptSecret(payload, 'another-key-that-is-also-32-chars-long')).toThrow();
  });

  it('detects a tampered payload through the auth tag', () => {
    const [iv, tag] = encryptSecret('secret', key).split('.');
    const tampered = [iv, tag, Buffer.from('tampered').toString('base64')].join('.');
    expect(() => decryptSecret(tampered, key)).toThrow();
  });

  it('hashes deterministically', () => {
    expect(sha256('token')).toBe(sha256('token'));
    expect(sha256('token')).not.toBe(sha256('token2'));
  });
});
