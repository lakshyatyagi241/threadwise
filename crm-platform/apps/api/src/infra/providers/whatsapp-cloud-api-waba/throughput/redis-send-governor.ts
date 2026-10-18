import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  ERROR_CODES,
  WABA_UPGRADE_IN_PROGRESS_CODE,
  WABA_THROUGHPUT_EXCEEDED_CODE,
} from '@crm/contracts';
import { AppError } from '../../../../common/errors/app-error';
import { WabaApiError } from '../waba-errors';
import type { SendGovernor, SendTarget } from './send-governor.port';
import { ThroughputStore } from './throughput-store';
import { msUntilNextHour } from './throughput-rules';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
/** How often a repeating event (a hold, a deferral) is written to a number's log. */
const EVENT_GATE_MS = 30_000;
/** What a paused number tells a retrying pipeline: look again in a minute. */
const PAUSED_RETRY_MS = 60_000;

/**
 * The send governor on Redis (see the port). Per phone number it:
 *
 *   1. refuses a send while the number is paused, or (when the operator turned it on) while its daily messaging tier is used up;
 *   2. paces everything else to the number's rate with an atomic GCRA slot shared by every worker, waiting in process for a short
 *      turn and handing the send back to its queue when the turn is too far away;
 *   3. counts what went out (per second, per minute, unique template recipients per hour) for the console.
 *
 * The rate is published by the control plane; this class never reads Postgres. Redis failures are logged and let the send through.
 */
@Injectable()
export class RedisSendGovernor implements SendGovernor {
  private readonly logger = new Logger(RedisSendGovernor.name);
  private lastWarnAt = 0;

  constructor(private readonly store: ThroughputStore) {}

  async admit(t: SendTarget): Promise<void> {
    let wait = 0;
    try {
      const g = await this.store.global();
      if (!g.enabled) return;

      if (t.businessInitiated && g.enforceTierCap) await this.assertTierRoom(t);

      const r = await this.store.reserve(t.phoneNumberId, g);
      if (r.status === 'paused') {
        const cfg = await this.store.number(t.phoneNumberId).catch(() => null);
        void this.store
          .pushEvent(t.phoneNumberId, 'paused_block', cfg?.pauseReason ?? null, EVENT_GATE_MS)
          .catch(() => undefined);
        throw new AppError(
          ERROR_CODES.AUTH_SEND_HALTED,
          'Sending from this WhatsApp number is paused by the platform. It resumes when the pause is lifted.',
          HttpStatus.SERVICE_UNAVAILABLE,
          undefined,
          true,
        );
      }
      if (r.status === 'deferred') {
        void this.store.recordDeferred(t.phoneNumberId).catch(() => undefined);
        void this.store
          .pushEvent(
            t.phoneNumberId,
            'deferred',
            `queue ${Math.round(r.waitMs / 1000)}s deep at ${r.mps}/s`,
            EVENT_GATE_MS,
          )
          .catch(() => undefined);
        throw WabaApiError.held(
          r.waitMs,
          `This WhatsApp number is sending at its limit (${r.mps} messages per second). Retrying shortly.`,
        );
      }
      wait = r.waitMs;
    } catch (err) {
      if (err instanceof AppError || err instanceof WabaApiError) throw err;
      this.warnOnce('send limiter unreadable, sending unpaced', err);
      return;
    }
    if (wait > 0) {
      await sleep(wait);
      void this.store.recordWait(t.phoneNumberId, wait).catch(() => undefined);
    }
  }

  async recordSent(t: SendTarget): Promise<void> {
    try {
      await this.store.recordSent(t.phoneNumberId, t.recipient, t.businessInitiated);
    } catch (err) {
      this.warnOnce('send counters unwritable', err);
    }
  }

  async recordRefused(t: SendTarget, code: number | null): Promise<void> {
    if (code !== WABA_THROUGHPUT_EXCEEDED_CODE && code !== WABA_UPGRADE_IN_PROGRESS_CODE) return;
    try {
      const g = await this.store.global();
      const upgrade = code === WABA_UPGRADE_IN_PROGRESS_CODE;
      await this.store.recordMetaThrottle(
        t.phoneNumberId,
        upgrade ? 'upgrade' : 'throughput',
        g.adaptiveBackoff,
      );
      await this.store.pushEvent(
        t.phoneNumberId,
        upgrade ? 'upgrade_in_progress' : 'meta_throttled',
        `Meta error ${code}`,
        upgrade ? 0 : EVENT_GATE_MS,
      );
    } catch (err) {
      this.warnOnce('throttle could not be recorded', err);
    }
  }

  /** Holds a template send that would pass the tier's daily cap. An estimate, so it is only enforced when the operator asks. */
  private async assertTierRoom(t: SendTarget): Promise<void> {
    const cfg = await this.store.number(t.phoneNumberId);
    if (!cfg || cfg.tierUnlimited || cfg.tierCap <= 0) return;
    const used = await this.store.tierUsed(t.phoneNumberId);
    if (used < cfg.tierCap) return;
    void this.store
      .pushEvent(t.phoneNumberId, 'tier_full', `${used} of ${cfg.tierCap} recipients`, EVENT_GATE_MS)
      .catch(() => undefined);
    const mins = Math.ceil(msUntilNextHour(Date.now()) / 60_000);
    throw new AppError(
      ERROR_CODES.AUTH_SEND_HALTED,
      `This WhatsApp number reached its daily messaging limit (${cfg.tierName ?? 'tier'}: ${cfg.tierCap} recipients per 24 hours). Template sends resume as the oldest hour drops out, in about ${mins} minutes.`,
      HttpStatus.SERVICE_UNAVAILABLE,
      undefined,
      true,
    );
  }

  private warnOnce(msg: string, err: unknown): void {
    const now = Date.now();
    if (now - this.lastWarnAt < 60_000) return;
    this.lastWarnAt = now;
    this.logger.warn({ err: err instanceof Error ? err.message : String(err) }, msg);
  }
}

export { PAUSED_RETRY_MS };
