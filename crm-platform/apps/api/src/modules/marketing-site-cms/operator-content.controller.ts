import { Body, Controller, Get, Post, Put, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  applyPresetRequestSchema,
  homepageSwitchRequestSchema,
  resetRequestSchema,
  saveDraftRequestSchema,
  saveLayoutRequestSchema,
  scopeRequestSchema,
  type ApplyPresetRequest,
  type HomepageSwitchRequest,
  type ResetRequest,
  type SaveDraftRequest,
  type SaveLayoutRequest,
  type ScopeRequest,
} from '@crm/contracts';
import { ActorKinds } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { OperatorGuard, OperatorRoles } from '../auth';
import { CmsContentService } from './content.service';

/**
 * The page editor's API (TW-CMS-018..028). Every operator role reads the drafts; only super admins write. Reference
 * checked "is an admin" on the same routes and no finer permission.
 */
@ApiTags('platform')
@ActorKinds('platform_operator')
@UseGuards(OperatorGuard)
@Controller({ path: 'platform/cms/content', version: '2' })
export class OperatorContentController {
  constructor(private readonly content: CmsContentService) {}

  @Get()
  @ApiOperation({
    summary: 'Every stored row (draft and published), the pending count, the homepage switch',
  })
  get() {
    return this.content.operatorContent();
  }

  @Put('draft')
  @OperatorRoles('super_admin')
  @ApiOperation({
    summary: 'Save drafts for known keys (optionally guarded by each key’s row version)',
  })
  saveDraft(@Body(zodPipe(saveDraftRequestSchema)) body: SaveDraftRequest) {
    return this.content.saveDraft(body);
  }

  @Put('layout')
  @OperatorRoles('super_admin')
  @ApiOperation({ summary: 'Hide sections and set their order for one page (draft)' })
  saveLayout(@Body(zodPipe(saveLayoutRequestSchema)) body: SaveLayoutRequest) {
    return this.content.saveLayout(body);
  }

  @Post('publish')
  @OperatorRoles('super_admin')
  @ApiOperation({ summary: 'Make drafts live, for everything or one scope' })
  async publish(@Body(zodPipe(scopeRequestSchema)) body: ScopeRequest) {
    return { count: await this.content.publish(body.scope) };
  }

  @Post('discard')
  @OperatorRoles('super_admin')
  @ApiOperation({ summary: 'Throw away unpublished drafts, for everything or one scope' })
  async discard(@Body(zodPipe(scopeRequestSchema)) body: ScopeRequest) {
    return { count: await this.content.discard(body.scope) };
  }

  @Post('reset')
  @OperatorRoles('super_admin')
  @ApiOperation({
    summary: 'Set one key or a scope back to the shipped default (a draft: live after Publish)',
  })
  async reset(@Body(zodPipe(resetRequestSchema)) body: ResetRequest) {
    return { count: await this.content.reset(body) };
  }

  @Post('preset')
  @OperatorRoles('super_admin')
  @ApiOperation({ summary: 'Apply a brand colour preset as drafts' })
  async preset(@Body(zodPipe(applyPresetRequestSchema)) body: ApplyPresetRequest) {
    return { tokens: await this.content.applyPreset(body.preset) };
  }

  @Put('homepage')
  @OperatorRoles('super_admin')
  @ApiOperation({ summary: 'Turn the public homepage on or off (live at once, not a draft)' })
  async homepage(@Body(zodPipe(homepageSwitchRequestSchema)) body: HomepageSwitchRequest) {
    return { enabled: await this.content.setHomepageEnabled(body.enabled) };
  }
}
