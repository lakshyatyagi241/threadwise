import {
  Controller,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../../../common/decorators';
import { Throttle } from '../../platform-infrastructure';
import { FlowHookService, type FlowHookAck } from './flow-hook.service';

/**
 * Where an outside system posts to start one flow: `POST /v2/public/flow-hooks/<flow uuid>/<token>`. No session; the token in the path
 * is the credential. JSON object body; the sender's own delivery id goes in `Idempotency-Key` (or `X-Delivery-Id`). See
 * `FlowHookService` for what it checks and answers.
 */
@ApiExcludeController()
@Public()
@Controller({ path: 'public/flow-hooks', version: '2' })
export class FlowHookController {
  constructor(private readonly hooks: FlowHookService) {}

  @Post(':flowUuid/:token')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @Throttle({ limit: 120, windowSeconds: 60, by: 'ip' })
  receive(
    @Param('flowUuid') flowUuid: string,
    @Param('token') token: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-delivery-id') deliveryId: string | undefined,
    @Req() req: Request & { rawBody?: Buffer },
  ): Promise<FlowHookAck> {
    return this.hooks.receive(
      flowUuid,
      token,
      req.rawBody ?? Buffer.alloc(0),
      idempotencyKey ?? deliveryId,
    );
  }
}
