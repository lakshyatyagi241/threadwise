type Tree = { [key: string]: string | Tree };

/**
 * Which part of the message catalogue the browser gets with a page.
 *
 * The root layout hands the client provider the whole catalogue (about 1.9 MB of JSON, 570 KB gzipped, inside every full page load).
 * A guest page uses a few dozen kilobytes of it, so a request for one of those pages gets only that part. Server components are not
 * affected: they read the full catalogue through the request config. Every other page keeps the whole catalogue.
 *
 * The lists below are checked against the code by `message-profiles.test.ts`, which walks the imports of every page of the group and
 * fails when a client component asks for a namespace that is not here (a missing key shows as its path on screen).
 *
 * Leaving the group by a client-side navigation would keep this smaller set, so the guest pages leave it with a full page load
 * (`window.location.replace` in sign-in-complete.ts); the navigations that stay inside the group are fine.
 */
export interface MessageProfile {
  name: string;
  /** URL paths of the group's pages: the path itself and everything under it. */
  paths: readonly string[];
  /** Dotted namespaces; a namespace brings its whole subtree. */
  namespaces: readonly string[];
}

export const MESSAGE_PROFILES: readonly MessageProfile[] = [
  {
    // app/(auth): sign-in, sign-up, recovery, emailed-link landings, social callback.
    name: 'guest',
    paths: [
      '/accept-invite',
      '/auth',
      '/confirm-email-change',
      '/find-workspace',
      '/forgot-password',
      '/login',
      '/logout',
      '/register',
      '/reset-password',
      '/signup',
      '/verify-email',
      '/verify-otp',
    ],
    namespaces: [
      'common',
      'auth-registration-security.account.timezone',
      'auth-registration-security.guest',
      'localization-translation.switcher',
      'plans-subscriptions-trials.lock',
      'platform-settings-branding-storage.cookie',
      'workspaces-teams-tenancy',
    ],
  },
];

/** The profile for a request path (the proxy's `x-crm-path`, query included), or null for the whole catalogue. */
export function profileFor(requestPath: string | null | undefined): MessageProfile | null {
  if (!requestPath) return null;
  const path = requestPath.split(/[?#]/, 1)[0] ?? '';
  return (
    MESSAGE_PROFILES.find((p) => p.paths.some((x) => path === x || path.startsWith(`${x}/`))) ??
    null
  );
}

/** A copy of `messages` holding only the given dotted namespaces. A namespace that is not in the catalogue is skipped. */
export function pickMessages(messages: Tree, namespaces: readonly string[]): Tree {
  const out: Tree = {};
  for (const ns of namespaces) {
    const keys = ns.split('.');
    let from: string | Tree | undefined = messages;
    for (const k of keys) {
      if (typeof from !== 'object' || from === null) {
        from = undefined;
        break;
      }
      from = from[k];
    }
    if (from === undefined) continue;
    let into = out;
    for (const k of keys.slice(0, -1)) {
      const next = into[k];
      into = typeof next === 'object' ? next : (into[k] = {});
    }
    const last = keys[keys.length - 1]!;
    const existing = into[last];
    into[last] =
      typeof existing === 'object' && typeof from === 'object' ? { ...existing, ...from } : from;
  }
  return out;
}
