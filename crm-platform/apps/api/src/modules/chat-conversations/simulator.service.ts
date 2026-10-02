import { Injectable } from '@nestjs/common';
import type {
  SimulatorInboundInput,
  SimulatorInboundResponse,
  SimulatorReceiptInput,
  SimulatorReceiptResponse,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { SimulatorAdapter } from '../../infra/providers/chat-conversations';
import { ChannelAdapterRegistry } from './channel-adapter.registry';
import { ChannelIngestPublisher } from './channel-ingest.publisher';
import { ChannelRegistryService } from './channel-registry.service';
import { SimulatorPolicy } from './simulator-policy.service';

/** How many times `/dup` delivers the same message. */
const DUPLICATE_DELIVERIES = 3;

/**
 * The dev routes behind the simulated customer: they build what a provider's webhook would carry, run it through the adapter's own
 * `parseInbound` and hand the normalised result to the same ingest queue a real webhook uses, so the whole pipeline is exercised and
 * not bypassed. Every method first asks the policy: with the simulator off (or in production) these routes do not exist.
 */
@Injectable()
export class SimulatorService {
  constructor(
    private readonly db: DatabaseService,
    private readonly policy: SimulatorPolicy,
    private readonly channels: ChannelRegistryService,
    private readonly adapters: ChannelAdapterRegistry,
    private readonly publisher: ChannelIngestPublisher,
  ) {}

  async inbound(
    channelUuid: string,
    input: SimulatorInboundInput,
  ): Promise<SimulatorInboundResponse> {
    const { runtime } = await this.target(channelUuid);
    const { id, payload } = SimulatorAdapter.inboundPayload(input);
    const parsed = this.adapters.for('simulator').parseInbound(runtime, payload);
    const message = parsed.messages[0];
    if (!message) throw AppError.validation('The message could not be understood');

    const deliveries = SimulatorAdapter.wantsDuplicateDelivery(input) ? DUPLICATE_DELIVERIES : 1;
    for (let copy = 0; copy < deliveries; copy += 1) {
      await this.publisher.enqueueInbound(runtime.orgId, runtime.uuid, message, copy);
    }
    return { providerMessageId: id, deliveries };
  }

  async receipt(
    channelUuid: string,
    input: SimulatorReceiptInput,
  ): Promise<SimulatorReceiptResponse> {
    const { runtime } = await this.target(channelUuid);
    const parsed = this.adapters
      .for('simulator')
      .parseInbound(runtime, SimulatorAdapter.receiptPayload(input));
    const receipt = parsed.receipts[0];
    if (!receipt) throw AppError.validation('The receipt could not be understood');
    await this.publisher.enqueueReceipt(runtime.orgId, runtime.uuid, receipt, {
      delayMs: input.delayMs,
      unique: true,
    });
    return { queued: true };
  }

  private async target(channelUuid: string) {
    this.policy.assertRoutesVisible();
    const orgId = RequestContextStore.orgId();
    return this.db.tx(async (tx) => {
      const row = await this.channels.row(tx, orgId, channelUuid);
      // A real channel never takes simulated traffic, and the answer does not say whether the uuid exists.
      if (row.kind !== 'simulator') throw AppError.notFound('Channel', channelUuid);
      return { row, runtime: await this.channels.runtime(tx, orgId, row) };
    });
  }
}
