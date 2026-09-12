import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';

/**
 * Argon2id password hashing. Argon2id is the current OWASP recommendation and is
 * memory-hard, which makes GPU cracking of a leaked hash table impractical.
 */
@Injectable()
export class PasswordService {
  private readonly memoryCost: number;

  constructor(private readonly config: ConfigService) {
    this.memoryCost = this.config.get<number>('security.bcryptMemoryCost') ?? 19456;
  }

  async hash(plain: string): Promise<string> {
    return argon2.hash(plain, {
      type: argon2.argon2id,
      memoryCost: this.memoryCost,
      timeCost: 2,
      parallelism: 1,
    });
  }

  async verify(hash: string, plain: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain);
    } catch {
      return false;
    }
  }
}
