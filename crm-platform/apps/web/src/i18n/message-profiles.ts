type Tree = { [key: string]: string | Tree };

/**
 * Which part of the message catalogue the browser gets with a page.
 *
 * The root layout hands the client provider the whole catalogue (about 1.9 MB of JSON, 570 KB gzipped, inside every full page load).
 * The public pages (sign-in and recovery, the marketing site, public forms, booking and manage-booking pages, short links, unsubscribe,
 * shop pages, the trust page, the API docs) use about 75 KB of it, so a request for one of them gets only that part. Server components
 * are not affected: they read the full catalogue through the request config. Every other page keeps the whole catalogue.
 *
 * It is ONE profile for all of those pages, not one per group, because the root layout is not rendered again on a client-side
 * navigation: a visitor who goes from the marketing site to the sign-in page keeps the set they came with, so the set has to cover
 * every public page. Going from a public page into the app is different, and must be a full page load (`window.location.replace` in
 * sign-in-complete.ts; a plain `<a href="/">` on the site's logo links, because `/` sends a signed-in visitor into the app).
 *
 * The lists are checked against the code by `message-profiles.test.ts`, which walks the imports of every page of these groups and
 * fails when a component asks for a namespace that is not here (a missing key shows as its path on screen).
 */
export interface MessageProfile {
  name: string;
  /** URL paths of the group's pages: the path itself and everything under it. */
  paths: readonly string[];
  /** Dotted namespaces; a namespace brings its whole subtree. */
  namespaces: readonly string[];
}

/** Top-level key the reduced set carries, so the browser can tell it from the whole catalogue (SlimMessagesGuard). */
export const SLIM_MARKER = '__slim';

export const MESSAGE_PROFILES: readonly MessageProfile[] = [
  {
    name: 'public',
    paths: [
      // app/(auth): sign-in, sign-up, recovery, emailed-link landings, social callback
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
      // app/(site): the marketing site; app/page.tsx is its home (matched exactly, see profileFor). `/legal/<slug>` is left out: the app
      // has a page of its own under `/legal/` (data-processing), so the prefix cannot be told apart.
      '/',
      '/about',
      '/blog',
      '/contact',
      '/features',
      '/pricing',
      // app/(developer-rest-api-v1-docs) and app/docs
      '/developers/docs',
      '/docs',
      // app/b (manage a booking), app/book, app/f (public forms), app/l (short links), app/s (shops), app/trust, app/u (unsubscribe)
      '/b',
      '/book',
      '/f',
      '/l',
      '/s',
      '/trust',
      '/u',
    ],
    namespaces: [
      'common',
      'appointments.common',
      'appointments.errors',
      'appointments.picker',
      'appointments.public',
      'appointments.status',
      'auth-registration-security.account.timezone',
      'auth-registration-security.guest',
      'contact-consent.unsubscribe',
      'developer-rest-api-v1-docs',
      'developer-rest-api-v1.common',
      'forms-links-groups.links.public',
      'localization-translation.switcher',
      'marketing-site-cms.site',
      'plans-subscriptions-trials.common',
      'plans-subscriptions-trials.features',
      'plans-subscriptions-trials.limits',
      'plans-subscriptions-trials.lock',
      'plans-subscriptions-trials.plans',
      'plans-subscriptions-trials.public',
      'platform-settings-branding-storage.cookie',
      'shopPublic',
      'web-forms.public',
      'workspaces-teams-tenancy',
    ],
  },
];

/** The profile for a request path (the proxy's `x-crm-path`, query included), or null for the whole catalogue. */
export function profileFor(requestPath: string | null | undefined): MessageProfile | null {
  if (!requestPath) return null;
  const path = requestPath.split(/[?#]/, 1)[0] ?? '';
  return (
    MESSAGE_PROFILES.find((p) =>
      p.paths.some((x) => path === x || (x !== '/' && path.startsWith(`${x}/`))),
    ) ?? null
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
