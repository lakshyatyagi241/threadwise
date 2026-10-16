import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CONSENT_GATE_ALLOWLIST,
  GATE_MARKERS,
  SEND_PRIMITIVES,
} from '../../../src/modules/contact-consent/consent-gate.allowlist';

/**
 * The guard (BL-141): a module that touches a send primitive (the channel dispatcher, the SMS gateway, the Telegram API, the calling
 * graph, the appointment messenger, the mail drivers, the bulk engine registries) must ask the ConsentGate itself or be on the
 * reviewed allow-list with a reason. Static text scan of `src/`, so it is fast and does not depend on a database.
 */
const SRC = resolve(__dirname, '../../../src');
const posix = (p: string) => p.split('\\').join('/');

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : files(p);
    return /\.ts$/.test(e.name) && !/\.(spec|test|d)\.ts$/.test(e.name) ? [p] : [];
  });
}

const rel = (p: string) => posix(relative(SRC, p));
const isWiring = (r: string) => /(^|\/)index\.ts$/.test(r) || /\.module\.ts$/.test(r);
const mentionsPrimitive = (text: string) =>
  SEND_PRIMITIVES.some((p) => new RegExp(`\\b${p}\\b`).test(text));
const gateAware = (text: string) => GATE_MARKERS.some((m) => text.includes(m));

// The providers folder DEFINES the ports and adapters; the check is about the callers in `modules/`.
const modules = files(join(SRC, 'modules'));

/** The broadcast senders and the consent channel each one asks the gate about. Instagram's broadcasts page is `broadcasts.service.ts`. */
const BROADCAST_SENDER_CHANNEL: Record<string, string> = {
  'modules/channel-facebook/fb-broadcast-sender.service.ts': 'facebook',
  'modules/channel-telegram/tg-broadcast-sender.service.ts': 'telegram',
  'modules/channel-viber/vib-broadcast-sender.service.ts': 'viber',
  'modules/channel-line/line-broadcast-sender.service.ts': 'line',
  'modules/channel-wechat/broadcast-sender.service.ts': 'wechat',
  'modules/channel-instagram/broadcasts.service.ts': 'instagram',
};
const BROADCAST_SENDERS = Object.keys(BROADCAST_SENDER_CHANNEL);

describe('ConsentGate guard', () => {
  it('every file that touches a send primitive asks the gate or is on the allow-list', () => {
    const allowed = new Set(CONSENT_GATE_ALLOWLIST.map((e) => e.path));
    const offenders = modules
      .map((f) => ({ r: rel(f), text: readFileSync(f, 'utf8') }))
      .filter(({ r, text }) => !isWiring(r) && mentionsPrimitive(text))
      .filter(({ r, text }) => !gateAware(text) && !allowed.has(r))
      .map(({ r }) => r);
    expect(
      offenders,
      'These files use a send primitive without asking the ConsentGate. Ask it (see docs/privacy/privacy-by-design-checklist.md) or add the file to consent-gate.allowlist.ts with a reason.',
    ).toEqual([]);
  });

  it('the allow-list has no stale entries and every entry has a reason', () => {
    const byPath = new Map(modules.map((f) => [rel(f), readFileSync(f, 'utf8')]));
    const problems: string[] = [];
    for (const e of CONSENT_GATE_ALLOWLIST) {
      const text = byPath.get(e.path);
      if (text === undefined) problems.push(`${e.path}: file not found`);
      else if (!mentionsPrimitive(text))
        problems.push(`${e.path}: no longer uses a send primitive`);
      else if (gateAware(text)) problems.push(`${e.path}: is gate-aware now, remove the entry`);
      if (e.reason.trim().length < 20) problems.push(`${e.path}: reason too short`);
    }
    expect(problems).toEqual([]);
  });

  it('the paths that must be gate-aware are', () => {
    const must = [
      'modules/chat-conversations/channel-dispatcher.service.ts',
      'modules/chat-conversations/outbound.service.ts',
      'modules/chat-conversations/message-dispatch.service.ts',
      'modules/flow-runtime-engine/runtime/flow-sender.service.ts',
      'modules/flow-runtime-engine/runtime/nodes/actions/number-sender.service.ts',
      'modules/flow-runtime-engine/triggers/schedule.sweeper.ts',
      'modules/scheduled-queue-warmer/scheduled-run.service.ts',
      'modules/scheduled-queue-warmer/audience/schedule-audience.service.ts',
      'modules/developer-rest-api-v1/resources/messaging/message-send.service.ts',
      'modules/channel-sms/sms-engine.sender.ts',
      'modules/appointments-booking/appointment-message.consumer.ts',
      'modules/calling-voice/call-actions.service.ts',
      'modules/broadcasts/broadcasts.service.ts',
      'modules/campaigns/campaign-dispatch.service.ts',
      ...BROADCAST_SENDERS,
    ];
    const missing = must.filter((p) => !gateAware(readFileSync(join(SRC, p), 'utf8')));
    expect(missing).toEqual([]);
  });

  /**
   * The broadcast senders of the social and messaging channels (BL-141 follow-up). Being "gate-aware" is not enough for them: they once
   * asked the gate only for a recipient released from the quiet hours, so the FIRST send went out unchecked and this test passed. Each
   * must put every recipient through `gateRecipients` (marketing purpose, its own consent channel), and none may condition the gate on a
   * held flag again.
   */
  it('every broadcast sender asks the gate for every recipient, not only a released one', () => {
    const problems: string[] = [];
    for (const [path, channel] of Object.entries(BROADCAST_SENDER_CHANNEL)) {
      const text = readFileSync(join(SRC, path), 'utf8');
      const flat = text.replace(/\s+/g, ' ');
      if (!/gateRecipients\(/.test(flat)) problems.push(`${path}: does not call gateRecipients`);
      if (!new RegExp(`gateRecipients\\([^)]*'${channel}'`).test(flat)) {
        problems.push(`${path}: does not ask for the '${channel}' consent channel`);
      }
      // The old shape: the gate asked only about the recipients a hold had released (`filter((r) => r.wasHeld ...)`).
      if (/wasHeld\s*&&/.test(flat) || /held_until\s*!==\s*null/.test(flat)) {
        problems.push(`${path}: asks the gate only for a recipient that was held`);
      }
      if (/service_messaging|'utility'/.test(text)) {
        problems.push(`${path}: a broadcast is marketing, it must not claim a service purpose`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('the broadcast senders are not on the allow-list (a known gap would hide a missing check)', () => {
    const allowed = new Set(CONSENT_GATE_ALLOWLIST.map((e) => e.path));
    expect(BROADCAST_SENDERS.filter((p) => allowed.has(p))).toEqual([]);
  });

  it('no KNOWN GAP is left for a broadcast sender', () => {
    const gaps = CONSENT_GATE_ALLOWLIST.filter((e) => e.reason.startsWith('KNOWN GAP'));
    expect(gaps.filter((g) => /broadcast-sender|broadcasts\.service/.test(g.path))).toEqual([]);
  });
});
