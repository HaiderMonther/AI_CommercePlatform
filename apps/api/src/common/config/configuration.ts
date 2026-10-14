export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  apiPrefix: string;
  frontendUrl: string;
  corsOrigins: string[];
  swaggerEnabled: boolean;
  logLevel: string;
}

export interface JwtConfig {
  accessSecret: string;
  accessTtl: string;
  refreshSecret: string;
  refreshTtl: string;
  issuer: string;
}

export interface RedisConfig {
  url: string;
}

export interface ThrottleConfig {
  ttlSeconds: number;
  limit: number;
  authLimit: number;
}

export interface SecurityConfig {
  encryptionKey: string;
  bcryptMemoryCost: number;
}

export interface MetaConfig {
  /** Signs every webhook delivery (X-Hub-Signature-256). */
  appSecret: string;
  /** Echoed back to Meta when it verifies the webhook URL. */
  verifyToken: string;
  graphVersion: string;
  graphBaseUrl: string;
}

export interface WorkerConfig {
  /** How often stuck webhooks and unsent replies are swept up; 0 disables the sweep. */
  sweepIntervalMs: number;
}

export interface AiProviderConfig {
  /** Anthropic API key. Without it the agent stays off and conversations go to people. */
  apiKey: string;
  /** Model for companies that have not picked one. */
  defaultModel: string;
  /** Waits for a burst of customer messages to settle before answering them together. */
  replyDelayMs: number;
}

export interface RootConfig {
  app: AppConfig;
  jwt: JwtConfig;
  redis: RedisConfig;
  throttle: ThrottleConfig;
  security: SecurityConfig;
  meta: MetaConfig;
  worker: WorkerConfig;
  ai: AiProviderConfig;
}

const toInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const toList = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

export default (): RootConfig => ({
  app: {
    nodeEnv: (process.env.NODE_ENV as AppConfig['nodeEnv']) ?? 'development',
    port: toInt(process.env.PORT, 3000),
    apiPrefix: process.env.API_PREFIX ?? 'api/v1',
    frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:5173',
    corsOrigins: toList(
      process.env.CORS_ORIGINS ?? process.env.FRONTEND_URL ?? 'http://localhost:5173',
    ),
    swaggerEnabled: process.env.SWAGGER_ENABLED !== 'false',
    logLevel: process.env.LOG_LEVEL ?? 'log',
  },
  jwt: {
    accessSecret: process.env.JWT_SECRET ?? '',
    accessTtl: process.env.JWT_EXPIRES_IN ?? '15m',
    refreshSecret: process.env.JWT_REFRESH_SECRET ?? '',
    refreshTtl: process.env.JWT_REFRESH_EXPIRES_IN ?? '30d',
    issuer: process.env.JWT_ISSUER ?? 'ai-commerce-platform',
  },
  redis: {
    url: process.env.REDIS_URL ?? 'redis://localhost:6379',
  },
  throttle: {
    ttlSeconds: toInt(process.env.THROTTLE_TTL, 60),
    limit: toInt(process.env.THROTTLE_LIMIT, 120),
    authLimit: toInt(process.env.THROTTLE_AUTH_LIMIT, 10),
  },
  security: {
    encryptionKey: process.env.ENCRYPTION_KEY ?? '',
    bcryptMemoryCost: toInt(process.env.ARGON_MEMORY_COST, 19456),
  },
  meta: {
    appSecret: process.env.META_APP_SECRET ?? '',
    verifyToken: process.env.META_VERIFY_TOKEN ?? '',
    graphVersion: process.env.META_GRAPH_VERSION ?? 'v21.0',
    graphBaseUrl: process.env.META_GRAPH_URL ?? 'https://graph.facebook.com',
  },
  ai: {
    apiKey: process.env.AI_API_KEY ?? process.env.ANTHROPIC_API_KEY ?? '',
    defaultModel: process.env.AI_MODEL ?? 'claude-opus-5-5',
    replyDelayMs: process.env.NODE_ENV === 'test' ? 0 : toInt(process.env.AI_REPLY_DELAY_MS, 1500),
  },
  worker: {
    // Tests drive the sweep by hand so timing never decides an assertion.
    sweepIntervalMs:
      process.env.NODE_ENV === 'test' ? 0 : toInt(process.env.WORKER_SWEEP_INTERVAL_MS, 15_000),
  },
});
