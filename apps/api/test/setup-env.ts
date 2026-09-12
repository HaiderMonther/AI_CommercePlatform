process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://aicommerce:aicommerce@127.0.0.1:5432/ai_commerce_test?schema=public';
process.env.JWT_SECRET = 'test-access-secret-value-that-is-long-enough';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-value-that-is-long-enough';
process.env.JWT_EXPIRES_IN = '15m';
process.env.JWT_REFRESH_EXPIRES_IN = '7d';
process.env.SWAGGER_ENABLED = 'false';
process.env.THROTTLE_LIMIT = '10000';
process.env.THROTTLE_AUTH_LIMIT = '10000';
process.env.ARGON_MEMORY_COST = '8192';
