import { Get, Param } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { RequirePlanFeature } from '../../../plans-subscriptions-trials';
import { RequireApiScope } from '../../auth/api-scope';
import { V1Controller } from '../../http/v1-controller.decorator';
import { ok } from '../../http/v1-envelope';
import { MessagingReadService } from './messaging-read.service';
import { UuidParam } from './uuid-param.pipe';

/** Devices: every WhatsApp number of the workspace (TW-API-116) and one by id (117). Stored state only: no live status probe. */
@V1Controller('devices')
@RequirePlanFeature('public_api')
export class V1DevicesController {
  constructor(private readonly reads: MessagingReadService) {}

  @Get()
  @RequireApiScope('devices:read')
  @ApiOperation({ summary: 'Unofficial numbers, then Cloud API and Twilio connections' })
  list() {
    return this.reads.listDevices();
  }

  @Get(':id')
  @RequireApiScope('devices:read')
  @ApiOperation({ summary: 'One number, by the id the list gives' })
  async get(@Param('id', new UuidParam('Device')) id: string) {
    return ok(await this.reads.getDevice(id));
  }
}
