import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  bulkDeleteCampaignsSchema,
  createCampaignSchema,
  updateCampaignSchema,
  type BulkDeleteCampaignsInput,
  type CreateCampaignInput,
  type UpdateCampaignInput,
} from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { CampaignsActionsService } from './campaigns-actions.service';
import { CampaignsService } from './campaigns.service';

/** Create, edit and delete campaigns (WD-CAMP-003 to 010, 018). */
@ApiTags('campaigns')
@ActorKinds('user')
@Controller({ path: 'campaigns', version: '2' })
export class CampaignsController {
  constructor(
    private readonly campaigns: CampaignsService,
    private readonly actions: CampaignsActionsService,
  ) {}

  @Post()
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('camp.campaigns.create')
  @ApiOperation({
    summary: 'Create a campaign and, for "send now", start it',
    description:
      'The audience is the union of contactIds, groupIds, tagIds, typed numbers and an uploaded CSV. 422 CAMP_NO_RECIPIENTS when ' +
      'nobody is on it (unless the status is draft), CAMP_TEMPLATE_NOT_ALLOWED for a template that cannot be campaigned, ' +
      'CAMP_EXPIRY_BEFORE_SEND when the end date is not after the send date.',
  })
  create(@Body(zodPipe(createCampaignSchema)) body: CreateCampaignInput) {
    return this.campaigns.create(body);
  }

  @Post('bulk-delete')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('camp.campaigns.delete')
  @ApiOperation({ summary: 'Delete several campaigns of this workspace and their recipients' })
  bulkDelete(@Body(zodPipe(bulkDeleteCampaignsSchema)) body: BulkDeleteCampaignsInput) {
    return this.actions.bulkDelete(body);
  }

  @Put(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('camp.campaigns.update')
  @ApiOperation({
    summary: 'Edit a draft, scheduled or paused campaign',
    description:
      '422 CAMP_NOT_EDITABLE for any other status. An audience that is sent and not empty replaces the recipients.',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateCampaignSchema)) body: UpdateCampaignInput,
  ) {
    return this.campaigns.update(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('camp.campaigns.delete')
  @ApiOperation({ summary: 'Delete a campaign and its recipients, in any status' })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.actions.remove(id);
  }
}
