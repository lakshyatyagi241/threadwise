import { Global, Module } from '@nestjs/common';
import { CAPTCHA_PORT } from './captcha.port';
import { DevLogOtpSender } from './dev-log-otp-sender.adapter';
import { MAIL_PORT } from './mail.port';
import { MetaTemplateClient } from './meta-template.client';
import { RecaptchaAdapter } from './recaptcha.adapter';
import { SmtpMailAdapter } from './smtp-mail.adapter';
import { FacebookOAuthAdapter, GoogleOAuthAdapter } from './social-oauth.adapters';
import { SOCIAL_OAUTH_PROVIDERS } from './social-oauth.port';

/**
 * Adapters for the auth domain, bound to port tokens (never injected by class)
 * so swapping SMTP for an API mailer is a change here and nowhere else.
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
    RecaptchaAdapter,
    DevLogOtpSender,
    MetaTemplateClient,
    GoogleOAuthAdapter,
    FacebookOAuthAdapter,
    { provide: MAIL_PORT, useExisting: SmtpMailAdapter },
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
