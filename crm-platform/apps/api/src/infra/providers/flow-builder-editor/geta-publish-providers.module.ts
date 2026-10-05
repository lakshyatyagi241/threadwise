import { Module } from '@nestjs/common';
import { readGetaPublishEnv } from '../../../config/domains/flow-builder-editor.env';
import { BOT_PUBLISH_PORT, type BotPublishPort } from './bot-publish.port';
import { FixtureBotPublisher, FixtureBotPublisherState } from './fixture-bot-publisher';
import { GetaConsoleBotPublisher } from './geta-console-bot-publisher';

/**
 * Binds BOT_PUBLISH_PORT: the Geta console adapter when `GETA_PUBLISH_MODE=live`, the in-memory fixture otherwise (the default
 * outside production). The mode is read once at boot. `FixtureBotPublisherState` is exported so a test or a demo can read back the
 * calls the fixture received.
 */
@Module({
  providers: [
    FixtureBotPublisherState,
    FixtureBotPublisher,
    {
      provide: BOT_PUBLISH_PORT,
      inject: [FixtureBotPublisher],
      useFactory: (fixture: FixtureBotPublisher): BotPublishPort => {
        const env = readGetaPublishEnv();
        return env.mode === 'fixture'
          ? fixture
          : new GetaConsoleBotPublisher({
              timeoutMs: env.timeoutMs,
              maxAttempts: env.maxAttempts,
              backoffMs: env.backoffMs,
              allowPrivate: env.allowPrivateHosts,
            });
      },
    },
  ],
  exports: [BOT_PUBLISH_PORT, FixtureBotPublisherState],
})
export class GetaPublishProvidersModule {}
