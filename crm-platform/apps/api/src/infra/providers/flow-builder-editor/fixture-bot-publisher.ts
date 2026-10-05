import { Injectable } from '@nestjs/common';
import {
  BotPublishError,
  type BotCallResult,
  type BotConsoleCredentials,
  type BotPublishPort,
  type PublishBotParams,
  type UpdateChatbotConfigurationParams,
} from './bot-publish.port';

export interface FixtureCall {
  step: 'configuration_update' | 'publish_bot';
  /** The chatbot id (configuration update) or the bot id (publish-bot). */
  target: string;
  baseUrl: string;
}

/** What the fixture remembers, so a test or a demo can read back what would have been sent. Secrets are never kept. */
@Injectable()
export class FixtureBotPublisherState {
  readonly calls: FixtureCall[] = [];
  /** Targets that already failed once (`fail-once-*` ids fail on their first call only). */
  readonly failedOnce = new Set<string>();
  reset(): void {
    this.calls.length = 0;
    this.failedOnce.clear();
  }
}

/**
 * The deterministic stand-in behind `GETA_PUBLISH_MODE=fixture`: nothing leaves the machine, both calls answer 200 and are recorded.
 * It can be told to fail by the id it is given, which is how a demo shows the failed state and Retry without a real console:
 *   a chatbot id containing `fail-config`  -> the configuration update answers 502 every time
 *   a bot id containing `fail-publish`     -> publish-bot answers 502 every time
 *   `fail-once-config` / `fail-once-publish` in the same places -> 502 on the first call only, then 200
 */
@Injectable()
export class FixtureBotPublisher implements BotPublishPort {
  readonly name = 'fixture';

  constructor(private readonly state: FixtureBotPublisherState) {}

  async updateChatbotConfiguration(
    credentials: BotConsoleCredentials,
    params: UpdateChatbotConfigurationParams,
  ): Promise<BotCallResult> {
    this.state.calls.push({
      step: 'configuration_update',
      target: params.chatbotId,
      baseUrl: credentials.baseUrl,
    });
    this.maybeFail('configuration_update', params.chatbotId, 'fail-config');
    return { status: 200 };
  }

  async publishBot(
    credentials: BotConsoleCredentials,
    params: PublishBotParams,
  ): Promise<BotCallResult> {
    this.state.calls.push({
      step: 'publish_bot',
      target: params.botId,
      baseUrl: credentials.baseUrl,
    });
    this.maybeFail('publish_bot', params.botId, 'fail-publish');
    return { status: 200 };
  }

  private maybeFail(
    step: 'configuration_update' | 'publish_bot',
    target: string,
    marker: string,
  ): void {
    const label = step === 'publish_bot' ? 'publish' : 'configuration update';
    if (target.includes(marker)) {
      throw new BotPublishError(step, `Geta answered 502: simulated failure (${label})`, {
        status: 502,
      });
    }
    const once = marker.replace('fail-', 'fail-once-');
    if (target.includes(once) && !this.state.failedOnce.has(`${step}:${target}`)) {
      this.state.failedOnce.add(`${step}:${target}`);
      throw new BotPublishError(step, `Geta answered 502: simulated one-off failure (${label})`, {
        status: 502,
      });
    }
  }
}
