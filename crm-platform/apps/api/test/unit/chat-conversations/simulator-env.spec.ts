import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import {
  assertSimulatorBootSafe,
  chatConversationsConfig,
  simulatorAllowed,
} from '../../../src/config/domains/chat-conversations.env';
import {
  CHANNEL_ADAPTERS,
  ChatChannelProvidersModule,
  type ChannelAdapter,
} from '../../../src/infra/providers/chat-conversations';
import { ChatMediaStore } from '../../../src/infra/providers/chat-conversations/media';
import { OUTBOUND_SEND_GUARD } from '../../../src/infra/providers/whatsapp/send-guard.port';
import { WABA_ADMIN } from '../../../src/infra/providers/whatsapp-cloud-api-waba/waba-admin.port';
import { WabaHttp } from '../../../src/infra/providers/whatsapp-cloud-api-waba/waba-http';
import { SimulatorPolicy } from '../../../src/modules/chat-conversations/simulator-policy.service';

describe('the simulator flag', () => {
  it('is off by default', () => {
    expect(simulatorAllowed({ NODE_ENV: 'development' })).toBe(false);
    expect(chatConversationsConfig({}).simulatorRequested).toBe(false);
  });

  it('is on in development and test when asked for, in any boolean spelling', () => {
    for (const v of ['true', '1']) {
      expect(simulatorAllowed({ NODE_ENV: 'development', CHANNEL_SIMULATOR_ENABLED: v })).toBe(
        true,
      );
      expect(simulatorAllowed({ NODE_ENV: 'test', CHANNEL_SIMULATOR_ENABLED: v })).toBe(true);
    }
    expect(simulatorAllowed({ NODE_ENV: 'test', CHANNEL_SIMULATOR_ENABLED: 'false' })).toBe(false);
  });

  it('is never on in production, whatever the flag says', () => {
    expect(simulatorAllowed({ NODE_ENV: 'production', CHANNEL_SIMULATOR_ENABLED: 'true' })).toBe(
      false,
    );
  });

  it('refuses to boot a production process that asks for it, and says why', () => {
    expect(() =>
      assertSimulatorBootSafe({ NODE_ENV: 'production', CHANNEL_SIMULATOR_ENABLED: 'true' }),
    ).toThrow(/production/);
    expect(() => assertSimulatorBootSafe({ NODE_ENV: 'production' })).not.toThrow();
    expect(() =>
      assertSimulatorBootSafe({ NODE_ENV: 'development', CHANNEL_SIMULATOR_ENABLED: 'true' }),
    ).not.toThrow();
  });
});

describe('SimulatorPolicy (evaluated on every call)', () => {
  const policy = new SimulatorPolicy();
  const withEnv = (env: Record<string, string | undefined>, fn: () => void) => {
    const before = { n: process.env.NODE_ENV, f: process.env.CHANNEL_SIMULATOR_ENABLED };
    Object.assign(process.env, env);
    try {
      fn();
    } finally {
      process.env.NODE_ENV = before.n;
      if (before.f === undefined) delete process.env.CHANNEL_SIMULATOR_ENABLED;
      else process.env.CHANNEL_SIMULATOR_ENABLED = before.f;
    }
  };

  it('creating a simulator channel is refused (403 CHANNEL_SIMULATOR_DISABLED) when it is off or in production', () => {
    withEnv({ NODE_ENV: 'test', CHANNEL_SIMULATOR_ENABLED: 'false' }, () => {
      expect(() => policy.assertCanCreate()).toThrowError(
        expect.objectContaining({ code: 'CHANNEL_SIMULATOR_DISABLED' }),
      );
    });
    withEnv({ NODE_ENV: 'production', CHANNEL_SIMULATOR_ENABLED: 'true' }, () => {
      expect(() => policy.assertCanCreate()).toThrowError(
        expect.objectContaining({ code: 'CHANNEL_SIMULATOR_DISABLED' }),
      );
    });
    withEnv({ NODE_ENV: 'test', CHANNEL_SIMULATOR_ENABLED: 'true' }, () => {
      expect(() => policy.assertCanCreate()).not.toThrow();
    });
  });

  it('the dev routes pretend not to exist (404) when it is off', () => {
    withEnv({ NODE_ENV: 'test', CHANNEL_SIMULATOR_ENABLED: 'false' }, () => {
      expect(() => policy.assertRoutesVisible()).toThrowError(
        expect.objectContaining({ code: 'NOT_FOUND' }),
      );
    });
  });
});

describe('ChatChannelProvidersModule: what is bound where', () => {
  // What the WhatsApp adapter takes from the rest of the platform: the one WhatsApp client and its account port (global from
  // WabaProvidersModule), the send guard (SendGuardModule) and the chat media store (ChatMediaModule).
  @Global()
  @Module({
    providers: [
      { provide: WabaHttp, useValue: {} },
      { provide: WABA_ADMIN, useValue: {} },
      { provide: OUTBOUND_SEND_GUARD, useValue: {} },
      { provide: ChatMediaStore, useValue: {} },
    ],
    exports: [WabaHttp, WABA_ADMIN, OUTBOUND_SEND_GUARD, ChatMediaStore],
  })
  class FakeProvidersModule {}

  async function adaptersFor(env: Record<string, string | undefined>): Promise<ChannelAdapter[]> {
    const before = { n: process.env.NODE_ENV, f: process.env.CHANNEL_SIMULATOR_ENABLED };
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    try {
      const ref = await Test.createTestingModule({
        imports: [FakeProvidersModule, ChatChannelProvidersModule],
      }).compile();
      return ref.get<ChannelAdapter[]>(CHANNEL_ADAPTERS, { strict: false });
    } finally {
      process.env.NODE_ENV = before.n;
      if (before.f === undefined) delete process.env.CHANNEL_SIMULATOR_ENABLED;
      else process.env.CHANNEL_SIMULATOR_ENABLED = before.f;
    }
  }

  it('binds the simulator only with the flag on outside production', async () => {
    expect(
      (await adaptersFor({ NODE_ENV: 'test', CHANNEL_SIMULATOR_ENABLED: 'true' })).map(
        (a) => a.kind,
      ),
    ).toEqual(['whatsapp_cloud', 'webchat', 'telegram', 'simulator']);
    expect(
      (await adaptersFor({ NODE_ENV: 'test', CHANNEL_SIMULATOR_ENABLED: 'false' })).map(
        (a) => a.kind,
      ),
    ).toEqual(['whatsapp_cloud', 'webchat', 'telegram']);
  });

  it('REFUSES TO BOOT when the flag is set in production', async () => {
    await expect(
      adaptersFor({ NODE_ENV: 'production', CHANNEL_SIMULATOR_ENABLED: 'true' }),
    ).rejects.toThrow(/production/);
  });

  it('boots in production without the flag, with no simulator bound', async () => {
    const kinds = (
      await adaptersFor({ NODE_ENV: 'production', CHANNEL_SIMULATOR_ENABLED: undefined })
    ).map((a) => a.kind);
    expect(kinds).toEqual(['whatsapp_cloud', 'webchat', 'telegram']);
  });
});
