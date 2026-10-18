/**
 * The send governor: one choke point that every Cloud API message passes before it leaves for Meta (`WabaHttp.call` on
 * `POST /<phone-number-id>/messages`). Campaigns, broadcasts, automations, bot replies, the inbox and the public API all send through
 * it, so a limit set here holds for all of them and none can forget it.
 *
 * Declared in the provider layer so `WabaHttp` can depend on it without importing a domain module; the Redis implementation is
 * `RedisSendGovernor`. Where no governor is provided (a unit test, a script) sends go out unpaced, exactly as before.
 */
export const WABA_SEND_GOVERNOR = Symbol('WABA_SEND_GOVERNOR');

/** What the governor needs to know about one outgoing message. */
export interface SendTarget {
  phoneNumberId: string;
  /** The recipient, only ever used as a hash for the daily tier count. */
  recipient: string | null;
  /** A template message: it can open a business-initiated conversation, which is what Meta's messaging tier counts. */
  businessInitiated: boolean;
}

export interface SendGovernor {
  /**
   * Resolves when the message may be sent: at once, or after the wait its turn costs (never longer than the platform's maximum local
   * wait). Throws when the message must not go out now:
   *  - a `WabaApiError` carrying `retryAfterMs` when the number's queue is too deep (the caller's retry policy takes over), or
   *  - an `AppError` `AUTH_SEND_HALTED` when the number is paused or its daily tier is full (every pipeline already treats that code
   *    as "stop and try again later").
   * Never throws because Redis is unavailable: an unreadable limiter lets the send through.
   */
  admit(target: SendTarget): Promise<void>;

  /** Meta accepted the message. */
  recordSent(target: SendTarget): Promise<void>;

  /**
   * Meta itself refused with a throughput code (130429, or 131057 while a number is being upgraded). Slows the number down and leaves
   * a trace for the console. Other codes are not the governor's business.
   */
  recordRefused(target: SendTarget, code: number | null): Promise<void>;
}
