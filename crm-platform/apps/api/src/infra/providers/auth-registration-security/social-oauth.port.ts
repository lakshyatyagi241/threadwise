/**
 * OAuth 2.0 authorization-code sign-in (TW-AUTH-004), no vendor SDK.
 */
export type SocialProviderName = 'google' | 'facebook';

export interface SocialCredentials {
  clientId: string;
  clientSecret: string;
}

export interface SocialProfile {
  /** Provider's stable user id (`sub` for Google, `id` for Facebook). */
  subject: string;
  email: string | null;
  /**
   * True only when the provider asserts the address is verified. Google does;
   * Facebook does not, so a Facebook email never links to an existing account.
   */
  emailVerified: boolean;
  name: string | null;
  avatarUrl: string | null;
}

export interface SocialOAuthProvider {
  readonly name: SocialProviderName;
  authorizeUrl(credentials: SocialCredentials, redirectUri: string, state: string): string;
  /** Exchanges the code and fetches the profile. Throws on any failure. */
  fetchProfile(
    credentials: SocialCredentials,
    redirectUri: string,
    code: string,
  ): Promise<SocialProfile>;
}

export const SOCIAL_OAUTH_PROVIDERS = Symbol('SOCIAL_OAUTH_PROVIDERS');
