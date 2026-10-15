import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ERROR_CODES,
  PERSONAL_WA_NOTICE_ITEMS,
  PERSONAL_WA_NOTICE_NOTES,
  PERSONAL_WA_NOTICE_VERSION,
  DEVICE_STATE_REASONS,
  WADEV_ERROR_CODES,
  WA_GROUP_ERROR_CODES,
  WA_GROUP_PARTICIPANT_OUTCOMES,
  WA_GROUP_RATE_SCOPES,
} from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import { describeError } from './lib/error-model';
import { noticeKeyOf } from './lib/notice-text';
import { CONNECTION_STATES, stateBadge } from './lib/state-model';
import { nav } from './nav';

/**
 * English and Arabic stay in step, every state and reason has words, the English notice is exactly the canonical text the API
 * hashes, and every error key is a real code. The Arabic risk text is a DRAFT for counsel (spec D1): it is checked for presence
 * here, not for legal adequacy.
 */
const WEB = resolve(__dirname, '../../..');
type Tree = { [key: string]: string | Tree };
const read = (locale: string, file: string): Tree =>
  JSON.parse(readFileSync(join(WEB, 'messages', locale, `${file}.json`), 'utf8')) as Tree;
const flatten = (tree: Tree, prefix = ''): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out[key] = v;
    else Object.assign(out, flatten(v, key));
  }
  return out;
};
const placeholders = (m: string) =>
  [...new Set([...m.matchAll(/\{\s*([A-Za-z_]\w*)\s*[,}]/g)].map((x) => x[1]!))].sort();

/** The feature's text is in two files: the numbers and the pairing, and the groups of personal numbers (both under one root). */
const readAll = (locale: string) => ({
  ...flatten(read(locale, 'whatsapp-devices-baileys')),
  ...flatten(read(locale, 'whatsapp-devices-baileys.groups')),
  ...flatten(read(locale, 'whatsapp-devices-baileys.history')),
});
const en = readAll('en');
const ar = readAll('ar');
const ROOT = 'whatsapp-devices-baileys';

