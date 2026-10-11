import { Body, Controller, Headers, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../../common/decorators';
import { Throttle } from '../platform-infrastructure';
import { SmsStatusService } from './sms-status.service';

/**
 * Where the providers report delivery (TW-SMS-022). Public (a provider has no session, and no plan gate: a downgraded workspace's
 * late reports must still land) and always 204: the signature (Twilio) or the secret in the address (MSG91) is the authentication.
 * Throttled to Reference's 240 a minute per address.
 */
@ApiExcludeController()
@Controller({ path: 'sms/status', version: '2' })
export class SmsStatusController {
  constructor(private readonly status: SmsStatusService) {}

  /** Twilio: form fields `MessageSid`, `MessageStatus`, `ErrorCode`, signed with `X-Twilio-Signature`. */
  @Public()
  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ limit: 240, windowSeconds: 60, by: 'ip' })
  async twilio(
    @Body() body: unknown,
    @Headers('x-twilio-signature') signature: string | undefined,
  ): Promise<void> {
    await this.status.twilio(body, signature);
  }

  /** MSG91: the JSON delivery report the operator points its panel at. */
  @Public()
  @Post(':secret')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ limit: 240, windowSeconds: 60, by: 'ip' })
  async msg91(@Param('secret') secret: string, @Body() body: unknown): Promise<void> {
    await this.status.msg91(secret, body);
  }
}
