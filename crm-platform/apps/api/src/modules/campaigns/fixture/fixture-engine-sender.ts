import { randomUUID } from 'node:crypto';
import { WabaApiError } from '../../../infra/providers/whatsapp-cloud-api-waba/waba-errors';
import type { EngineSender, OpenedSender } from '../../broadcasts';
import { fixtureOutcome } from './whatsapp-fixture';

/** A delivery report the sandbox sends itself, in the shape the Cloud API webhook would. */
export interface FixtureReceipt {
  providerMessageId: string;
  status: 'delivered' | 'failed';
  errorCode?: string | null;
  errorMessage?: string | null;
  occurredAt: string;
}

/** Where the sandbox's reports go. In the apps it is a queue the worker drains; a test hands in its own. */
export interface FixtureReceiptSink {
  emit(receipt: FixtureReceipt, delayMs: number): Promise<void>;
}

/** How long after the send the sandbox reports (a real report takes a moment, and the row must be `sent` first). */
export const FIXTURE_REPORT_DELAY_MS = 400;

/**
 * The WhatsApp Cloud API sender of the sandbox (`CAMP_PROVIDER_MODE=fixture`). It sits behind the same port as the real sender
 * (EngineSender), so the run, the retry job and the test send use it unchanged; nothing leaves the machine. What happens to a message is
 * decided by `fixtureOutcome` (the recipient's number and the attempt).
 */
export class FixtureEngineSender implements EngineSender {
  constructor(
    private readonly sink: FixtureReceiptSink,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  open(): Promise<OpenedSender> {
    return Promise.resolve({
      send: async (m) => {
        const outcome = fixtureOutcome(m.to, m.clientReference);
        if (outcome.kind === 'rejected') {
          throw WabaApiError.fromResponse(400, {
            error: { code: Number(outcome.code), message: outcome.message, type: 'OAuthException' },
          });
        }
        const providerMessageId = `wamid.fixture.${randomUUID()}`;
        const occurredAt = this.clock().toISOString();
        await this.sink.emit(
          outcome.kind === 'delivered'
            ? { providerMessageId, status: 'delivered', occurredAt }
            : {
                providerMessageId,
                status: 'failed',
                errorCode: outcome.code,
                errorMessage: outcome.message,
                occurredAt,
              },
          FIXTURE_REPORT_DELAY_MS,
        );
        return { providerMessageId };
      },
    });
  }
}
