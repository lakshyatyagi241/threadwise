import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  adjustWalletSchema,
  importRatesSchema,
  platformWalletListQuerySchema,
  pricePreviewQuerySchema,
  savePlanMarginsSchema,
  saveWorkspaceMarginsSchema,
  saveRatesSchema,
  syncMetaSchema,
  updateSwitchesSchema,
  updateWalletSettingsSchema,
  walletLogQuerySchema,
  type AdjustWalletInput,
  type ImportRatesInput,
  type PlatformWalletListQuery,
  type PricePreviewQuery,
  type SavePlanMarginsInput,
  type SaveWorkspaceMarginsInput,
  type SaveRatesInput,
  type SyncMetaInput,
  type UpdateSwitchesInput,
  type UpdateWalletSettingsInput,
  type WalletLogQuery,
} from '@crm/contracts';
import { ActorKinds, Idempotent } from '../../common/decorators';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { OperatorGuard, OperatorRoles, PlatformSettingsService } from '../auth';
import { PlatformMarginsService } from './platform-margins.service';
import { PlatformRatesService } from './platform-rates.service';
import { PlatformWalletService, type Operator } from './platform-wallet.service';
import { WalletSettingsService } from './wallet-settings.service';

function operatorId(): number {
  const id = RequestContextStore.require().actorId;
  if (!id) throw AppError.unauthenticated();
  return id;
}

/**
 * The operator's wallet console (TW-WALLET-003 to -008, -031): message pricing, the rate card, every workspace's wallet, the
 * manual adjustment and the trail. Every operator role reads; only super admins change anything, and each change writes a
 * log row naming them.
 */
@ApiTags('platform')
@ActorKinds('platform_operator')
@UseGuards(OperatorGuard)
@Controller({ path: 'platform/wallet', version: '2' })
export class PlatformWalletController {
  constructor(
    private readonly wallets: PlatformWalletService,
    private readonly rates: PlatformRatesService,
    private readonly margins: PlatformMarginsService,
    private readonly settings: WalletSettingsService,
    private readonly platform: PlatformSettingsService,
  ) {}

  private async me(): Promise<Operator> {
    return this.wallets.operator(operatorId());
  }

  @Get('overview')
  @ApiOperation({
    summary:
      'Float, low-balance count and the last 30 days of top-ups, charges, refunds and adjustments',
  })
  async overview() {
    return this.wallets.overview();
  }

  // --- settings ----------------------------------------------------------------------------------------------------------------

  @Get('settings')
  @ApiOperation({
    summary:
      'Flat price, referral reward, alert threshold, launch coverage and the two master switches',
  })
  async getSettings() {
    const doc = await this.platform.get<{ connection?: { ratesEndpoint?: string } }>(
      'bsp.reseller',
    );
    return this.settings.view(Boolean(doc?.connection?.ratesEndpoint));
  }

  @Put('settings')
  @OperatorRoles('super_admin')
  @ApiOperation({ summary: 'Save the three economics numbers and the launch coverage' })
  async saveSettings(@Body(zodPipe(updateWalletSettingsSchema)) body: UpdateWalletSettingsInput) {
    await this.settings.saveEconomics(body, await this.me());
    return this.getSettings();
  }

  @Put('switches')
  @OperatorRoles('super_admin')
  @ApiOperation({
    summary: 'Turn per-country pricing and pay-per-message mode on or off',
    description: 'Saved apart from the rates: saving the grid never changes a switch.',
  })
  async saveSwitches(@Body(zodPipe(updateSwitchesSchema)) body: UpdateSwitchesInput) {
    await this.settings.saveSwitches(body, await this.me());
    return this.getSettings();
  }

  // --- rates -------------------------------------------------------------------------------------------------------------------

  @Get('rates')
  @ApiOperation({ summary: 'The per-country x category rate card with Meta cost and margin' })
  async listRates() {
    return this.rates.list();
  }

  @Put('rates')
  @OperatorRoles('super_admin')
  @ApiOperation({
    summary: 'Save rate rows (a row the server cannot save is reported with its reason)',
  })
  async saveRates(@Body(zodPipe(saveRatesSchema)) body: SaveRatesInput) {
    return this.rates.save(body.rows, await this.me());
  }

  @Delete('rates/:id')
  @OperatorRoles('super_admin')
  @ApiOperation({ summary: 'Remove a rate row' })
  async deleteRate(@Param('id', ParseUUIDPipe) id: string) {
    return { deleted: await this.rates.remove(id, await this.me()) };
  }

  @Post('rates/seed')
  @HttpCode(HttpStatus.OK)
  @OperatorRoles('super_admin')
  @ApiOperation({ summary: 'Re-apply the starter rate card (resets the prices of ten rows)' })
  async seed() {
    return { upserted: await this.rates.seed(await this.me()) };
  }

  @Post('rates/import')
  @HttpCode(HttpStatus.OK)
  @OperatorRoles('super_admin')
  @ApiOperation({
    summary:
      'Import a rate-card CSV (Meta wide format or long format). `dryRun` previews without writing',
  })
  async importRates(@Body(zodPipe(importRatesSchema)) body: ImportRatesInput) {
    return this.rates.import(body.csv, body.dryRun, await this.me());
  }