describe('whatsapp-devices-baileys messages', () => {
  it('Arabic has exactly the keys English has', () => {
    expect(Object.keys(ar).sort()).toEqual(Object.keys(en).sort());
  });

  it('every message is non-empty and uses the same placeholders in both languages', () => {
    for (const [key, text] of Object.entries(en)) {
      expect(text.trim(), key).not.toBe('');
      expect(ar[key]?.trim(), key).not.toBe('');
      expect(placeholders(ar[key]!), `placeholders of ${key}`).toEqual(placeholders(text));
    }
  });

  it('Arabic is Arabic: no message is left in English by mistake', () => {
    // A web address (the invite link host) and the picture formats stay in Latin letters in every language.
    const latin = (s: string) =>
      s
        .replace(/\{[^}]*\}/g, '')
        .replace(/(https?:\/\/)?chat\.whatsapp\.com\S*/gi, '')
        .match(/[A-Za-z]{4,}/g) ?? [];
    const allowed = new Set(['QR', 'WhatsApp', 'JPEG', 'PNG']);
    for (const [key, text] of Object.entries(ar)) {
      const words = latin(text).filter((w) => !allowed.has(w));
      // ICU plural keywords are not prose
      const prose = words.filter(
        (w) => !['plural', 'one', 'two', 'few', 'other', 'many'].includes(w),
      );
      expect(prose, key).toEqual([]);
    }
  });

  it('has a pill for each connection state and a sentence for each reason', () => {
    for (const s of CONNECTION_STATES)
      expect(en[`${ROOT}.${stateBadge(s).labelKey}`], s).toBeTruthy();
    expect(en[`${ROOT}.${stateBadge('something-new').labelKey}`]).toBeTruthy();
    for (const r of DEVICE_STATE_REASONS) {
      expect(en[`${ROOT}.reason.${r}`], `en reason ${r}`).toBeTruthy();
      expect(ar[`${ROOT}.reason.${r}`], `ar reason ${r}`).toBeTruthy();
    }
  });

  it('the English notice is exactly the canonical text the API hashes into each acknowledgement', () => {
    const k = noticeKeyOf(PERSONAL_WA_NOTICE_VERSION);
    for (const item of PERSONAL_WA_NOTICE_ITEMS) {
      expect(en[`${ROOT}.notice.texts.${k}.items.${item.id}`]).toBe(item.text);
    }
    for (const note of PERSONAL_WA_NOTICE_NOTES) {
      expect(en[`${ROOT}.notice.texts.${k}.notes.${note.id}`]).toBe(note.text);
    }
  });

  it('the notice of the version in force is translated, so a version bump cannot ship without Arabic', () => {
    const k = noticeKeyOf(PERSONAL_WA_NOTICE_VERSION);
    for (const item of PERSONAL_WA_NOTICE_ITEMS) {
      expect(ar[`${ROOT}.notice.texts.${k}.items.${item.id}`], item.id).toBeTruthy();
    }
    for (const note of PERSONAL_WA_NOTICE_NOTES) {
      expect(ar[`${ROOT}.notice.texts.${k}.notes.${note.id}`], note.id).toBeTruthy();
    }
  });

  it('never calls the feature safe, official, protected or guaranteed', () => {
    for (const [key, text] of Object.entries(en)) {
      if (key.includes('texts.') && key.includes('official_route')) continue;
      if (/official WhatsApp|Unofficial|unofficial|not an approved|official route/.test(text))
        continue;
      expect(text, key).not.toMatch(/\b(safe|safely|protected|guaranteed|banned for sure)\b/i);
    }
  });

  it("every error key is a real error code (or one of the screen's own variants)", () => {
    const variants = new Set([
      'generic',
      'upgrade',
      'requestId',
      'PLAN_LIMIT_REACHED_GENERIC',
      'DEVICE_PAIRING_RATE_LIMITED_WAIT',
      'DEVICE_CREATE_RATE_LIMITED_WAIT',
      'DEVICE_PAIRING_IN_PROGRESS_BY',
      'DEVICE_NOT_PAIRABLE_CONNECTED',
      'DEVICE_NOT_PAIRABLE_SESSION',
      'DEVICE_NOT_PAIRABLE_LIVE',
    ]);
    for (const key of Object.keys(en).filter((k) => k.startsWith(`${ROOT}.errors.`))) {
      const name = key.slice(`${ROOT}.errors.`.length);
      // WA_GROUP_RATE_LIMITED_<scope>: one sentence per throttle that can refuse (the screen's own wording, by `errors[].scope`).
      const isRateScope = name.startsWith('WA_GROUP_RATE_LIMITED_');
      expect(variants.has(name) || isRateScope || name in ERROR_CODES, name).toBe(true);
    }
  });

  it('every error code of the devices API has a translated message in English and Arabic', () => {
    for (const code of Object.keys(WADEV_ERROR_CODES)) {
      expect(en[`${ROOT}.errors.${code}`], `en ${code}`).toBeTruthy();
      expect(ar[`${ROOT}.errors.${code}`], `ar ${code}`).toBeTruthy();
    }
    for (const code of [
      'PLAN_LIMIT_REACHED',
      'WA_UNOFFICIAL_DISABLED',
      'FORBIDDEN',
      'NOT_FOUND',
      'ROW_VERSION_CONFLICT',
      'VALIDATION_FAILED',
    ]) {
      expect(en[`${ROOT}.errors.${code}`], `en ${code}`).toBeTruthy();
      expect(ar[`${ROOT}.errors.${code}`], `ar ${code}`).toBeTruthy();
    }
  });

  it('names the menu entry in both languages', () => {
    expect(nav[0]?.labelKey).toBe(`${ROOT}.nav.devices`);
    expect(en[`${ROOT}.nav.devices`]).toBe('Personal WhatsApp');
    expect(ar[`${ROOT}.nav.devices`]).toBeTruthy();
  });
});

