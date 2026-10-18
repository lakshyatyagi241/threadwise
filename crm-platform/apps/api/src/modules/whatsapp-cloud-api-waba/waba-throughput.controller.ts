import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  updateWabaNumberControlSchema,
  updateWabaThroughputSettingsSchema,
  wabaThroughputListQuerySchema,
  type UpdateWabaNumberControlInput,
  type UpdateWabaThroughputSettingsInput,
  type WabaThroughputListQuery,
} from '@crm/contracts';
import { ActorKinds } from '../../common/decorators';
import { RequestContextStore } from '../../common/context/request-context';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { OperatorGuard, OperatorRoles } from '../auth';
import { WabaThroughputService } from './waba-throughput.service';

/**
 * WhatsApp send limits and live performance, in the operator console. Super admin only, like the rest of `platform/waba`: a pause or an
 * override changes what every workspace on the number can send. Every change is audited and takes effect on the next send of every worker.
 */
@ApiTags('platform')
@ActorKinds('platform_operator')
@UseGuards(OperatorGuard)
@OperatorRoles('super_admin')
@Controller({ path: 'platform/waba/throughput', version: '2' })
export class WabaThroughputController {
  constructor(private readonly throughput: WabaThroughputService) {}

  private operatorId(): number {
    return RequestContextStore.require().actorId!;
  }

  @Get()
  @ApiOperation({
    summary: 'Every connected number with its rate, messaging tier and live counters',
    description:
      'Poll it for the live view. `liveAvailable: false` means Redis could not be read and the live columns are zero.',
  })
  overview(@Query(zodPipe(wabaThroughputListQuerySchema)) query: WabaThroughputListQuery) {
    return this.throughput.overview(query.search);
  }

  @Get('settings')
  @ApiOperation({ summary: 'The platform-wide send-limit settings' })
  settings() {
    return this.throughput.settings();
  }

  @Patch('settings')
  @ApiOperation({
    summary: 'Save the platform-wide send-limit settings',
    description: 'Requires the rowVersion you read. Republishes every number at once.',
  })
  updateSettings(
    @Body(zodPipe(updateWabaThroughputSettingsSchema)) body: UpdateWabaThroughputSettingsInput,
  ) {
    return this.throughput.updateSettings(body, this.operatorId());
  }

  @Get('numbers/:id')
  @ApiOperation({ summary: 'One number: per-second and per-minute series and its event log' })
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.throughput.detail(id);
  }

  @Patch('numbers/:id')
  @ApiOperation({
    summary: "Set or clear a number's rate override, pause or resume its sends",
    description: 'Requires the rowVersion you read. A null override follows Meta again.',
  })
  control(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateWabaNumberControlSchema)) body: UpdateWabaNumberControlInput,
  ) {
    return this.throughput.updateControl(id, body, this.operatorId());
  }

  @Post('numbers/:id/refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Re-read the number's throughput and messaging tier from Meta now" })
  refresh(@Param('id', ParseUUIDPipe) id: string) {
    return this.throughput.refresh(id);
  }
}
