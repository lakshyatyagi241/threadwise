import { describe, expect, it } from 'vitest';
import { readGetaPublishEnv } from '../../../src/config/domains/flow-builder-editor.env';
import {
  formatGetaModifiedTime,
  recordForUpdate,
  summaryOf,
} from '../../../src/modules/flow-builder-editor/geta-publish/geta-record';

describe('modified_time refresh (the only field touched)', () => {
  it('formats in Geta display style, UTC, day first', () => {
    expect(formatGetaModifiedTime(new Date('2026-10-05T16:37:00Z'))).toBe(
      '05 Oct, 2026 4:37:00 PM',
    );
    expect(formatGetaModifiedTime(new Date('2026-09-10T11:00:10Z'))).toBe(
      '10 Sep, 2026 11:00:10 AM',
    );
  });

  it('handles midnight, noon and single digits', () => {
    expect(formatGetaModifiedTime(new Date('2026-01-01T00:05:09Z'))).toBe(
      '01 Jan, 2026 12:05:09 AM',
    );
    expect(formatGetaModifiedTime(new Date('2026-12-31T12:00:00Z'))).toBe(
      '31 Dec, 2026 12:00:00 PM',
    );
    expect(formatGetaModifiedTime(new Date('2026-02-03T13:01:02Z'))).toBe(
      '03 Feb, 2026 1:01:02 PM',
    );
  });

  it('is UTC whatever the process time zone is', () => {
    // 23:30 on the 5th in UTC is already the 6th in +05:30; the output must stay on the 5th
    expect(formatGetaModifiedTime(new Date('2026-10-05T23:30:00Z'))).toBe(
      '05 Oct, 2026 11:30:00 PM',
    );
  });

  const rec = {
    id: 'fakeBot1',
    bot_id: 'fake-bot-uuid',
    chatbot_status: false,
    bot_enabled: true,
    modified_time: '01 Jan, 2020 1:00:00 AM',
    created_time: '10 Sep, 2026 11:00:10 AM',
    nested: { a: [1, 2] },
  };

  it('replaces modified_time and leaves every other field byte-for-byte alone', () => {
    const out = recordForUpdate(rec, new Date('2026-10-05T16:37:00Z'));
    expect(out.modified_time).toBe('05 Oct, 2026 4:37:00 PM');
    expect({ ...out, modified_time: rec.modified_time }).toEqual(rec);
    expect(out.chatbot_status).toBe(false);
    expect(out.bot_enabled).toBe(true);
  });

  it('does not mutate the stored record and does not add the field when the record has none', () => {
    const copy = JSON.parse(JSON.stringify(rec));
    recordForUpdate(rec, new Date());
    expect(rec).toEqual(copy);
    const { modified_time: _gone, ...without } = rec;
    expect('modified_time' in recordForUpdate(without, new Date())).toBe(false);
  });
});

describe('summary', () => {
  it('shows id, name and bot id only', () => {
    expect(summaryOf({ id: 'a', bot_id: 'b', name: 'N', business_id: 'secret-ish' })).toEqual({
      id: 'a',
      name: 'N',
      botId: 'b',
    });
    expect(summaryOf({ id: 'a', bot_id: 'b' }).name).toBeNull();
    expect(summaryOf({ id: 'a', bot_id: 'b', name: '  ' }).name).toBeNull();
  });
});

describe('GETA_PUBLISH_* environment', () => {
  it('defaults to fixture outside production and live in production', () => {
    expect(readGetaPublishEnv({}).mode).toBe('fixture');
    expect(readGetaPublishEnv({ NODE_ENV: 'development' }).mode).toBe('fixture');
    expect(readGetaPublishEnv({ NODE_ENV: 'production' }).mode).toBe('live');
  });

  it('honours an explicit mode and the tuning values', () => {
    const e = readGetaPublishEnv({
      NODE_ENV: 'production',
      GETA_PUBLISH_MODE: 'fixture',
      GETA_PUBLISH_MAX_ATTEMPTS: '5',
      GETA_PUBLISH_ALLOW_PRIVATE_HOSTS: 'true',
    });
    expect(e).toMatchObject({ mode: 'fixture', maxAttempts: 5, allowPrivateHosts: true });
    expect(readGetaPublishEnv({}).allowPrivateHosts).toBe(false);
    expect(readGetaPublishEnv({}).timeoutMs).toBe(15_000);
  });

  it('refuses a bad value with a readable message', () => {
    expect(() => readGetaPublishEnv({ GETA_PUBLISH_MODE: 'sandbox' })).toThrow(/Geta publish/);
    expect(() => readGetaPublishEnv({ GETA_PUBLISH_MAX_ATTEMPTS: '0' })).toThrow(/MAX_ATTEMPTS/);
  });
});
