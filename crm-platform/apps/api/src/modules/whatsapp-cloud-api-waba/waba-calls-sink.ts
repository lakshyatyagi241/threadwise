import { Injectable, Logger } from '@nestjs/common';
import type { InboundContext } from './waba-inbound-sink';

/**
 * Where Meta's `calls` webhook field goes once it is authenticated and routed to a workspace and a number. The calling domain (CALL)
 * owns the answer: it records the call, rings the operators, closes the call and keeps the customer's call permission. Until it binds
 * `WABA_CALLS_SINK`, the default below only logs.
 *
 * `value` is the field's value as Meta sent it: `metadata`, `contacts` and `calls[]`. Every call in it is the sink's to handle on its
 * own; one that throws must not stop the others, and the sink must be idempotent (a webhook is delivered at least once).
 */
export interface WabaCallsSink {
  onCalls(ctx: InboundContext, value: Record<string, unknown>): Promise<void>;
}

export const WABA_CALLS_SINK = Symbol('WABA_CALLS_SINK');

/** Where the calling domain announces its sink, the way the inbox does for `WABA_INBOUND_SINK_OVERRIDE`. */
export const WABA_CALLS_SINK_OVERRIDE = Symbol('WABA_CALLS_SINK_OVERRIDE');

@Injectable()
export class LoggingCallsSink implements WabaCallsSink {
  private readonly logger = new Logger('WabaCalls');

  async onCalls(ctx: InboundContext, value: Record<string, unknown>): Promise<void> {
    const calls = Array.isArray(value.calls) ? value.calls.length : 0;
    this.logger.warn(
      { orgId: ctx.orgId, number: ctx.configUuid, calls },
      'calls webhook received but no calling domain is bound to WABA_CALLS_SINK; it was acknowledged and not recorded',
    );
  }
}
