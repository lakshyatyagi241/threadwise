import {
  Body,
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
import {
  fbConnectEmbeddedSchema,
  fbConnectManualSchema,
  type FbConnectEmbeddedInput,
  type FbConnectManualInput,
} from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { PagesService } from './pages.service';
import { RequirePlanFeature } from '../plans-subscriptions-trials';

/** Facebook Pages: connect an account, then refresh, fix inbound and disconnect each Page (TW-FB-001 to 004). */
@ApiTags('facebook')
@ActorKinds('user')
// Facebook management is entirely the extra-channels feature; the public webhook controller stays open.
@RequirePlanFeature('extra_channels')
@Controller({ path: 'facebook', version: '2' })
export class PagesController {
  constructor(private readonly pages: PagesService) {}

  @Get('config')
  @RequirePermission('fb.pages.read')
  @ApiOperation({
    summary:
      'What the hub needs to connect: the public app id, the login configuration and the webhook address',
  })
  config() {
    return this.pages.connectConfig();
  }

  @Get('pages')
  @RequirePermission('fb.pages.read')
  @ApiOperation({ summary: "The workspace's connected Pages (never any token)" })
  list() {
    return this.pages.list();
  }

  @Post('connect/start')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('fb.pages.manage')
  @ApiOperation({
    summary: 'The Facebook login address; the browser is sent there and comes back to the callback',
    description: '422 FB_NOT_CONFIGURED when no Meta app is set on this install.',
  })
  start() {
    return this.pages.startLogin();
  }

  @Post('connect/embedded')
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('fb.pages.manage')
  @ApiOperation({
    summary: "Connect from the popup's code: every Page the account manages is stored",
    description:
      '422 FB_CODE_REJECTED when Meta refuses the code; 422 FB_NO_PAGES when the account manages none.',
  })
  embedded(@Body(zodPipe(fbConnectEmbeddedSchema)) body: FbConnectEmbeddedInput) {
    return this.pages.connectEmbedded(body.code);
  }

  @Post('connect/manual')
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('fb.pages.manage')
  @ApiOperation({
    summary: 'Connect one Page from a pasted Page access token',
    description: '422 FB_TOKEN_NOT_A_PAGE when the token does not resolve to a Page.',
  })
  manual(@Body(zodPipe(fbConnectManualSchema)) body: FbConnectManualInput) {
    return this.pages.connectManual(body.pageAccessToken);
  }

  @Post('pages/:id/refresh')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('fb.pages.manage')
  @ApiOperation({
    summary: "Re-read the Page's name, picture and followers",
    description: '422 FB_REFRESH_FAILED when Meta does not answer (the token may need re-auth).',
  })
  refresh(@Param('id', ParseUUIDPipe) id: string) {
    return this.pages.refresh(id);
  }

  @Post('pages/:id/resubscribe')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('fb.pages.manage')
  @ApiOperation({
    summary: 'Subscribe the Page to the webhook again ("Fix inbound")',
    description: 'A refusal is a 200 with `error` set.',
  })
  resubscribe(@Param('id', ParseUUIDPipe) id: string) {
    return this.pages.resubscribe(id);
  }

  @Delete('pages/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('fb.pages.manage')
  @ApiOperation({
    summary:
      'Disconnect a Page: the webhook is unsubscribed and the Page removed; inbox threads stay',
  })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.pages.remove(id);
  }
}
