// Pure rules of Gmail push (TW-MAIL-033).

/** True when Gmail's `historyId` a is not newer than b (both are decimal strings). Anything unparseable counts as newer: sync to be safe. */
export const historyNotNewer = (notified: string, stored: unknown): boolean => {
  if (typeof stored !== 'string' || !/^\d+$/.test(stored) || !/^\d+$/.test(notified)) return false;
  return BigInt(notified) <= BigInt(stored);
};
