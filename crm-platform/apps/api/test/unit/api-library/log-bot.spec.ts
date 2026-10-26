import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { apiLibraryLogItemSchema, listApiLibraryLogsQuerySchema } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { toLogItem } from '../../../src/modules/api-library/api-library.mapper';
import {
  ApiLibraryLogsRepository,
  type LogRow,
} from '../../../src/modules/api-library/api-library-logs.repository';

const dialect = new PgDialect();
function capture() {
  const seen: Array<{ sql: string; params: unknown[] }> = [];
  const tx = {
    execute: async (q: SQL) => {
      const r = dialect.sqlToQuery(q);
      seen.push({ sql: r.sql.replace(/\s+/g, ' '), params: r.params });
      return { rows: [{ uuid: 'u', n: 0 }] };
    },
  } as unknown as Tx;
  return { tx, seen };
}

describe('the bot of an API log', () => {
  it('filters by part of the bot name, current or remembered', async () => {
    const { tx, seen } = capture();
    await new ApiLibraryLogsRepository().list(tx, 1, { bot: 'welc', limit: 10, order: 'desc' });
    expect(seen[0]!.sql).toContain('l.flow_name ILIKE');
    expect(seen[0]!.sql).toContain('EXISTS (SELECT 1 FROM flows bf');
    expect(seen[0]!.params).toContain('%welc%');
  });
  it('names the bot by its current name, else the remembered one, and says where it is now', async () => {
    const { tx, seen } = capture();
    await new ApiLibraryLogsRepository().list(tx, 1, { limit: 10, order: 'desc' });
    expect(seen[0]!.sql).toContain('coalesce(f.name, l.flow_name) END AS bot_name');
    for (const state of ["'deleted'", "'paused'", "'active'", "'draft'"])
      expect(seen[0]!.sql).toContain(state);
  });
  it('keeps the bot name at the time of the run, for a bot deleted later', async () => {
    const { tx, seen } = capture();
    await new ApiLibraryLogsRepository().insert(tx, 1, {
      apiUuid: null,
      apiName: 'Orders',
      source: 'flow',
      method: 'GET',
      url: 'https://x.test',
      requestHeaders: {},
      requestBody: null,
      statusCode: 200,
      ok: true,
      durationMs: 5,
      errorKind: null,
      error: null,
      responseHeaders: {},
      responseBody: null,
      responseTruncated: false,
      userId: null,
      contactUuid: null,
      flowId: 9,
      flowRunUuid: null,
      flowNodeId: null,
    });
    expect(seen[0]!.sql).toContain('flow_name)');
    expect(seen[0]!.sql).toContain('SELECT f.name FROM flows f');
  });
  it('the item and the query carry the bot', () => {
    const row = {
      uuid: '8d6e3b27-0c0e-4c53-8e0e-3d2f0a4d2b11',
      apiUuid: null,
      apiName: 'Orders',
      source: 'flow',
      method: 'GET',
      url: 'https://x.test',
      ok: true,
      statusCode: 200,
      durationMs: 5,
      errorKind: null,
      error: null,
      botName: 'Welcome bot',
      botState: 'draft',
      createdAt: new Date('2026-10-26T10:00:00Z'),
    } as unknown as LogRow;
    const item = toLogItem(row);
    expect(item).toMatchObject({ botName: 'Welcome bot', botState: 'draft' });
    apiLibraryLogItemSchema.parse(item);
    expect(listApiLibraryLogsQuerySchema.parse({ bot: ' Welcome ' }).bot).toBe('Welcome');
  });
});
