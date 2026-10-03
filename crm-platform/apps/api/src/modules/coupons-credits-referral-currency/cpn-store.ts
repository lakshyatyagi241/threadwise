import { HttpStatus, Injectable } from '@nestjs/common';
import { ERROR_CODES, type ErrorCode } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { AppError } from '../../common/errors/app-error';
import { PlatformStore } from '../auth';

/** Which constraint name becomes which refusal when two correct requests collide. */
export type UniqueMap = Readonly<Record<string, { code: ErrorCode; message: string }>>;

/**
 * The door to this domain's platform-wide tables (`coupons`, `credit_packages`, `currencies`, `referrals`, `referral_codes`):
 * their policies admit writes only under the privileged flag, so every operator write and every cross-tenant read goes through
 * the platform store (the one place that switches the privileged flag on). Nothing in this module switches it on itself.
 *
 * A unique violation is the one failure two correct requests can cause together (two operators creating the same code at the
 * same instant); it becomes a 409 the console can show, not a 500.
 */
@Injectable()
export class CpnStore {
  constructor(private readonly platform: PlatformStore) {}

  async tx<T>(fn: (tx: Tx) => Promise<T>, unique: UniqueMap = {}): Promise<T> {
    try {
      return await this.platform.tx(fn);
    } catch (err) {
      const e = err as {
        code?: string;
        constraint?: string;
        cause?: { code?: string; constraint?: string };
      };
      const code = e.code ?? e.cause?.code;
      const constraint = e.constraint ?? e.cause?.constraint;
      if (code === '23505') {
        const hit = constraint ? unique[constraint] : undefined;
        throw new AppError(
          hit?.code ?? ERROR_CODES.CONFLICT,
          hit?.message ?? 'Another change was saved at the same time. Reload and try again.',
          HttpStatus.CONFLICT,
        );
      }
      throw err;
    }
  }
}
