import { plainToInstance } from 'class-transformer';
import { IsEnum, IsNotEmpty, IsOptional, IsString, MinLength, validateSync } from 'class-validator';

enum NodeEnv {
  Development = 'development',
  Test = 'test',
  Production = 'production',
}

/**
 * Fail-fast validation of the process environment. The app refuses to boot with a
 * missing or weak secret rather than silently falling back to an insecure default.
 */
class EnvironmentVariables {
  @IsEnum(NodeEnv)
  @IsOptional()
  NODE_ENV?: NodeEnv;

  @IsString()
  @IsNotEmpty({ message: 'DATABASE_URL is required' })
  DATABASE_URL!: string;

  @IsString()
  @MinLength(32, { message: 'JWT_SECRET must be at least 32 characters' })
  JWT_SECRET!: string;

  @IsString()
  @MinLength(32, { message: 'JWT_REFRESH_SECRET must be at least 32 characters' })
  JWT_REFRESH_SECRET!: string;

  @IsString()
  @IsOptional()
  REDIS_URL?: string;

  @IsString()
  @IsOptional()
  @MinLength(32, { message: 'ENCRYPTION_KEY must be at least 32 characters' })
  ENCRYPTION_KEY?: string;

  @IsString()
  @IsOptional()
  META_APP_SECRET?: string;

  @IsString()
  @IsOptional()
  @MinLength(16, { message: 'META_VERIFY_TOKEN must be at least 16 characters' })
  META_VERIFY_TOKEN?: string;
}

export function validateEnv(config: Record<string, unknown>) {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validated, { skipMissingProperties: false });

  if (errors.length > 0) {
    const details = errors
      .map((error) => Object.values(error.constraints ?? {}).join(', '))
      .join('\n  - ');
    throw new Error(`Invalid environment configuration:\n  - ${details}`);
  }

  if (validated.JWT_SECRET === validated.JWT_REFRESH_SECRET) {
    throw new Error('JWT_SECRET and JWT_REFRESH_SECRET must be different values');
  }

  if (validated.NODE_ENV === NodeEnv.Production) {
    const problems = productionProblems(config);
    if (problems.length) {
      throw new Error(`Unsafe production configuration:\n  - ${problems.join('\n  - ')}`);
    }
  }

  return config;
}

/** Settings that are tolerable in development and a hole in production. */
export function productionProblems(config: Record<string, unknown>): string[] {
  const problems: string[] = [];
  const value = (key: string) => (typeof config[key] === 'string' ? (config[key] as string) : '');

  if (!value('ENCRYPTION_KEY')) {
    problems.push('ENCRYPTION_KEY is required: channel access tokens are encrypted with it');
  }
  const origins = value('CORS_ORIGINS') || value('FRONTEND_URL');
  if (origins.split(',').some((origin) => origin.trim() === '*')) {
    problems.push('CORS_ORIGINS must list the dashboard origin, not "*"');
  }
  if (
    /localhost|127\.0\.0\.1/.test(value('DATABASE_URL')) &&
    value('ALLOW_LOCAL_DATABASE') !== 'true'
  ) {
    // Usually a dev .env copied into production; set ALLOW_LOCAL_DATABASE=true if intended.
    problems.push(
      'DATABASE_URL points at localhost (set ALLOW_LOCAL_DATABASE=true if that is intended)',
    );
  }
  return problems;
}
