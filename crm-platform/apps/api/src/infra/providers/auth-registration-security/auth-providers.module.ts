import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/env.schema';
import { CAPTCHA_PORT } from './captcha.port';
import { DevLogOtpSender } from './dev-log-otp-sender.adapter';
import { MAIL_PORT, type MailPort } from './mail.port';
import { MetaTemplateClient } from './meta-template.client';
import { RecaptchaAdapter } from './recaptcha.adapter';
import { ResendMailAdapter } from './resend-mail.adapter';
import { SmtpMailAdapter } from './smtp-mail.adapter';
import { FacebookOAuthAdapter, GoogleOAuthAdapter } from './social-oauth.adapters';
import { SOCIAL_OAUTH_PROVIDERS } from './social-oauth.port';

/**
 * Adapters for the auth domain, bound to port tokens (never injected by class)
 * so swapping SMTP for an API mailer is a change here and nowhere else.
 *
 * `MAIL_PORT` is selected by `MAIL_PROVIDER` (`smtp`, the default, or `resend`); both adapters are kept
 * as providers regardless of which one is bound, so flipping the env var needs no code change here.
 *
 * `OTP_SENDER_PORT` is bound in AuthModule (ConfiguredOtpSender): it needs the
 * platform settings, which live there. The per-kind OTP transports (waba,
 * twilio, bridge) are plain classes it constructs per send; the dev logger and
 * the Meta template client are provided here.
 */
@Global()
@Module({
  providers: [
    SmtpMailAdapter,
    ResendMailAdapter,
    RecaptchaAdapter,
    DevLogOtpSender,
    MetaTemplateClient,
    GoogleOAuthAdapter,
    FacebookOAuthAdapter,
    {
      provide: MAIL_PORT,
      inject: [ConfigService, SmtpMailAdapter, ResendMailAdapter],
      useFactory: (
        config: ConfigService<Env, true>,
        smtp: SmtpMailAdapter,
        resend: ResendMailAdapter,
      ): MailPort => (config.get('MAIL_PROVIDER', { infer: true }) === 'resend' ? resend : smtp),
    },
    { provide: CAPTCHA_PORT, useExisting: RecaptchaAdapter },
    {
      provide: SOCIAL_OAUTH_PROVIDERS,
      inject: [GoogleOAuthAdapter, FacebookOAuthAdapter],
      useFactory: (google: GoogleOAuthAdapter, facebook: FacebookOAuthAdapter) => [
        google,
        facebook,
      ],
    },
  ],
  exports: [MAIL_PORT, CAPTCHA_PORT, SOCIAL_OAUTH_PROVIDERS, DevLogOtpSender, MetaTemplateClient],
})
export class AuthProvidersModule {}
