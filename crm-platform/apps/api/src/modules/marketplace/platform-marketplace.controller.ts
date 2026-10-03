import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  approveMarketVersionSchema,
  createMarketAppSchema,
  createMarketCategorySchema,
  killMarketAppSchema,
  marketAppRefSchema,
  marketOperatorAppDetailQuerySchema,
  marketOperatorAppListQuerySchema,
  marketOperatorRequestListQuerySchema,
  publishMarketAppSchema,
  rejectMarketVersionSchema,
  saveMarketVersionSchema,
  updateMarketAppSchema,
  updateMarketCategorySchema,
  updateMarketRequestSchema,
  uuidSchema,
  type ApproveMarketVersionInput,
  type CreateMarketAppInput,
  type CreateMarketCategoryInput,
  type KillMarketAppInput,
  type MarketOperatorAppListQuery,
  type MarketOperatorRequestListQuery,
  type PublishMarketAppInput,
  type RejectMarketVersionInput,
  type SaveMarketVersionInput,
  type UpdateMarketAppInput,
  type UpdateMarketCategoryInput,
  type UpdateMarketRequestInput,
} from '@crm/contracts';
import { ActorKinds } from '../../common/decorators';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { OperatorGuard } from '../auth';
import { PlatformPermission, PlatformPermissionGuard } from '../roles-permissions';
import { OperatorCatalogueService } from './operator-catalogue.service';
import { OperatorInsightsService } from './operator-insights.service';

function operatorId(): number {
  const id = RequestContextStore.require().actorId;
  if (!id) throw AppError.unauthenticated();
  return id;
}

/** Either permission reads the catalogue; operating it is `manage`, deciding on a version is `review`. */
const READ = ['platform.market.manage', 'platform.market.review'];

/**
 * The operator's Marketplace (`/v2/platform/marketplace`): the catalogue, its review and publish flow, hide and kill, the categories, the
 * requests report and usage per app. Secrets never appear: a recipe holds no secret, and installations are not reachable from here.
 * Literal paths come before the `:ref` and `:id` routes.
 */
@ApiTags('platform')
@ActorKinds('platform_operator')
@UseGuards(OperatorGuard, PlatformPermissionGuard)
@Controller({ path: 'platform/marketplace', version: '2' })
export class PlatformMarketplaceController {
  constructor(
    private readonly catalogue: OperatorCatalogueService,
    private readonly insights: OperatorInsightsService,
  ) {}

  // --- categories -----------------------------------------------------------------------------------------------------------------

  @Get('categories')
  @PlatformPermission(...READ)
  @ApiOperation({ summary: 'Every category of both tabs, with the number of apps in any status' })
  categories() {
    return this.catalogue.listCategories();
  }

  @Post('categories')
  @PlatformPermission('platform.market.manage')
  @ApiOperation({ summary: 'Add a category' })
  createCategory(@Body(zodPipe(createMarketCategorySchema)) body: CreateMarketCategoryInput) {
    return this.catalogue.createCategory(body);
  }

  @Patch('categories/:id')
  @PlatformPermission('platform.market.manage')
  @ApiOperation({
    summary: 'Rename, reorder, describe, activate or deactivate a category (rowVersion required)',
  })
  updateCategory(
    @Param('id', zodPipe(uuidSchema)) id: string,
    @Body(zodPipe(updateMarketCategorySchema)) body: UpdateMarketCategoryInput,
  ) {
    return this.catalogue.updateCategory(id, body);
  }

