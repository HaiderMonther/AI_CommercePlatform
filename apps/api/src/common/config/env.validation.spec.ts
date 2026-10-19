import 'reflect-metadata';
import { productionProblems, validateEnv } from './env.validation';

const base = {
  DATABASE_URL: 'postgresql://app:secret@postgres:5432/ai_commerce',
  JWT_SECRET: 'a'.repeat(40),
  JWT_REFRESH_SECRET: 'b'.repeat(40),
};

describe('environment validation', () => {
  it('accepts a minimal development setup', () => {
    expect(() => validateEnv({ ...base, NODE_ENV: 'development' })).not.toThrow();
  });

  it('refuses short or identical JWT secrets', () => {
    expect(() => validateEnv({ ...base, JWT_SECRET: 'short' })).toThrow('JWT_SECRET');
    expect(() => validateEnv({ ...base, JWT_REFRESH_SECRET: base.JWT_SECRET })).toThrow(
      'different',
    );
  });

  describe('in production', () => {
    const production = {
      ...base,
      NODE_ENV: 'production',
      ENCRYPTION_KEY: 'k'.repeat(40),
      CORS_ORIGINS: 'https://app.example.iq',
    };

    it('accepts a complete setup', () => {
      expect(() => validateEnv(production)).not.toThrow();
    });

    it('requires the encryption key for channel tokens', () => {
      expect(() => validateEnv({ ...production, ENCRYPTION_KEY: undefined })).toThrow(
        'ENCRYPTION_KEY',
      );
    });

    it('refuses a wildcard CORS origin', () => {
      expect(productionProblems({ ...production, CORS_ORIGINS: 'https://a.iq, *' })).toHaveLength(
        1,
      );
    });

    it('catches a development database URL, unless allowed on purpose', () => {
      const local = { ...production, DATABASE_URL: 'postgresql://u:p@localhost:5432/db' };
      expect(productionProblems(local)).toHaveLength(1);
      expect(productionProblems({ ...local, ALLOW_LOCAL_DATABASE: 'true' })).toHaveLength(0);
    });
  });
});
