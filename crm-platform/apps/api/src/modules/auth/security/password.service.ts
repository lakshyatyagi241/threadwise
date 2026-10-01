import { HttpStatus, Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import { ERROR_CODES } from '@crm/contracts';
import { AppError } from '../../../common/errors/app-error';
import { SecurityPolicyService } from '../platform/security-policy.service';
import { evaluatePassword, type PasswordContext } from '../support/password-policy';

/** argon2id hash of a random string nobody knows. Used only for timing parity. */
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHR2YWx1ZQ$8cJ0Yc0CkB2S1sC7g3aKhQXbXmCLvxg4XmYXNnEXHbA';

/**
 * Password hashing and the admin password policy in one place, so every path
 * that sets a password (sign-up, reset, change, invite, operator) applies the
 * same rules. Reference applied them on change-password only (TW-AUTH-035).
 */
@Injectable()
export class PasswordService {
  constructor(private readonly policy: SecurityPolicyService) {}

  hash(password: string): Promise<string> {
    return hash(password);
  }

  /**
   * Verifies against a dummy hash when the account does not exist, so a
   * non-existent account takes as long as a wrong password. Without this,
   * response time tells an attacker which emails are real.
   */
  async verifyOrDummy(storedHash: string | null | undefined, password: string): Promise<boolean> {
    const ok = await verify(storedHash ?? DUMMY_HASH, password).catch(() => false);
    return Boolean(storedHash) && ok;
  }

  async matches(storedHash: string | null | undefined, password: string): Promise<boolean> {
    return this.verifyOrDummy(storedHash, password);
  }

  /** Throws AUTH_PASSWORD_POLICY with one detail per broken rule. */
  async assertAcceptable(password: string, context: PasswordContext = {}): Promise<void> {
    const policy = await this.policy.policy();
    const violations = evaluatePassword(password, policy, context);
    if (violations.length === 0) return;
    throw new AppError(
      ERROR_CODES.AUTH_PASSWORD_POLICY,
      'That password does not meet the security policy.',
      HttpStatus.UNPROCESSABLE_ENTITY,
      violations.map((v) => ({
        path: `${context.field ?? 'password'}.${v.rule}`,
        message: v.message,
      })),
    );
  }
}
