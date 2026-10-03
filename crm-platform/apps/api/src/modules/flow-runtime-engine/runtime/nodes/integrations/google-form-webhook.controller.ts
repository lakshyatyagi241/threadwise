import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../../../../../common/decorators';
import { zodPipe } from '../../../../../common/pipes/zod-validation.pipe';
import {
  GoogleFormWebhookService,
  googleFormResponseSchema,
  type GoogleFormResponse,
} from './google-form-webhook.service';

/**
 * `POST /api/google/form-response` (WD-FLR-046): where the Apps Script on a Google Form reports a submission. Public (Google has no
 * session); the workspace token in `X-Workspace-Token` proves the caller and names the workspace. Answers 200 `{ ok, matched }`,
 * also when no run waits on the form, as WaDesk did.
 */
@ApiExcludeController()
@Controller({ path: 'google/form-response', version: VERSION_NEUTRAL })
export class GoogleFormWebhookController {
  constructor(private readonly svc: GoogleFormWebhookService) {}

  @Public()
  @Post()
  @HttpCode(HttpStatus.OK)
  async receive(
    @Headers('x-workspace-token') token: string | undefined,
    @Body(zodPipe(googleFormResponseSchema)) body: GoogleFormResponse,
  ) {
    return { ok: true, ...(await this.svc.receive(token ?? '', body)) };
  }
}
