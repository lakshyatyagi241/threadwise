import { Injectable } from '@nestjs/common';
import type { InboundContext, WabaCallsSink } from '../whatsapp-cloud-api-waba';
import { CallEventsService } from './call-events.service';

/** The calling domain's end of the WABA webhook (`WABA_CALLS_SINK`): hands the `calls` field to `CallEventsService`. */
@Injectable()
export class CallingWabaSink implements WabaCallsSink {
  constructor(private readonly events: CallEventsService) {}

  onCalls(ctx: InboundContext, value: Record<string, unknown>): Promise<void> {
    return this.events.handle(ctx, value);
  }
}
