import { HttpStatus, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  ERROR_CODES,
  canonicalizeLocalPhone,
  type AddDncInput,
  type DncAddResult,
  type DncEntry,
  type DncList,
  type DncListQuery,
  type DncSource,
  type ImportDncInput,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { decodeCursor, encodeCursor } from '../../common/pagination/cursor';
import { DatabaseService } from '../../infra/db/database.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';

const MODULE_KEY = 'compliance_dnc';
/** Rows per INSERT statement: a list of 100,000 numbers is a hundred statements, never one giant one. */
const CHUNK = 1000;
/** A request can hold this many numbers at most (the body limit allows about 9,000); more is refused rather than half applied. */
const IMPORT_MAX_NUMBERS = 20_000;
const SAMPLES = 10;

type Raw = Record<string, unknown>;

/** The header names a phone column may have, after lower-casing and dropping everything but letters and digits. */
const PHONE_HEADERS = new Set(['phone', 'phonenumber', 'mobile', 'mobilenumber', 'number', 'msisdn', 'tel', 'telephone', 'cell', 'cellphone', 'whatsapp']);

/**
 * The workspace's Do-Not-Call list (BL-181, spec docs/specs/privacy-and-data-governance.md section 11.11): numbers that must not get
 * marketing by voice or SMS. The ConsentGate reads the table (reason `on_dnc_list`); this class is the only writer. Every change is
 * audited (a batch is one audit row with a count, never the numbers) and emitted. No registry is called: a workspace loads what it is
 * entitled to download.
 */
@Injectable()
export class DncService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  async list(query: DncListQuery): Promise<DncList> {
    const orgId = RequestContextStore.orgId();
    const digits = (query.q ?? '').replace(/[^0-9]/g, '');
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    return this.db.tx(async (tx) => {
      const match = digits === '' ? sql`true` : sql`e.phone_digits LIKE ${`%${digits}%`}`;
      const bound = cursor
        ? sql`(e.created_at, e.id) < (${(cursor.createdAtIso ?? cursor.createdAt.toISOString())}::timestamptz, ${cursor.id})`
        : sql`true`;
      const res = await tx.execute(sql`
        SELECT e.id, e.uuid, e.phone, e.source, e.note, e.created_at, u.uuid AS user_uuid, u.full_name,
               to_char(e.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_iso
        FROM dnc_entries e
        LEFT JOIN users u ON u.org_id = e.org_id AND u.id = e.added_by
        WHERE e.org_id = ${orgId} AND ${match} AND ${bound}
        ORDER BY e.created_at DESC, e.id DESC
        LIMIT ${query.limit + 1}`);
      const rows = res.rows as Raw[];
      const hasMore = rows.length > query.limit;
      const shown = hasMore ? rows.slice(0, query.limit) : rows;
      const last = shown[shown.length - 1];
      const total = await tx.execute(
        sql`SELECT count(*)::int AS n FROM dnc_entries WHERE org_id = ${orgId}`,
      );
      return {
        data: shown.map(toEntry),
        page: {
          nextCursor:
            hasMore && last
              ? encodeCursor({
                  createdAt: new Date(last.created_at as string),
                  createdAtIso: String(last.created_iso),
                  id: Number(last.id),
                })
              : null,
          hasMore,
          limit: query.limit,
        },
        total: Number((total.rows[0] as Raw).n),
      };
    });
  }

  async add(input: AddDncInput): Promise<DncAddResult> {
    return this.insert(input.numbers, input.defaultCountryCode, input.source, input.note);
  }

  async importCsv(input: ImportDncInput): Promise<DncAddResult> {
    const numbers = phoneCells(input.csv);
    if (numbers === null) {
      throw new AppError(
        ERROR_CODES.COMPLIANCE_DNC_INVALID,
        'The file has no phone number column. Name it phone, mobile or number, or put the numbers in the first column.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (numbers.length > IMPORT_MAX_NUMBERS) {
      throw new AppError(
        ERROR_CODES.COMPLIANCE_DNC_INVALID,
        `The file has more than ${IMPORT_MAX_NUMBERS} numbers. Split it and import the parts one by one.`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return this.insert(numbers, input.defaultCountryCode, input.source, input.note);
  }

  async remove(uuid: string): Promise<void> {
    const orgId = RequestContextStore.orgId();
    await this.db.tx(async (tx) => {
      const res = await tx.execute(sql`
        DELETE FROM dnc_entries WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid RETURNING id, source`);
      const row = res.rows[0] as Raw | undefined;
      if (!row) {
        throw new AppError(
          ERROR_CODES.COMPLIANCE_DNC_NOT_FOUND,
          'That number is not on the Do-Not-Call list.',
          HttpStatus.NOT_FOUND,
        );
      }
      await this.audit.record(tx, {
        module: MODULE_KEY,
        recordId: Number(row.id),
        action: 'delete',
        delta: { entry: { old: 'listed', new: 'removed' } },
      });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: Number(row.id),
        eventType: 'compliance.dnc_removed',
        payload: { count: 1 },
      });
    });
  }

  // --- the write ------------------------------------------------------------------------------------------------------------------

  private async insert(
    raw: readonly string[],
    defaultCountryCode: string | undefined,
    source: DncSource,
    note: string | undefined,
  ): Promise<DncAddResult> {
    const ctx = RequestContextStore.require();
    const orgId = ctx.orgId;
    const valid = new Map<string, string>();
    const invalidSamples: string[] = [];
    let invalid = 0;
    for (const item of raw) {
      const phone = canonicalizeLocalPhone(item, defaultCountryCode?.replace(/\D/g, '') || undefined);
      if (!phone) {
        invalid += 1;
        if (invalidSamples.length < SAMPLES) invalidSamples.push(item.slice(0, 40));
        continue;
      }
      valid.set(phone.e164, phone.e164);
    }
    const numbers = [...valid.values()];
    return this.db.tx(async (tx) => {
      let added = 0;
      for (let i = 0; i < numbers.length; i += CHUNK) {
        const part = numbers.slice(i, i + CHUNK);
        const values = sql.join(
          part.map(
            (p) => sql`(${orgId}, ${p}, ${source}, ${note ?? null}, ${ctx.userId ?? null})`,
          ),
          sql`, `,
        );
        const res = await tx.execute(sql`
          INSERT INTO dnc_entries (org_id, phone, source, note, added_by) VALUES ${values}
          ON CONFLICT (org_id, phone_digits) DO NOTHING RETURNING id`);
        added += res.rows.length;
      }
      if (added > 0) await this.record(tx, orgId, added, source);
      return { added, alreadyListed: numbers.length - added, invalid, invalidSamples };
    });
  }

  private async record(tx: Tx, _orgId: number, count: number, source: DncSource): Promise<void> {
    await this.audit.record(tx, {
      module: MODULE_KEY,
      recordId: 0,
      action: 'insert',
      delta: { added: { old: null, new: count }, source: { old: null, new: source } },
    });
    await this.outbox.emit(tx, {
      aggregateModule: MODULE_KEY,
      aggregateId: 0,
      eventType: 'compliance.dnc_added',
      payload: { count, source },
    });
  }
}

const toEntry = (r: Raw): DncEntry => ({
  id: r.uuid as string,
  phone: r.phone as string,
  source: r.source as DncSource,
  note: (r.note as string | null) ?? null,
  addedBy: r.user_uuid ? { id: r.user_uuid as string, name: (r.full_name as string | null) ?? null } : null,
  createdAt: new Date(r.created_at as string).toISOString(),
});

// --- reading a file ---------------------------------------------------------------------------------------------------------------

/** One line of a CSV into its cells: a comma, semicolon, tab or pipe separates, double quotes group (a doubled quote is a quote). */
function cellsOf(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/**
 * The phone numbers of a CSV text: the column whose header says phone / mobile / number (any case), else the first column of a file with
 * no header. A first line in which any cell looks like a phone number is data, not a header. Null when the text has no line at all.
 */
export function phoneCells(text: string): string[] | null {
  const lines = text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '');
  if (lines.length === 0) return null;
  const first = lines[0]!;
  const delimiter = [',', ';', '\t', '|'].reduce((best, d) =>
    first.split(d).length > first.split(best).length ? d : best,
  );
  const head = cellsOf(first, delimiter);
  const looksLikeNumber = (c: string) => canonicalizeLocalPhone(c, '91') !== null && /\d{7,}/.test(c.replace(/\D/g, ''));
  const named = head.findIndex((h) => PHONE_HEADERS.has(h.toLowerCase().replace(/[^a-z0-9]/g, '')));
  const headerless = named < 0 && head.some(looksLikeNumber);
  const column = named >= 0 ? named : 0;
  const body = named >= 0 || !headerless ? lines.slice(1) : lines;
  const out: string[] = [];
  for (const line of body) {
    const cell = cellsOf(line, delimiter)[column];
    if (cell) out.push(cell.slice(0, 40));
    if (out.length > IMPORT_MAX_NUMBERS) break;
  }
  return out.slice(0, IMPORT_MAX_NUMBERS + 1);
}

