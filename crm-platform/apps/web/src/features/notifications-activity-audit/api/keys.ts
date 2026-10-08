/** The react-query keys of the bell. In their own file so the live controller can use them without importing React hooks. */
export const NOTIFICATION_KEYS = {
  unread: ['notifications', 'unread'] as const,
  feed: ['notifications', 'feed'] as const,
  /** The signed-in person's own preferences (a `PrefsState`). */
  preferences: ['notifications', 'preferences'] as const,
  /** Whether the deployment has browser push, and its public key. */
  pushKey: ['notifications', 'push', 'key'] as const,
  /** The person's own browser notification devices. */
  pushDevices: ['notifications', 'push', 'devices'] as const,
};
