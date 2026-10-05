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
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  configureInstallationSchema,
  consentInstallationSchema,
  createMarketRequestSchema,
  installAppSchema,
  installationStateActionSchema,
  marketAppListQuerySchema,
  marketAppRefSchema,
  marketCategoryListQuerySchema,
  marketConnectionEventsQuerySchema,
  marketInstallationListQuerySchema,
  marketRequestListQuerySchema,
  marketShelvesQuerySchema,
  sendSampleLeadSchema,
  subscribeAppSchema,
  uninstallAppSchema,
  uuidSchema,
  type ConfigureInstallationInput,
  type ConsentInstallationInput,
  type CreateMarketRequestInput,
  type InstallAppInput,
  type InstallationStateActionInput,
  type MarketAppListQuery,
  type MarketCategoryListQuery,
  type MarketConnectionEventsQuery,
  type MarketInstallationListQuery,
  type MarketRequestListQuery,
  type SendSampleLeadInput,
  type SubscribeAppInput,
  type UninstallAppInput,
} from '@crm/contracts';
import { Idempotent, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { RequirePlanFeature } from '../plans-subscriptions-trials';
import { BrowseService } from './browse.service';
import { InstallationsService } from './installations.service';
import { PullSyncService } from './pull-sync.service';
import { RequestsService } from './requests.service';
import { SubscriptionsService } from './subscriptions.service';

/**
 * The Marketplace for a workspace (`/v2/marketplace`): browse and search the catalogue, install with permission consent, configure,
 * test, pause and uninstall what the workspace has installed, and ask for an integration that is not listed.
 *
 * The plan feature `marketplace` gates the whole controller (a locked workspace gets 422 PLAN_FEATURE_LOCKED with the upgrade link).
 * Reading needs `market.apps.read`; installing, accepting a new version's permissions and uninstalling need `market.apps.install`;
 * configuring, pausing, testing, sending a sample lead and rotating a secret need `market.apps.manage`. Literal paths come before `:id`.
 */
@ApiTags('marketplace')
@RequirePlanFeature('marketplace')
@Controller({ path: 'marketplace', version: '2' })
export class MarketplaceController {
  constructor(
    private readonly browse: BrowseService,
    private readonly installations: InstallationsService,
    private readonly requests: RequestsService,
    private readonly subscriptions: SubscriptionsService,
    private readonly pullSync: PullSyncService,
  ) {}

  // --- browse -----------------------------------------------------------------------------------------------------------------------

  @Get('categories')
  @RequirePermission('market.apps.read')
  @ApiOperation({ summary: 'Categories of a tab, with the number of published apps in each' })
  categories(@Query(zodPipe(marketCategoryListQuerySchema)) q: MarketCategoryListQuery) {
    return this.browse.categories(q);
  }

  @Get('shelves')
  @RequirePermission('market.apps.read')
  @ApiOperation({ summary: 'The Popular, New and Featured shelves of a tab' })
  shelves(@Query(zodPipe(marketShelvesQuerySchema)) q: { kind: 'mini_app' | 'integration' }) {
    return this.browse.shelves(q.kind);
  }

  @Get('apps')
  @RequirePermission('market.apps.read')
  @ApiOperation({
    summary:
      'Browse and search published apps (keyset paging); an app the workspace installed carries its install state',
  })
  apps(@Query(zodPipe(marketAppListQuerySchema)) q: MarketAppListQuery) {
    return this.browse.list(q);
  }

  @Get('apps/:ref')
  @RequirePermission('market.apps.read')
  @ApiOperation({
    summary:
      'One app page: description, permissions asked, changelog, setup fields, install state and any lock',
  })
  app(@Param('ref', zodPipe(marketAppRefSchema)) ref: string) {
    return this.browse.detail(ref);
  }

  // --- install ----------------------------------------------------------------------------------------------------------------------

  @Post('apps/:ref/install')
  @RequirePermission('market.apps.install')
  @ApiOperation({
    summary:
      'Install an app after the admin confirms its permission list (acceptedScopes must equal the version scopes)',
    description:
      'The connection secret of an integration that receives deliveries is in the answer once and never again.',
  })
  install(
    @Param('ref', zodPipe(marketAppRefSchema)) ref: string,
    @Body(zodPipe(installAppSchema)) body: InstallAppInput,
  ) {
    return this.installations.install(ref, body);
  }

  // --- paid apps --------------------------------------------------------------------------------------------------------------------

  @Post('apps/:ref/subscribe')
  @RequirePermission('market.apps.install')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Subscribe to a paid app: start its free trial (startTrial) or get the checkout page to pay on. Free and included apps need nothing.',
    description:
      'Payment is the existing checkout (`/billing/checkout/<packSlug>`); the add-on it buys is what entitles the workspace.',
  })
  subscribe(
    @Param('ref', zodPipe(marketAppRefSchema)) ref: string,
    @Body(zodPipe(subscribeAppSchema)) body: SubscribeAppInput,
  ) {
    return this.subscriptions.subscribe(ref, body);
  }

  @Post('apps/:ref/subscription/cancel')
  @RequirePermission('market.apps.install')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Stop renewing a paid app. The period already paid for runs to its end, then the installation is paused and its data kept.',
  })
  cancelSubscription(@Param('ref', zodPipe(marketAppRefSchema)) ref: string) {
    return this.subscriptions.cancel(ref);
  }

  @Post('apps/:ref/subscription/resume')
  @RequirePermission('market.apps.install')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Take a cancellation back while the paid period is still running' })
  resumeSubscription(@Param('ref', zodPipe(marketAppRefSchema)) ref: string) {
    return this.subscriptions.resume(ref);
  }

  @Get('subscriptions')
  @RequirePermission('market.apps.read')
  @ApiOperation({ summary: "The workspace's own subscriptions to paid apps, newest first" })
  mySubscriptions() {
    return this.subscriptions.list();
  }

  @Get('installations')
  @RequirePermission('market.apps.read')
  @ApiOperation({
    summary:
      'What the workspace has installed, with health, and how many of the plan limit are used',
  })
  installed(@Query(zodPipe(marketInstallationListQuerySchema)) q: MarketInstallationListQuery) {
    return this.installations.list(q);
  }

  @Get('installations/:id')
  @RequirePermission('market.apps.read')
  @ApiOperation({
    summary:
      'The manage page of one installation (secrets are never returned: set, and the last four characters)',
  })
  installation(@Param('id', zodPipe(uuidSchema)) id: string) {
    return this.installations.get(id);
  }

  @Get('installations/:id/events')
  @RequirePermission('market.apps.read')
  @ApiOperation({ summary: 'Recent deliveries of the installation (delivery id, outcome, reason)' })
  events(
    @Param('id', zodPipe(uuidSchema)) id: string,
    @Query(zodPipe(marketConnectionEventsQuerySchema)) q: MarketConnectionEventsQuery,
  ) {
    return this.installations.events(id, q);
  }

  @Post('installations/:id/consent')
  @RequirePermission('market.apps.install')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Accept the permission list of a newer version that asks for more than was granted',
  })
  consent(
    @Param('id', zodPipe(uuidSchema)) id: string,
    @Body(zodPipe(consentInstallationSchema)) body: ConsentInstallationInput,
  ) {
    return this.installations.consent(id, body);
  }

  @Patch('installations/:id')
  @RequirePermission('market.apps.manage')
  @ApiOperation({
    summary:
      'Change the configuration or the credentials (absent secrets keep their value; rowVersion required)',
  })
  configure(
    @Param('id', zodPipe(uuidSchema)) id: string,
    @Body(zodPipe(configureInstallationSchema)) body: ConfigureInstallationInput,
  ) {
    return this.installations.configure(id, body);
  }

  @Post('installations/:id/disable')
  @RequirePermission('market.apps.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Pause the installation: its connection stops accepting deliveries until it is enabled again',
  })
  disable(
    @Param('id', zodPipe(uuidSchema)) id: string,
    @Body(zodPipe(installationStateActionSchema)) body: InstallationStateActionInput,
  ) {
    return this.installations.setEnabled(id, false, body.rowVersion);
  }

  @Post('installations/:id/enable')
  @RequirePermission('market.apps.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resume a paused installation' })
  enable(
    @Param('id', zodPipe(uuidSchema)) id: string,
    @Body(zodPipe(installationStateActionSchema)) body: InstallationStateActionInput,
  ) {
    return this.installations.setEnabled(id, true, body.rowVersion);
  }

  @Post('installations/:id/test')
  @RequirePermission('market.apps.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Test the connection; the result also updates the installation health' })
  test(@Param('id', zodPipe(uuidSchema)) id: string) {
    return this.installations.test(id);
  }

  @Post('installations/:id/sync')
  @RequirePermission('market.apps.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Sync now: bring the next poll of a pull connection forward, as soon as the portal allows; a stopped connection is started again',
  })
  sync(@Param('id', zodPipe(uuidSchema)) id: string) {
    return this.pullSync.syncNow(id);
  }

  @Post('installations/:id/sample')
  @RequirePermission('market.apps.manage')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Send one of the recipe sample payloads through the whole path, as a real lead with a delivery id of its own',
  })
  sample(
    @Param('id', zodPipe(uuidSchema)) id: string,
    @Body(zodPipe(sendSampleLeadSchema)) body: SendSampleLeadInput,
  ) {
    return this.installations.sample(id, body);
  }

  @Post('installations/:id/rotate-secret')
  @RequirePermission('market.apps.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'A new connection secret (shown once); the old one stops working at once',
  })
  rotate(
    @Param('id', zodPipe(uuidSchema)) id: string,
    @Body(zodPipe(installationStateActionSchema)) body: InstallationStateActionInput,
  ) {
    return this.installations.rotateSecret(id, body.rowVersion);
  }

  @Post('installations/:id/uninstall')
  @RequirePermission('market.apps.install')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Uninstall: access ends at once; the keep-or-delete-data choice is recorded and announced',
  })
  async uninstall(
    @Param('id', zodPipe(uuidSchema)) id: string,
    @Body(zodPipe(uninstallAppSchema)) body: UninstallAppInput,
  ): Promise<void> {
    await this.installations.uninstall(id, body);
  }

  // --- requests ---------------------------------------------------------------------------------------------------------------------

  @Get('requests')
  @RequirePermission('market.apps.read')
  @ApiOperation({ summary: 'What workspaces have asked for, by votes (names and counts only)' })
  listRequests(@Query(zodPipe(marketRequestListQuerySchema)) q: MarketRequestListQuery) {
    return this.requests.list(q);
  }

  @Post('requests')
  @RequirePermission('market.apps.read')
  @ApiOperation({
    summary:
      'Ask for an integration. Asking for what exists already counts as a vote (once per workspace)',
  })
  createRequest(@Body(zodPipe(createMarketRequestSchema)) body: CreateMarketRequestInput) {
    return this.requests.create(body);
  }

  @Post('requests/:id/vote')
  @RequirePermission('market.apps.read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Vote for a request (voting twice is the same as once)' })
  vote(@Param('id', zodPipe(uuidSchema)) id: string) {
    return this.requests.vote(id);
  }

  @Delete('requests/:id/vote')
  @RequirePermission('market.apps.read')
  @ApiOperation({ summary: 'Take the workspace vote back' })
  unvote(@Param('id', zodPipe(uuidSchema)) id: string) {
    return this.requests.unvote(id);
  }
}
