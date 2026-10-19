import { ExecutionContext, SetMetadata } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerModuleOptions } from '@nestjs/throttler';

const AUTH_RATE_LIMIT_KEY = 'throttle:auth';

/**
 * Puts a route under the strict sign-in limit (THROTTLE_AUTH_LIMIT per minute per IP),
 * on top of the general one. For credential endpoints: login, register, refresh.
 */
export const AuthRateLimit = () => SetMetadata(AUTH_RATE_LIMIT_KEY, true);

export function isAuthRateLimited(context: ExecutionContext): boolean {
  return Boolean(
    Reflect.getMetadata(AUTH_RATE_LIMIT_KEY, context.getHandler()) ??
    Reflect.getMetadata(AUTH_RATE_LIMIT_KEY, context.getClass()),
  );
}

/**
 * Two named limits. The throttler guard applies every named limit to every route, so the
 * strict `auth` limit must skip routes that did not opt in — without that, ten requests a
 * minute would throttle the whole dashboard, not just sign-in attempts.
 */
export function throttlerOptions(config: ConfigService): ThrottlerModuleOptions {
  return {
    throttlers: [
      {
        name: 'default',
        ttl: (config.get<number>('throttle.ttlSeconds') ?? 60) * 1000,
        limit: config.get<number>('throttle.limit') ?? 120,
      },
      {
        name: 'auth',
        ttl: 60_000,
        limit: config.get<number>('throttle.authLimit') ?? 10,
        skipIf: (context) => !isAuthRateLimited(context),
      },
    ],
  };
}
