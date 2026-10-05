/** True for an IANA zone name the runtime knows; "UTC" counts. */
export function isKnownTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Who may change the workspace's settings: its owner. A workspace that records no owner has nobody the rule can name, so
 * its administrators stand in rather than leaving it frozen (the account profile applies the same rule to the timezone).
 */
export function ownerMay(p: { is_owner: boolean; has_owner: boolean; is_admin: boolean }): boolean {
  return p.is_owner || (!p.has_owner && p.is_admin);
}

/** The delete confirmation compares the trimmed name exactly, case included (Reference). */
export const sameName = (typed: string, actual: string): boolean => typed.trim() === actual.trim();
