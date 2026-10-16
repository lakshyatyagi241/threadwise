import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import { AuthProvidersModule } from '../../../src/infra/providers/auth-registration-security/auth-providers.module';
import { MAIL_PORT } from '../../../src/infra/providers/auth-registration-security/mail.port';
import { ResendMailAdapter } from '../../../src/infra/providers/auth-registration-security/resend-mail.adapter';
import { SmtpMailAdapter } from '../../../src/infra/providers/auth-registration-security/smtp-mail.adapter';

/**
 * WD mail-provider wiring: MAIL_PORT must follow MAIL_PROVIDER so a deployment can switch from the local
 * Mailpit/SMTP default to Resend's HTTP API with an env change alone, never a code change.
 *
 * AuthProvidersModule expects ConfigService from the app's global ConfigModule; standing one up here as a
 * stub Global module (rather than overrideProvider, which only replaces a token the graph already provides)
 * makes it visible to AuthProvidersModule's own providers exactly as the real ConfigModule would.
 */
function fakeConfigModule(env: Record<string, string | undefined>) {
  @Global()
  @Module({
    providers: [
      {
        provide: ConfigService,
        useValue: {
          get: (key: string) =>
            ({ MAIL_PROVIDER: 'smtp', SMTP_FROM: 'no-reply@localhost', ...env })[key],
        },
      },
    ],
    exports: [ConfigService],
  })
  class FakeConfigModule {}
  return FakeConfigModule;
}

async function moduleWithEnv(env: Record<string, string | undefined>) {
  return Test.createTestingModule({
    imports: [fakeConfigModule(env), AuthProvidersModule],
  }).compile();
}

describe('AuthProvidersModule mail-provider selection', () => {
  it('binds MAIL_PORT to SmtpMailAdapter by default', async () => {
    const moduleRef = await moduleWithEnv({});
    expect(moduleRef.get(MAIL_PORT)).toBeInstanceOf(SmtpMailAdapter);
  });

  it('binds MAIL_PORT to ResendMailAdapter when MAIL_PROVIDER=resend', async () => {
    const moduleRef = await moduleWithEnv({ MAIL_PROVIDER: 'resend' });
    expect(moduleRef.get(MAIL_PORT)).toBeInstanceOf(ResendMailAdapter);
  });
});
