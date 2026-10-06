import { Controller, UseGuards, VERSION_NEUTRAL, applyDecorators } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { Public } from '../../../common/decorators';
import { RequirePlanFeature } from '../../plans-subscriptions-trials';
import { SkipThrottle } from '../../platform-infrastructure';
import { BearerApiKeyGuard } from '../auth/bearer-api-key.guard';

/**
 * A controller of the customer REST API (`/api/v1/<path>`). One decorator so every resource gets the same four things:
 *
 *   - `@Public()`: the app-wide JWT guard stands aside; the key guard below is the authentication.
 *   - `BearerApiKeyGuard`: `Authorization: Bearer <key>` or `X-Api-Key`, the key's rate limit, scopes and plan feature (TW-API-005, 006).
 *   - `@RequirePlanFeature('public_api')`: a plan without the Public API feature gets the plan error on every route.
 *   - `@SkipThrottle()`: the per-key limit above is the limit customers are told about; the per-IP default must not stack on it.
 *   - version-neutral, so the path is exactly `/api/v1/...` (Reference's base URL) and not `/v2/api/v1/...`.
 *
 * Routes answer `{ data, meta? }` (see `v1-envelope.ts`); failures are rendered by `v1-error-renderer.ts`.
 */
/**
 * The documentation group of a path, named like Reference's services so the reference page reads the same. `me` and `usage` are the account.
 * A path that is not listed is documented under its own name.
 */
const TAG_BY_PATH: Record<string, string> = {
  '': 'Account',
  me: 'Account',
  usage: 'Account',
  messages: 'Message',
  media: 'Media',
  conversations: 'Conversation',
  contacts: 'Contact',
  'contact-groups': 'ContactGroup',
  templates: 'Template',
  'auto-replies': 'AutoReply',
  broadcasts: 'Broadcast',
  campaigns: 'Campaign',
  scheduled: 'Scheduled',
  flows: 'Flow',
  devices: 'Device',
  webhooks: 'Webhook',
  deals: 'Deal',
};

export function tagForPath(path: string): string {
  return TAG_BY_PATH[path.split('/')[0] ?? ''] ?? path;
}

export function V1Controller(path: string, tag?: string) {
  return applyDecorators(
    Public(),
    UseGuards(BearerApiKeyGuard),
    SkipThrottle(),
    // Plan feature "Public API": enforced by the key guard once the key's workspace is known (TW-API-009).
    RequirePlanFeature('public_api'),
    ApiTags(tag ?? tagForPath(path)),
    ApiBearerAuth('api-key'),
    ApiHeader({
      name: 'X-Api-Key',
      required: false,
      description: 'The key, when not sent as a bearer token.',
    }),
    Controller({ path: `api/v1/${path}`, version: VERSION_NEUTRAL }),
  );
}