describe('describeError (by code only)', () => {
  const known = (code: string) => `${ROOT}.errors.${code}` in en;
  const err = (code: string, fieldErrors: Array<{ path: string; message: string }> = []) =>
    new ApiError(409, code, 'server text that must never be shown', 'req-1', fieldErrors);

  it('maps a known code to its message key and keeps the request id', () => {
    const d = describeError(
      err('DEVICE_ALREADY_EXISTS', [{ path: 'existingId', message: 'x' }]),
      known,
    );
    expect(d.key).toBe('DEVICE_ALREADY_EXISTS');
    expect(d.requestId).toBe('req-1');
    expect(d.fieldErrors[0]?.path).toBe('existingId');
  });

  it('reads an unknown code and a network failure as the generic error', () => {
    expect(describeError(err('SOMETHING_NEW'), known).key).toBe('generic');
    expect(describeError(new TypeError('Failed to fetch'), known).key).toBe('generic');
  });

  it('turns a plan limit into the upgrade message with the number when the server sends it', () => {
    const d = describeError(
      err('PLAN_LIMIT_REACHED', [{ path: 'limitValue', message: '2' }]),
      known,
    );
    expect(d).toMatchObject({ key: 'PLAN_LIMIT_REACHED', values: { limit: 2 }, plan: true });
    expect(describeError(err('PLAN_LIMIT_REACHED'), known).key).toBe('PLAN_LIMIT_REACHED_GENERIC');
  });

  it('asks the person to wait the minutes the server asks for, from the body or the Retry-After header', () => {
    const body = describeError(
      err('DEVICE_PAIRING_RATE_LIMITED', [{ path: 'retryAfterS', message: '1500' }]),
      known,
    );
    expect(body).toMatchObject({
      key: 'DEVICE_PAIRING_RATE_LIMITED_WAIT',
      values: { minutes: 25 },
      retryAfterS: 1500,
    });
    const header = describeError(
      err('DEVICE_PAIRING_RATE_LIMITED', [{ path: 'retryAfterSeconds', message: '30' }]),
      known,
    );
    expect(header.values).toEqual({ minutes: 1 });
    expect(describeError(err('DEVICE_PAIRING_RATE_LIMITED'), known).key).toBe(
      'DEVICE_PAIRING_RATE_LIMITED',
    );
  });

  it('names who started a pairing that is already running', () => {
    const d = describeError(
      err('DEVICE_PAIRING_IN_PROGRESS', [{ path: 'startedBy', message: 'Anna' }]),
      known,
    );
    expect(d).toMatchObject({ key: 'DEVICE_PAIRING_IN_PROGRESS_BY', values: { name: 'Anna' } });
    expect(describeError(err('DEVICE_PAIRING_IN_PROGRESS'), known).key).toBe(
      'DEVICE_PAIRING_IN_PROGRESS',
    );
  });

  it('flags a plan feature refusal for the upgrade pointer', () => {
    expect(describeError(err('PLAN_FEATURE_LOCKED'), known).plan).toBe(true);
  });

  it('offers to forget a saved session or a running attempt, but never to re-link a connected number', () => {
    const why = (reason: string) =>
      describeError(err('DEVICE_NOT_PAIRABLE', [{ path: 'reason', message: reason }]), known);
    expect(why('healthy_session')).toMatchObject({
      key: 'DEVICE_NOT_PAIRABLE_SESSION',
      relinkable: true,
    });
    expect(why('live_state')).toMatchObject({ key: 'DEVICE_NOT_PAIRABLE_LIVE', relinkable: true });
    expect(why('connected')).toMatchObject({
      key: 'DEVICE_NOT_PAIRABLE_CONNECTED',
      relinkable: false,
    });
    expect(describeError(err('DEVICE_NOT_PAIRABLE'), known)).toMatchObject({
      key: 'DEVICE_NOT_PAIRABLE',
      relinkable: false,
    });
  });

  it('words each group refusal, and reads the throttle scope and wait of WA_GROUP_RATE_LIMITED', () => {
    for (const scope of WA_GROUP_RATE_SCOPES) {
      const d = describeError(
        err('WA_GROUP_RATE_LIMITED', [
          { path: 'scope', message: scope },
          { path: 'retryAfterS', message: '65' },
        ]),
        known,
      );
      expect(d.key).toBe(`WA_GROUP_RATE_LIMITED_${scope}`);
      expect(d.scope).toBe(scope);
      expect(d.retryAfterS).toBe(65);
      expect(known(d.key), d.key).toBe(true);
      expect(ar[`${ROOT}.errors.${d.key}`], `ar ${d.key}`).toBeTruthy();
    }
    // A scope this build does not know, or none, reads as the general sentence.
    const odd = describeError(
      err('WA_GROUP_RATE_LIMITED', [{ path: 'scope', message: 'something_new' }]),
      known,
    );
    expect(odd.key).toBe('WA_GROUP_RATE_LIMITED');
    expect(odd.scope).toBeUndefined();
    expect(describeError(err('WA_GROUP_RATE_LIMITED'), known).key).toBe('WA_GROUP_RATE_LIMITED');
    // The wait the proxy took from the Retry-After header is read too.
    expect(
      describeError(
        err('WA_GROUP_RATE_LIMITED', [{ path: 'retryAfterSeconds', message: '30' }]),
        known,
      ).retryAfterS,
    ).toBe(30);
    for (const code of Object.keys(WA_GROUP_ERROR_CODES)) {
      if (code === 'WA_GROUP_RATE_LIMITED') continue;
      expect(describeError(err(code), known).key, code).toBe(code);
    }
  });

  it('has the Groups tab and menu labels in English and Arabic', () => {
    expect(en[`${ROOT}.area.groups`]).toBeTruthy();
    expect(ar[`${ROOT}.area.groups`]).toBeTruthy();
    expect(en[`${ROOT}.nav.groups`]).toBeTruthy();
    expect(ar[`${ROOT}.nav.groups`]).toBeTruthy();
  });

  it('words every outcome a participants call can answer, and every badge a row can wear', () => {
    for (const o of WA_GROUP_PARTICIPANT_OUTCOMES) {
      const key = `${ROOT}.groups.outcome.${o === 'ok' ? 'done' : o}`;
      expect(en[key], key).toBeTruthy();
      expect(ar[key], `ar ${key}`).toBeTruthy();
    }
    for (const b of ['admin', 'notAdmin', 'left', 'announce', 'restrict', 'approval', 'requests']) {
      expect(en[`${ROOT}.groups.badge.${b}`], b).toBeTruthy();
    }
  });
});
