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
    ];
    const missing = must.filter((p) => !gateAware(readFileSync(join(SRC, p), 'utf8')));
    expect(missing).toEqual([]);
  });
});
