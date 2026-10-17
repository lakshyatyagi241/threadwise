import type { SendHold } from '@crm/contracts';

/**
 * A marketing send reached the dispatcher inside the workspace's quiet hours (BL-177). Not a failure and not a refusal: the message is
 * kept and goes at `hold.until`, after the ConsentGate and the window are asked again. Each caller decides how to wait: the inbox worker
 * delays its job, a flow halts its run until then. A caller that cannot wait must treat it like any other send that did not go out.
 */
export class SendHeldError extends Error {
  override readonly name = 'SendHeldError';

  constructor(readonly hold: SendHold) {
    super(`The message is held until ${hold.until} (${hold.reason})`);
  }
}
