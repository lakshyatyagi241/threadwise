import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ActorKinds, RequirePermission } from '../../common/decorators';
import { ProviderInfoService } from './provider-info.service';

/** What the caller's workspace may know about its WhatsApp provider. No secret, no address. */
@ApiTags('whatsapp-numbers')
@ActorKinds('user')
@Controller({ path: 'waba', version: '2' })
export class ProviderInfoController {
  constructor(private readonly info: ProviderInfoService) {}

  @Get('provider-info')
  @RequirePermission('waba.numbers.read', 'waba.numbers.connect')
  @ApiOperation({
    summary: 'Which provider new numbers connect through and which one each number is on',
  })
  read() {
    return this.info.forWorkspace();
  }
}
