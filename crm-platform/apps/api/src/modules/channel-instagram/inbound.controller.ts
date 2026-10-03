import { Body, Controller, Headers, HttpCode, HttpStatus, Post, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../../common/decorators';
import { InboundService } from './inbound.service';

/**
 * The engine's push door. No session: the engine proves itself with the shared secret in `X-Instaflow-Secret`, and the answer
 * keeps the `{ok, error}` shape the engine reads.
 */
@ApiExcludeController()
@Public()
@Controller({ path: 'instaflow', version: '2' })
export class InstaflowPublicController {
  constructor(private readonly inbound: InboundService) {}

  @Post('inbound')
  @HttpCode(HttpStatus.OK)
  async receive(
    @Headers('x-instaflow-secret') secret: string | undefined,
    @Body() body: unknown,
    @Res() res: Response,
  ): Promise<void> {
    const answer = await this.inbound.receive(secret ?? '', body);
    res.status(answer.status).json(answer.body);
  }
}
