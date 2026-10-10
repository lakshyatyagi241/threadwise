/** Longest code the sign-up contract accepts. */
export const REFERRAL_MAX_LENGTH = 16;

/** Upper-case letters and digits only, at most 16: what a person typing or pasting a code ends up with. */
export function sanitizeReferral(raw: string | null | undefined): string {
  return (raw ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, REFERRAL_MAX_LENGTH);
}
