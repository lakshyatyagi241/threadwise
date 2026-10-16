import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { metaLeadFormIdSchema } from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { RequirePlanFeature } from '../plans-subscriptions-trials';
import { MetaLeadAdsService } from './meta-lead-ads.service';

/**
 * Meta lead ads (spec L-06): the native door from Facebook and Instagram lead forms into the lead pipeline. It uses the Facebook
 * channel's connected Pages, so a workspace needs both plan features: `lead_sources` (the pipeline) and `extra_channels` (Facebook).
 * `leads.sources.read` sees the state; `leads.sources.manage` changes it or reads anything from Meta with the Page's token.
 */
@ApiTags('meta-lead-ads')
@ActorKinds('user')
@RequirePlanFeature('lead_sources', 'extra_channels')
@Controller({ path: 'meta-lead-ads', version: '2' })
export class MetaLeadAdsController {
  constructor(private readonly service: MetaLeadAdsService) {}

  @Get()
  @RequirePermission('leads.sources.read')
  @ApiOperation({
    summary: 'Meta lead ads: the connected Pages, their lead access and sync state',
    description:
      'Never a token or the app secret. `webhookUrl` is the address to register as the Meta app’s Page webhook callback.',
  })
  overview() {
    return this.service.overview();
  }

  @Post('connect/start')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('leads.sources.manage')
  @ApiOperation({
    summary: 'The Facebook login that asks for the lead permissions ("Grant lead access")',
    description:
      'Needs `fb.pages.manage` too (it stores Page tokens). The browser comes back to the Facebook callback and is sent on to the Social leads screen. 422 MLA_NOT_CONFIGURED when no Meta app is set.',
  })
  start() {
    return this.service.startConnect();
  }

  @Post('pages/:id/enable')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('leads.sources.manage')
  @ApiOperation({
    summary: 'Turn lead sync on for a Page: subscribe it to the `leadgen` webhook field',
    description:
      '422 MLA_LEAD_ACCESS_MISSING (re-consent), MLA_PAGE_RECONNECT (token no longer valid), MLA_SUBSCRIBE_FAILED (Meta refused or did not confirm the field).',
  })
  enable(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.enable(id);
  }

  @Post('pages/:id/disable')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('leads.sources.manage')
  @ApiOperation({
    summary: 'Turn lead sync off for a Page',
    description:
      'The `leadgen` field is removed from the Page’s subscription (the other fields stay). Picked forms and their leads are kept.',
  })
  disable(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.disable(id);
  }

  @Get('pages/:id/forms')
  @RequirePermission('leads.sources.manage')
  @ApiOperation({
    summary: 'The Page’s lead forms, read from Meta, each marked picked or not',
    description:
      'Includes each form’s questions, so the mapping screen can offer them. 422 MLA_LEAD_ACCESS_MISSING, MLA_PAGE_RECONNECT, MLA_FORMS_UNAVAILABLE.',
  })
  forms(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.listForms(id);
  }

  @Post('pages/:id/forms/:formId/connect')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('leads.sources.manage')
  @ApiOperation({
    summary: 'Pick a lead form: its lead source is made and its leads start coming in',
    description:
      'Repeating it returns the same source. 422 MLA_SYNC_OFF (turn lead sync on first), MLA_FORM_NOT_FOUND, PLAN_LIMIT_REACHED (the plan’s lead source cap).',
  })
  connect(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('formId', zodPipe(metaLeadFormIdSchema)) formId: string,
  ) {
    return this.service.connectForm(id, formId);
  }

  @Delete('pages/:id/forms/:formId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('leads.sources.manage')
  @ApiOperation({
    summary: 'Stop bringing a form’s leads in',
    description: 'Its lead source and the leads stored under it go; the contacts they made stay.',
  })
  async disconnect(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('formId', zodPipe(metaLeadFormIdSchema)) formId: string,
  ): Promise<void> {
    await this.service.disconnectForm(id, formId);
  }

  @Get('sources/:id/health')
  @RequirePermission('leads.sources.read')
  @ApiOperation({
    summary: 'Health of a lead source that is a Meta lead form',
    description: '`connected: false` when the source is not a Meta lead form.',
  })
  health(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.sourceHealth(id);
  }
}
