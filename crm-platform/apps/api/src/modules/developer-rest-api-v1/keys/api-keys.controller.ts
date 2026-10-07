import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createApiKeySchema,
  listApiKeysQuerySchema,
  type CreateApiKeyInput,
  type ListApiKeysQuery,
} from '@crm/contracts';
import { ActorKinds, RequirePermission } from '../../../common/decorators';
import { zodPipe } from '../../../common/pipes/zod-validation.pipe';
import { RequirePlanFeature } from '../../plans-subscriptions-trials';
import { ApiKeysService } from './api-keys.service';

/**
 * The Developers console's keys, for signed-in staff (WD-API-001 to 004). WaDesk let any member of the workspace open this page; the keys
 * below make it the same rule the menu already applied (owners and admins), and let a workspace widen it in its role editor.
 */
@ApiTags('developer-rest-api-v1')
@ActorKinds('user')
@Controller({ path: 'developer/keys', version: '2' })
export class ApiKeysController {
  constructor(private readonly keys: ApiKeysService) {}

  @Get()
  @RequirePermission('api.keys.read')
  @ApiOperation({ summary: "The workspace's REST API keys, newest first (never the secret)" })
  list(@Query(zodPipe(listApiKeysQuerySchema)) query: ListApiKeysQuery) {
    return this.keys.list(query);
  }

  // Not @Idempotent: the response carries the raw key, and the idempotency store would keep it for 24 hours. A double submit is
  // stopped by the active-key cap instead (WD-API-004).
  @Post()
  @RequirePermission('api.keys.create')
  @RequirePlanFeature('public_api')
  @ApiOperation({
    summary: 'Create a key',
    description:
      'The answer carries the raw key in `secret`. It is shown once and cannot be read again; only a hash and the 12-character prefix are stored.',
  })
  create(@Body(zodPipe(createApiKeySchema)) body: CreateApiKeyInput) {
    return this.keys.create(body);
  }

  @Delete(':id')
  @RequirePermission('api.keys.revoke')
  @ApiOperation({
    summary: 'Revoke a key',
    description:
      'Effective on the next call. Idempotent: a revoked key stays revoked and keeps its first revocation time.',
  })
  revoke(@Param('id', ParseUUIDPipe) id: string) {
    return this.keys.revoke(id);
  }
}