  @Delete('categories/:id')
  @PlatformPermission('platform.market.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an empty category' })
  async deleteCategory(@Param('id', zodPipe(uuidSchema)) id: string): Promise<void> {
    await this.catalogue.deleteCategory(id);
  }

  // --- requests and usage ------------------------------------------------------------------------------------------------------------

  @Get('requests')
  @PlatformPermission(...READ)
  @ApiOperation({
    summary:
      'The integrations workspaces asked for, most voted first, with notes and the first workspace to ask',
  })
  requests(
    @Query(zodPipe(marketOperatorRequestListQuerySchema)) q: MarketOperatorRequestListQuery,
  ) {
    return this.insights.requests(q);
  }

  @Patch('requests/:id')
  @PlatformPermission('platform.market.manage')
  @ApiOperation({
    summary:
      'Triage a request: planned, building, shipped or declined, with a note (rowVersion required)',
  })
  updateRequest(
    @Param('id', zodPipe(uuidSchema)) id: string,
    @Body(zodPipe(updateMarketRequestSchema)) body: UpdateMarketRequestInput,
  ) {
    return this.insights.updateRequest(id, body);
  }

  @Get('usage')
  @PlatformPermission(...READ)
  @ApiOperation({
    summary:
      'Per app: installations by status and health, deliveries accepted, repeated and failed in 24 hours and 7 days',
  })
  usage() {
    return this.insights.usage();
  }

  // --- listings ----------------------------------------------------------------------------------------------------------------------

  @Get('apps')
  @PlatformPermission(...READ)
  @ApiOperation({ summary: 'Every listing in any status (keyset paging)' })
  apps(@Query(zodPipe(marketOperatorAppListQuerySchema)) q: MarketOperatorAppListQuery) {
    return this.catalogue.listApps(q);
  }

  @Post('apps')
  @PlatformPermission('platform.market.manage')
  @ApiOperation({
    summary:
      'Create a listing from a manifest v1 (and a recipe for an integration). It starts as a draft with its first version',
  })
  createApp(@Body(zodPipe(createMarketAppSchema)) body: CreateMarketAppInput) {
    return this.catalogue.createApp(body, operatorId());
  }

  @Get('apps/:ref')
  @PlatformPermission(...READ)
  @ApiOperation({
    summary:
      'One listing with its versions, and the manifest and recipe of the latest (or the asked-for) version',
  })
  app(
    @Param('ref', zodPipe(marketAppRefSchema)) ref: string,
    @Query(zodPipe(marketOperatorAppDetailQuerySchema)) q: { versionId?: string },
  ) {
    return this.catalogue.getApp(ref, q.versionId);
  }

  @Patch('apps/:ref')
  @PlatformPermission('platform.market.manage')
  @ApiOperation({
    summary:
      'Edit the listing: tagline, content, plan gate, featured, first-party, sort order (rowVersion required)',
  })
  updateApp(
    @Param('ref', zodPipe(marketAppRefSchema)) ref: string,
    @Body(zodPipe(updateMarketAppSchema)) body: UpdateMarketAppInput,
  ) {
    return this.catalogue.updateApp(ref, body);
  }

  @Delete('apps/:ref')
  @PlatformPermission('platform.market.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a draft listing that was never published' })
  async deleteApp(@Param('ref', zodPipe(marketAppRefSchema)) ref: string): Promise<void> {
    await this.catalogue.deleteApp(ref);
  }

  // --- versions and review -----------------------------------------------------------------------------------------------------------

  @Post('apps/:ref/versions')
  @PlatformPermission('platform.market.manage')
  @ApiOperation({
    summary:
      'Add a new version (a higher number than any before): a draft until it is approved and published',
  })
  saveVersion(
    @Param('ref', zodPipe(marketAppRefSchema)) ref: string,
    @Body(zodPipe(saveMarketVersionSchema)) body: SaveMarketVersionInput,
  ) {
    return this.catalogue.saveVersion(ref, body, operatorId());
  }

  @Put('apps/:ref/versions/:versionId')
  @PlatformPermission('platform.market.manage')
  @ApiOperation({ summary: 'Replace the manifest and recipe of a draft or rejected version' })
  updateVersion(
    @Param('ref', zodPipe(marketAppRefSchema)) ref: string,
    @Param('versionId', zodPipe(uuidSchema)) versionId: string,
    @Body(zodPipe(saveMarketVersionSchema)) body: SaveMarketVersionInput,
  ) {
    return this.catalogue.updateVersion(ref, versionId, body);
  }

  @Post('apps/:ref/versions/:versionId/submit')
  @PlatformPermission('platform.market.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Submit a draft or rejected version for review' })
  submit(
    @Param('ref', zodPipe(marketAppRefSchema)) ref: string,
    @Param('versionId', zodPipe(uuidSchema)) versionId: string,
  ) {
    return this.catalogue.submit(ref, versionId);
  }

  @Post('apps/:ref/versions/:versionId/approve')
  @PlatformPermission('platform.market.review')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve a version (it can then be published)' })
  approve(
    @Param('ref', zodPipe(marketAppRefSchema)) ref: string,
    @Param('versionId', zodPipe(uuidSchema)) versionId: string,
    @Body(zodPipe(approveMarketVersionSchema)) body: ApproveMarketVersionInput,
  ) {
    return this.catalogue.approve(ref, versionId, body, operatorId());
  }

  @Post('apps/:ref/versions/:versionId/reject')
  @PlatformPermission('platform.market.review')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject a version with the reason the developer sees' })
  reject(
    @Param('ref', zodPipe(marketAppRefSchema)) ref: string,
    @Param('versionId', zodPipe(uuidSchema)) versionId: string,
    @Body(zodPipe(rejectMarketVersionSchema)) body: RejectMarketVersionInput,
  ) {
    return this.catalogue.reject(ref, versionId, body, operatorId());
  }

  // --- publish, hide, kill -------------------------------------------------------------------------------------------------------------

  @Post('apps/:ref/publish')
  @PlatformPermission('platform.market.review')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Publish an approved version: new installs get it; installs it asks no more of move to it, the rest wait for consent',
  })
  publish(
    @Param('ref', zodPipe(marketAppRefSchema)) ref: string,
    @Body(zodPipe(publishMarketAppSchema)) body: PublishMarketAppInput,
  ) {
    return this.catalogue.publish(ref, body, operatorId());
  }

  @Post('apps/:ref/hide')
  @PlatformPermission('platform.market.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Take a published listing out of browse and search. Existing installations keep working',
  })
  hide(@Param('ref', zodPipe(marketAppRefSchema)) ref: string) {
    return this.catalogue.hide(ref);
  }

  @Post('apps/:ref/unhide')
  @PlatformPermission('platform.market.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Show a hidden listing again' })
  unhide(@Param('ref', zodPipe(marketAppRefSchema)) ref: string) {
    return this.catalogue.unhide(ref);
  }

  @Post('apps/:ref/kill')
  @PlatformPermission('platform.market.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'The kill switch: withdraw the listing and switch off every installation of the app, in one transaction',
    description:
      'Each workspace gets an audit row and an outbox event. Connections stop answering at once.',
  })
  kill(
    @Param('ref', zodPipe(marketAppRefSchema)) ref: string,
    @Body(zodPipe(killMarketAppSchema)) body: KillMarketAppInput,
  ) {
    return this.catalogue.kill(ref, body, operatorId());
  }

  @Post('apps/:ref/unkill')
  @PlatformPermission('platform.market.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Move a killed listing to hidden so it can be fixed and published again (killed installations stay off)',
  })
  unkill(@Param('ref', zodPipe(marketAppRefSchema)) ref: string) {
    return this.catalogue.unkill(ref);
  }
}
