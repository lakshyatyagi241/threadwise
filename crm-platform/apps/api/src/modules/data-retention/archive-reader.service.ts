import { Inject, Injectable, Optional } from '@nestjs/common';
import { RequestContextStore } from '../../common/context/request-context';
import { StringDecoder } from 'node:string_decoder';
import { createGunzip } from 'node:zlib';
import {
  ARCHIVE_STORAGE,
  type ArchiveStorage,
} from '../../infra/providers/data-retention/archive-storage.port';
import { objectKeyOf } from './archive-keys';
import { RETENTION_POLICIES, STREAM_POLICIES, type StreamPolicy } from './retention-policies';

/** One archived line: the columns the policy kept, exactly as `to_json` wrote them (timestamps are ISO text with microseconds). */
export type ArchivedRow = Record<string, unknown>;

/** A read spanning more than this many months is a mistake (a defaulted `from`), and each month costs a storage request. */
const MAX_MONTHS = 240;

/**
 * Reads rows back out of the archive for drill-downs and exports that reach past the live window
 * (docs/superpowers/specs/2026-10-16-event-based-analytics-design.md, section 6). The key of a workspace's month is known, so no manifest
 * and no listing is needed, and another workspace's object is never opened. Rows come out in id order, month by month, without holding
 * more than one chunk of a month in memory.
 */
@Injectable()
export class ArchiveReader {
  constructor(
    @Inject(ARCHIVE_STORAGE) private readonly storage: ArchiveStorage,
    @Optional()
    @Inject(RETENTION_POLICIES)
    private readonly policies: readonly StreamPolicy[] = STREAM_POLICIES,
  ) {}

  /**
   * Rows of `org` in `stream` whose partition key is in `[from, to)`. A month with no object contributes nothing.
   * Outside a request (a worker job, a script) the caller must pass `{ trusted: true }`, meaning the workspace id came from its own
   * data and not from a client; without it a read with no request context is refused.
   */
  async *stream(
    stream: string,
    org: number,
    from: Date,
    to: Date,
    opts: { trusted?: boolean } = {},
  ): AsyncGenerator<ArchivedRow> {
    const policy = this.policies.find((p) => p.stream === stream);
    if (!policy) throw new Error(`no retention policy for stream ${JSON.stringify(stream)}`);
    if (!Number.isSafeInteger(org) || org < 0) {
      throw new Error(`workspace id must be a non-negative integer, got ${org}`);
    }
    // Archive objects are not behind row-level security, so the tenant check is made here: inside a request, a workspace user can only
    // read its own workspace, whatever id a caller forwards. With no request context the caller has to vouch for the id.
    const ctx = RequestContextStore.peek();
    if (ctx) {
      if (ctx.actorType !== 'platform_operator' && ctx.orgId !== org) {
        throw new Error('archive: the requested workspace is not the one this request belongs to');
      }
    } else if (!opts.trusted) {
      throw new Error('archive: reading outside a request needs { trusted: true }');
    }
    const lo = from.getTime();
    const hi = to.getTime();
    if (!(lo < hi)) return;

    for (const month of monthsOf(from, to)) {
      const source = await this.storage.openRead(objectKeyOf(stream, month, org));
      if (!source) continue;
      const gunzip = createGunzip();
      // `pipe` does not forward errors, and a truncated object must fail the read, not end it quietly.
      source.on('error', (err) => gunzip.destroy(err));
      const decoded = source.pipe(gunzip);
      const decoder = new StringDecoder('utf8');
      let tail = '';
      try {
        for await (const chunk of decoded) {
          tail += decoder.write(chunk as Buffer);
          let at = tail.indexOf('\n');
          while (at !== -1) {
            const line = tail.slice(0, at);
            tail = tail.slice(at + 1);
            const row = parseRow(line, policy.partitionKey);
            if (row && inRange(row.at, lo, hi)) yield row.value;
            at = tail.indexOf('\n');
          }
        }
        const last = parseRow(tail + decoder.end(), policy.partitionKey);
        if (last && inRange(last.at, lo, hi)) yield last.value;
      } finally {
        decoded.destroy();
        source.destroy();
      }
    }
  }
}

const inRange = (at: number, lo: number, hi: number) => at >= lo && at < hi;

function parseRow(line: string, key: string): { value: ArchivedRow; at: number } | null {
  if (line === '') return null;
  const value = JSON.parse(line) as ArchivedRow;
  const at = Date.parse(String(value[key]));
  if (Number.isNaN(at)) throw new Error(`archived row has no valid "${key}" timestamp`);
  return { value, at };
}

/** `YYYY-MM` of every UTC month that overlaps `[from, to)`, oldest first. */
function monthsOf(from: Date, to: Date): string[] {
  const months: string[] = [];
  let y = from.getUTCFullYear();
  let m = from.getUTCMonth();
  const last = new Date(to.getTime() - 1);
  const endY = last.getUTCFullYear();
  const endM = last.getUTCMonth();
  while (y < endY || (y === endY && m <= endM)) {
    if (months.length >= MAX_MONTHS) {
      throw new Error(`archive range spans more than ${MAX_MONTHS} months`);
    }
    months.push(`${String(y).padStart(4, '0')}-${String(m + 1).padStart(2, '0')}`);
    m += 1;
    if (m === 12) {
      m = 0;
      y += 1;
    }
  }
  return months;
}
