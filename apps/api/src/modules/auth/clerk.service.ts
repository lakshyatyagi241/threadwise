import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClerkClient, verifyToken, type ClerkClient } from '@clerk/backend';
import { AppError } from '../../common/errors/app-error';
import type { Env } from '../../config/env.schema';

export interface ClerkIdentity {
  /** Clerk's user id — stored as users.auth_subject. */
  clerkUserId: string;
  email: string;
  fullName: string;
}

/**
 * Verifies a Clerk session token and resolves it to the identity our side
 * cares about. Clerk owns the credential (password, Google); this is the
 * only place that trusts it.
 */
@Injectable()
export class ClerkService {
  private readonly client: ClerkClient;
  private readonly secretKey: string;

  constructor(config: ConfigService<Env, true>) {
    this.secretKey = config.get('CLERK_SECRET_KEY', { infer: true });
    this.client = createClerkClient({ secretKey: this.secretKey });
  }

  /**
   * `token` is the Clerk session token the frontend gets from
   * `getToken()`/`useAuth()` — not a password, never one.
   */
  async verifySession(token: string): Promise<ClerkIdentity> {
    // Throws TokenVerificationError on anything wrong (expired, bad
    // signature, wrong issuer) rather than returning a {data, errors} pair.
    const payload = await verifyToken(token, { secretKey: this.secretKey }).catch(() => null);
    if (!payload) {
      throw AppError.unauthenticated('Invalid or expired Clerk session');
    }

    const clerkUserId = payload.sub;
    const user = await this.client.users.getUser(clerkUserId).catch(() => null);
    if (!user) {
      throw AppError.unauthenticated('Clerk user not found');
    }

    const email =
      user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId)?.emailAddress ??
      user.emailAddresses[0]?.emailAddress;
    if (!email) {
      throw AppError.unauthenticated('Clerk account has no email address');
    }

    const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ') || email;

    return { clerkUserId, email: email.toLowerCase(), fullName };
  }
}
