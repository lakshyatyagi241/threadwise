import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  saveGetStartedSchema,
  saveGreetingSchema,
  saveIceBreakersSchema,
  saveMenuSchema,
  type SaveGetStartedInput,
  type SaveGreetingInput,
  type SaveIceBreakersInput,
  type SaveMenuInput,
} from '@crm/contracts';
import { ActorKinds, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { SetupService } from './setup.service';
import { RequirePlanFeature } from '../plans-subscriptions-trials';

/**
 * Messenger setup: Get Started, greeting, persistent menu, ice breakers (WD-FB-015). Each piece is saved straight to Meta and can be
 * removed. 422 `FB_PAGE_UNAVAILABLE` for a Page that is not connected; 422 `FB_SETUP_REJECTED` with Meta's reason when it refuses a
 * change; 422 `FB_SETUP_UNSUPPORTED` when the Graph version no longer has the welcome greeting.
 */
@ApiTags('facebook')
@ActorKinds('user')
// Facebook management is entirely the extra-channels feature; the public webhook controller stays open.
@RequirePlanFeature('extra_channels')
@Controller({ path: 'facebook/setup', version: '2' })
export class SetupController {
  constructor(private readonly setup: SetupService) {}

  @Get()
  @RequirePermission('fb.setup.manage')
  @ApiQuery({
    name: 'page',
    required: false,
    description: 'A Page id; the first connected Page when absent.',
  })
  @ApiOperation({ summary: "The connected Pages and the picked Page's live Messenger profile" })
  view(@Query('page', new ParseUUIDPipe({ optional: true })) page: string | undefined) {
    return this.setup.view(page);
  }

  @Put(':pageId/get-started')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('fb.setup.manage')
  @ApiOperation({ summary: 'Save the Get Started button (a blank payload removes it)' })
  saveGetStarted(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Body(zodPipe(saveGetStartedSchema)) body: SaveGetStartedInput,
  ) {
    return this.setup.saveGetStarted(pageId, body);
  }

  @Delete(':pageId/get-started')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('fb.setup.manage')
  @ApiOperation({ summary: 'Remove the Get Started button' })
  deleteGetStarted(@Param('pageId', ParseUUIDPipe) pageId: string) {
    return this.setup.deleteGetStarted(pageId);
  }

  @Put(':pageId/greeting')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('fb.setup.manage')
  @ApiOperation({ summary: 'Save the welcome greeting (cut to 160 characters; blank removes it)' })
  saveGreeting(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Body(zodPipe(saveGreetingSchema)) body: SaveGreetingInput,
  ) {
    return this.setup.saveGreeting(pageId, body);
  }

  @Delete(':pageId/greeting')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('fb.setup.manage')
  @ApiOperation({ summary: 'Remove the welcome greeting' })
  deleteGreeting(@Param('pageId', ParseUUIDPipe) pageId: string) {
    return this.setup.deleteGreeting(pageId);
  }

  @Put(':pageId/menu')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('fb.setup.manage')
  @ApiOperation({
    summary: 'Save the persistent menu (at most three items; no usable item removes it)',
    description: 'A menu needs a Get Started button: one is created when the Page has none.',
  })
  saveMenu(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Body(zodPipe(saveMenuSchema)) body: SaveMenuInput,
  ) {
    return this.setup.saveMenu(pageId, body);
  }

  @Delete(':pageId/menu')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('fb.setup.manage')
  @ApiOperation({ summary: 'Remove the persistent menu' })
  deleteMenu(@Param('pageId', ParseUUIDPipe) pageId: string) {
    return this.setup.deleteMenu(pageId);
  }

  @Put(':pageId/ice-breakers')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('fb.setup.manage')
  @ApiOperation({ summary: 'Save the ice breakers (at most four; none removes them all)' })
  saveIceBreakers(
    @Param('pageId', ParseUUIDPipe) pageId: string,
    @Body(zodPipe(saveIceBreakersSchema)) body: SaveIceBreakersInput,
  ) {
    return this.setup.saveIceBreakers(pageId, body);
  }

  @Delete(':pageId/ice-breakers')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('fb.setup.manage')
  @ApiOperation({ summary: 'Remove all ice breakers' })
  deleteIceBreakers(@Param('pageId', ParseUUIDPipe) pageId: string) {
    return this.setup.deleteIceBreakers(pageId);
  }
}
