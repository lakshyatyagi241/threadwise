import { Injectable } from '@nestjs/common';
import type { DeliveryReceipt } from '../broadcasts';

/** Returns true when the receipt was about a message this consumer owns, whether or not it changed anything. */
export type WabaReceiptSink = (receipt: DeliveryReceipt) => Promise<boolean>;

/**
 * Where a Cloud API delivery report goes after the broadcasts have declined it. A domain that sends through the Cloud API and keeps its
 * own recipients (campaigns, the wizard's test sends) registers a sink at start (worker process); the first sink that owns the message
 * id takes it, and only then does the report fall through to the inbox. Global with the module so a consumer injects it without
 * importing this domain (the same reason `WABA_CONNECTIONS` is global).
 */
@Injectable()
export class WabaReceiptRegistry {
  private readonly sinks: WabaReceiptSink[] = [];

  register(sink: WabaReceiptSink): void {
    this.sinks.push(sink);
  }

  async route(receipt: DeliveryReceipt): Promise<boolean> {
    for (const sink of this.sinks) {
      if (await sink(receipt)) return true;
    }
    return false;
  }
}
