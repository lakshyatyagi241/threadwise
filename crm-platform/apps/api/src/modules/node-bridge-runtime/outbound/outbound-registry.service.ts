import { Injectable } from '@nestjs/common';
import type { EngineTransport } from './outbound';
import { WabaTransport } from './waba.transport';

/** Which transport sends for which engine. Each engine's own domain registers its transport when it is built. */
@Injectable()
export class OutboundRegistry {
  private readonly transports = new Map<string, EngineTransport>();

  constructor(waba: WabaTransport) {
    this.transports.set('waba', waba);
  }

  register(engine: string, transport: EngineTransport): void {
    this.transports.set(engine, transport);
  }

  get(engine: string): EngineTransport | undefined {
    return this.transports.get(engine);
  }
}
