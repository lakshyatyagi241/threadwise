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
import { linkIgAccountSchema, type LinkIgAccountInput } from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { AccountsService } from './accounts.service';
import { RequirePlanFeature } from '../plans-subscriptions-trials';

/** Instagram accounts: the hub, the picker, link, connect new and unlink (WD-IG-001 to 006). */
@ApiTags('instagram')
@ActorKinds('user')
// Instagram management is entirely the extra-channels feature; the public inbound controller stays open.
@RequirePlanFeature('extra_channels')
@Controller({ path: 'instagram', version: '2' })
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get('accounts')
  @RequirePermission('ig.accounts.read')
  @ApiOperation({ summary: "The workspace's linked Instagram accounts and the engine behind them" })
  list() {
    return this.accounts.list();
  }

  @Get('accounts/available')
  @RequirePermission('ig.accounts.manage')
  @ApiOperation({
    summary: 'Accounts the signed-in person owns on the engine and has not linked here',
    description: 'Empty when the engine is off or the person has no email on file.',
  })
  available() {
    return this.accounts.available();
  }

  @Post('accounts')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('ig.accounts.manage')
  @ApiOperation({
    summary: 'Link an account, or refresh the profile of one already linked',
    description:
      '422 IG_NOT_CONNECTED when the engine is off; 404 IG_ACCOUNT_NOT_FOUND when the engine does not list the account to this workspace or person.',
  })
  link(@Body(zodPipe(linkIgAccountSchema)) body: LinkIgAccountInput) {
    return this.accounts.link(body);
  }

  @Post('connect/start')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('ig.accounts.manage')
  @ApiOperation({
    summary: "The engine's sign-in popup address for connecting a new account",
    description:
      '422 IG_NOT_CONNECTED when the engine is off; 502 IG_CONNECT_FAILED when it refuses.',
  })
  connectStart() {
    return this.accounts.connectStart();
  }

  @Delete('accounts/:id')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('ig.accounts.manage')
  @ApiOperation({
    summary:
      'Unlink an account; with the last one, every Instagram thread of the workspace is deleted',
  })
  unlink(@Param('id', ParseUUIDPipe) id: string) {
    return this.accounts.unlink(id);
  }
}