  @Post('rates/sync-meta')
  @HttpCode(HttpStatus.OK)
  @OperatorRoles('super_admin')
  @ApiOperation({
    summary:
      'Load Meta wholesale costs (live endpoint, else the bundled indicative card). Customer prices are not touched',
  })
  async syncMeta(@Body(zodPipe(syncMetaSchema)) body: SyncMetaInput) {
    return this.rates.syncMeta(body.dryRun, await this.me());
  }

  // --- margin pricing: Meta cost + our margin ---------------------------------------------------------------------------------

  @Get('margins')
  @ApiOperation({
    summary:
      'Margins over Meta cost per country and category, for one plan (`plan=`) or the platform default (`plan` blank)',
  })
  async listMargins(@Query('plan') plan?: string) {
    return this.margins.listPlan((plan ?? '').trim());
  }

  @Put('margins')
  @OperatorRoles('super_admin')
  @ApiOperation({
    summary:
      'Save margins for a plan or the platform default (per-row reasons for a row that cannot be saved)',
  })
  async saveMargins(@Body(zodPipe(savePlanMarginsSchema)) body: SavePlanMarginsInput) {
    return this.margins.savePlan(body.planSlug, body.rows, await this.me());
  }

  @Delete('margins/:id')
  @OperatorRoles('super_admin')
  @ApiOperation({ summary: 'Remove a plan or platform margin row' })
  async deleteMargin(@Param('id', ParseUUIDPipe) id: string) {
    return { deleted: await this.margins.removePlan(id, await this.me()) };
  }

  @Get('workspaces/:id/margins')
  @ApiOperation({
    summary: "One workspace's margin overrides (the ones that beat its plan's margins)",
  })
  async workspaceMargins(@Param('id', ParseUUIDPipe) id: string) {
    return this.margins.listWorkspace(await this.margins.orgIdOf(id), id);
  }

  @Put('workspaces/:id/margins')
  @OperatorRoles('super_admin')
  @ApiOperation({
    summary: "Set or remove a workspace's margin overrides. A note saying why is mandatory",
    description:
      'Written to the workspace wallet log and the audit trail with the old and new margins.',
  })
  async saveWorkspaceMargins(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(saveWorkspaceMarginsSchema)) body: SaveWorkspaceMarginsInput,
  ) {
    return this.margins.saveWorkspace(await this.margins.orgIdOf(id), body, await this.me());
  }

  @Get('pricing/preview')
  @ApiOperation({
    summary:
      'How one message would be priced (Meta cost, which margin matched and from which layer, the price)',
    description:
      'Pass `workspaceId` to price it for that workspace (its override, its plan); without it, the platform default applies.',
  })
  async pricePreview(@Query(zodPipe(pricePreviewQuerySchema)) q: PricePreviewQuery) {
    return this.margins.preview(
      q,
      q.workspaceId ? await this.margins.orgIdOf(q.workspaceId) : null,
    );
  }

  // --- workspaces' wallets ---------------------------------------------------------------------------------------------------

  @Get('workspaces')
  @ApiOperation({
    summary: 'Every workspace with its balance (cursor paginated), plus platform totals',
  })
  async workspaces(@Query(zodPipe(platformWalletListQuerySchema)) q: PlatformWalletListQuery) {
    return this.wallets.list(q);
  }

  @Get('workspaces/:id')
  @ApiOperation({
    summary: 'One workspace wallet with its recent entries and who made each manual adjustment',
  })
  async workspace(@Param('id', ParseUUIDPipe) id: string) {
    return this.wallets.detail(id);
  }

  @Post('workspaces/:id/adjust')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @OperatorRoles('super_admin')
  @ApiOperation({
    summary: 'Add money to, or take money from, a workspace wallet. A note saying why is mandatory',
    description:
      'Needs an Idempotency-Key header. A debit never takes the wallet below 0: the response says requested versus applied. The note is shown to the workspace and written to the audit trail.',
  })
  async adjust(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(adjustWalletSchema)) body: AdjustWalletInput,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    if (!key || key.length > 120)
      throw new BadRequestException('An Idempotency-Key header is required');
    return this.wallets.adjust(id, body, await this.me(), key);
  }

  // --- trail and checks --------------------------------------------------------------------------------------------------------

  @Get('logs')
  @ApiOperation({
    summary:
      'The wallet trail: events of workspaces and what operators changed, newest first (cursor paginated)',
  })
  async logs(@Query(zodPipe(walletLogQuerySchema)) q: WalletLogQuery) {
    return this.wallets.logs(q);
  }

  @Post('reconciliation')
  @HttpCode(HttpStatus.OK)
  @OperatorRoles('super_admin')
  @ApiOperation({ summary: 'Check every wallet balance against the sum of its ledger now' })
  async reconcile() {
    return this.wallets.reconcile();
  }
}
