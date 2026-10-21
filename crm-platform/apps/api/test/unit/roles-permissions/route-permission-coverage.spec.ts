import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * "Everything is manageable through permissions": every route a signed-in workspace user can reach is gated by a key a role can hold or
 * withhold. This scans the controllers and fails when a route has no `@RequirePermission`, unless it is public, operator-only,
 * partner-only, or listed below with the reason. The list is the whole set of exceptions and only ever shrinks.
 */
const SELF_SERVICE: Readonly<Record<string, string>> = {
  'modules/auth/auth.controller.ts':
    'sign-in, session, workspace switch: act on the caller’s own session',
  'modules/auth/controllers/account.controller.ts':
    'the caller’s own profile, password, MFA, sessions, avatar',
  'modules/auth/controllers/onboarding.controller.ts': 'the caller’s own onboarding state',
  'modules/auth/controllers/registration.controller.ts':
    'verification mail for the caller’s own address',
  'modules/notifications/notifications.controller.ts': 'the caller’s own notification feed',
  'modules/notifications/push.controller.ts':
    'the caller’s own browser notification devices (list, add, remove, test), pinned to the caller in the service',
  'infra/providers/chat-conversations/media/media.controller.ts':
    'a short-lived signed token bound to one person and workspace, checked against the conversation’s visibility rule at read time',
  'realtime/ticket/realtime-ticket.controller.ts':
    'mints a one-time realtime ticket for the caller’s own session; every room is authorised again at join',
  'modules/team-chat/team-chat.controller.ts':
    'checked per action inside the service from the member’s capabilities (tchat.* keys, channel membership)',
  'modules/admin-console-shell/workspace-settings.controller.ts':
    'Reference gates the General, notification and Data & export tabs to the workspace owner, not to a permission key: the service checks ownership on every write, the CSV download and the delete (a non-owner gets 403)',
};
const SELF_SERVICE_HANDLERS: ReadonlyArray<string> = [
  'modules/admin/users/users.controller.ts#me',
  // the plan catalogue behind the pricing cards every member sees when asked to upgrade
  'modules/plans-subscriptions-trials/plans.controller.ts#list',
  // the member and team directories every workspace member can open (Reference shows them to any signed-in member); every write is gated
  'modules/workspaces-teams-tenancy/members.controller.ts#list',
  'modules/workspaces-teams-tenancy/members.controller.ts#summary',
  // the caller's own Available / Offline switch: both handlers read and write only the row of the signed-in user (ctx.userId in the service,
  // never an id from the request), so there is no one else's data to protect; a key would only make some role unable to go offline
  'modules/workspaces-teams-tenancy/members.controller.ts#myAvailability',
  'modules/workspaces-teams-tenancy/members.controller.ts#setMyAvailability',
  'modules/workspaces-teams-tenancy/teams.controller.ts#list',
  // the plan picker: viewing the plans is open to every member (Reference: Authenticate only); changing the plan needs plan.subscription.manage
  'modules/plans-subscriptions-trials/billing.controller.ts#plans',
  // the in-app help articles: any signed-in member may mark one helpful (the service refuses an anonymous caller; one changeable vote per user)
  'modules/marketing-site-cms/workspace-cms.controller.ts#vote',
];

const root = join(__dirname, '../../../src');

function controllerFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return controllerFiles(full);
    return entry.name.endsWith('.controller.ts') ? [full] : [];
  });
}

const files = controllerFiles(root).sort();

interface Route {
  file: string;
  handler: string;
  gated: boolean;
}

// `@V1Controller(...)` is the customer REST API's controller decorator: `@Public()` plus the API-key guard, scopes per route.
const GATE =
  /@RequirePermission|@Public\(\)|@V1Controller\(|@UseGuards\([^)]*OperatorGuard|@ActorKinds\('(partner_agent|platform_operator|candidate)'/;

function routesOf(path: string): Route[] {
  // The scan splits on `\n\n`; a Windows checkout with autocrlf has `\r\n`, which would blur the chunk boundaries.
  const src = readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
  // The allow-lists use forward slashes; `relative` returns backslashes on Windows.
  const file = relative(root, path).split(sep).join('/');
  const out: Route[] = [];
  // One chunk per class: the decorators above `export class` (the tail of the previous chunk) gate every route inside it.
  const chunks = src.split(/^export class /m);
  for (let i = 1; i < chunks.length; i += 1) {
    const prev = chunks[i - 1]!;
    const classDecorators = prev.slice(Math.max(prev.lastIndexOf('\n\n'), 0));
    const classLevel = GATE.test(classDecorators);
    const body = chunks[i]!;
    const re = /@(Get|Post|Put|Patch|Delete)\(/g;
    for (let m = re.exec(body); m; m = re.exec(body)) {
      const start = Math.max(body.lastIndexOf('\n\n', m.index), 0);
      const end = body.indexOf('\n  async ', m.index);
      if (end === -1) continue;
      const handler = /\n {2}async (\w+)/.exec(body.slice(end))?.[1] ?? '?';
      out.push({ file, handler, gated: classLevel || GATE.test(body.slice(start, end)) });
    }
  }
  return out;
}

describe('every workspace route is gated by a permission', () => {
  const ungated = files.flatMap(routesOf).filter((r) => !r.gated);
  const unexplained = ungated.filter(
    (r) => !SELF_SERVICE[r.file] && !SELF_SERVICE_HANDLERS.includes(`${r.file}#${r.handler}`),
  );

  it('scans controllers', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('has no ungated route outside the documented self-service list', () => {
    expect(unexplained.map((r) => `${r.file}#${r.handler}`)).toEqual([]);
  });

  it('keeps the self-service list honest: every entry still has an ungated route', () => {
    const used = new Set(ungated.map((r) => r.file));
    expect(Object.keys(SELF_SERVICE).filter((f) => !used.has(f))).toEqual([]);
  });
});
