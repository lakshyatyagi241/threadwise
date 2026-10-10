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
   * Clerk sign-in is an OPTIONAL door. The key is mandatory in the environment schema (so the app boots everywhere), but the
   * example placeholder (`sk_test_replace_me`) and an empty value mean "not configured": the exchange route then answers
   * 404 instead of being a live endpoint that can only fail.
   */
  isConfigured(): boolean {
    return (
      this.secretKey.length > 0 && !/replace[_-]?me|changeme|placeholder/i.test(this.secretKey)
    );
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

    const primary =
      user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId) ??
      user.emailAddresses[0];
    const email = primary?.emailAddress;
    if (!email) {
      throw AppError.unauthenticated('Clerk account has no email address');
    }
    // The exchange links this identity to an existing local user BY ADDRESS. An address Clerk has not verified proves
    // nothing: anyone could register the victim's address in Clerk and take over the victim's local account.
    if (primary?.verification?.status !== 'verified') {
      throw AppError.unauthenticated('Clerk email address is not verified');
    }

    const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ') || email;

    return { clerkUserId, email: email.toLowerCase(), fullName };
  }
}
