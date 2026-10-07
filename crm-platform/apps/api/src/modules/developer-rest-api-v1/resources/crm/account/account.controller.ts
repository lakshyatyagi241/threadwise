import { Get } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { RequireApiScope } from '../../../auth/api-scope';
import { ok } from '../../../http/v1-envelope';
import { V1Controller } from '../../../http/v1-controller.decorator';
import { AccountService } from './account.service';

@V1Controller('')
export class V1AccountController {
  constructor(private readonly account: AccountService) {}

  @Get('me')
  @RequireApiScope('account:read')
  @ApiOperation({ summary: 'The workspace, plan, limits and unlocked features of the key' })
  async me() {
    return ok(await this.account.me());
  }

  @Get('usage')
  @RequireApiScope('account:read')
  @ApiOperation({ summary: 'Message cycle, plan validity, meters and wallet credits' })
  async usage() {
    return ok(await this.account.usage());
  }
}
