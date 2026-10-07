/** The react-query keys of the bell. In their own file so the live controller can use them without importing React hooks. */
export const NOTIFICATION_KEYS = {
  unread: ['notifications', 'unread'] as const,
  feed: ['notifications', 'feed'] as const,
};
