/**
 * Where the assistant is OFF (docs/specs/help-agent-assistant.md section 6.3). Text on these screens is written by customers and
 * other third parties, so it is attacker controlled and the model must never read it. One list, used by the web launcher, the web
 * navigation guard and the API when a task starts.
 */
export const HELP_AGENT_DISABLED_ROUTES = [
  '/inbox',
  '/team-chat',
  '/support',
  '/admin',
  '/platform',
] as const;

/** Prefixes the assistant may never navigate to or act in: operator and session screens, the API, public and auth screens. */
export const HELP_AGENT_BLOCKED_NAV_PREFIXES = [
  '/admin',
  '/platform',
  '/api',
  '/login',
  '/logout',
  '/register',
  '/impersonate',
  '/operator',
  '/webhooks',
  '/b/',
  '/f/',
  '/i/',
  '/q/',
  '/s/',
  '/book',
  '/docs',
] as const;

const bare = (path: string): string => {
  const p = path.split(/[?#]/)[0] ?? '';
  return p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p;
};

const underPrefix = (path: string, prefix: string): boolean => {
  const p = bare(path).toLowerCase();
  const x = prefix.toLowerCase().replace(/\/$/, '');
  return p === x || p.startsWith(`${x}/`);
};

/** True when the assistant must stay off on this page path (segment boundary match, so `/inbox-tools` is not `/inbox`). */
export function isHelpAgentRouteDisabled(path: string): boolean {
  return HELP_AGENT_DISABLED_ROUTES.some((prefix) => underPrefix(path, prefix));
}

/** True when the assistant may not navigate to this app path. */
export function isHelpAgentNavBlocked(path: string): boolean {
  return (
    isHelpAgentRouteDisabled(path) ||
    HELP_AGENT_BLOCKED_NAV_PREFIXES.some((prefix) => underPrefix(path, prefix))
  );
}
