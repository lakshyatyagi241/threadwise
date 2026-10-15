import { Injectable } from '@nestjs/common';
import type { InboundHooks } from './tokens';

/** No flow runtime, routing or auto-reply yet: nothing consumes a message and nothing replies. */
@Injectable()
export class NoInboundHooks implements InboundHooks {
  handoffToFlow(): Promise<boolean> {
    return Promise.resolve(false);
  }

  automate(): Promise<void> {
    return Promise.resolve();
  }
}
