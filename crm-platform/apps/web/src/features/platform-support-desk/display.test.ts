import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SUPP_TICKET_PRIORITIES, SUPP_TICKET_REASONS, SUPP_TICKET_STATUSES } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import { PRIORITY_TONE, STATUS_TONE, errorKey } from './lib/display';

const messages = JSON.parse(
  readFileSync(join(process.cwd(), 'messages', 'en', 'platform-support-desk.json'), 'utf8'),
)['platform-support-desk'] as Record<string, Record<string, unknown>>;

describe('errorKey', () => {
  const api = (status: number, code = 'X') => new ApiError(status, code, 'm');
  it('maps by status and code, never by message', () => {
    expect(errorKey(new Error('offline'))).toBe('network');
    expect(errorKey(api(403))).toBe('forbidden');
    expect(errorKey(api(404))).toBe('notFound');
    expect(errorKey(api(409, 'ROW_VERSION_CONFLICT'))).toBe('conflict');
    expect(errorKey(api(409, 'CONFLICT'))).toBe('closed');
    expect(errorKey(api(422))).toBe('validation');
    expect(errorKey(api(500))).toBe('unexpected');
  });
});

describe('message coverage', () => {
  it('has a label for every status, priority and reason, and a tone for each status and priority', () => {
    for (const s of SUPP_TICKET_STATUSES) {
      expect(messages.status![s], s).toBeTruthy();
      expect(STATUS_TONE[s]).toBeTruthy();
    }
    for (const p of SUPP_TICKET_PRIORITIES) {
      expect(messages.priority![p], p).toBeTruthy();
      expect(PRIORITY_TONE[p]).toBeTruthy();
    }
    for (const r of SUPP_TICKET_REASONS) expect(messages.reason![r], r).toBeTruthy();
  });
});
