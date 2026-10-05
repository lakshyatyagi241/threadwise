import { Body, Controller, Get, Param, ParseUUIDPipe, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  listStoreGroupsQuerySchema,
  setStoreGroupCodeSchema,
  type ListStoreGroupsQuery,
  type SetStoreGroupCodeInput,
} from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../../common/decorators';
import { zodPipe } from '../../../common/pipes/zod-validation.pipe';
import { StoreGroupsService } from './store-groups.service';

/** The WhatsApp group directory and ordering codes (WaDesk /store/groups). `summary` comes before `:id`. */
@ApiTags('store-groups')
@ActorKinds('user')
@Controller({ path: 'store/groups', version: '2' })
export class StoreGroupsController {
  constructor(private readonly groups: StoreGroupsService) {}

  @Get()
  @RequirePermission('store.groups.read')
  @ApiOperation({
    summary:
      'Groups the connected number belongs to, most recently synced first; search by subject',
  })
  async list(@Query(zodPipe(listStoreGroupsQuerySchema)) query: ListStoreGroupsQuery) {
    return this.groups.list(query);
  }

  @Get('summary')
  @RequirePermission('store.groups.read')
  @ApiOperation({ summary: 'The cards: groups, groups with a code, and the ordering number' })
  async summary() {
    return this.groups.summary();
  }

  @Get(':id')
  @RequirePermission('store.groups.read')
  @ApiOperation({ summary: 'One group' })
  async get(@Param('id', ParseUUIDPipe) id: string) {
    return this.groups.get(id);
  }

  @Put(':id/code')
  @Idempotent()
  @RequirePermission('store.groups.manage')
  @ApiOperation({
    summary: 'Set or clear a group ordering code',
    description:
      '409 `STORE_GROUP_CODE_TAKEN` when another group holds the code; a blank code clears it.',
  })
  async setCode(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(setStoreGroupCodeSchema)) body: SetStoreGroupCodeInput,
  ) {
    return this.groups.setCode(id, body);
  }
}
