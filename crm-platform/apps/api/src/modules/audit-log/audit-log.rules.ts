import { HttpStatus } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import {
  AUDIT_LOG_DEFAULT_RANGE_DAYS,
  AUDIT_LOG_MAX_RANGE_DAYS,
  ERROR_CODES,
  type AuditActorKind,
  type AuditLogFilters,
} from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';

export const DAY_MS = 24 * 60 * 60 * 1000;

/** `audit_log.actor_type` values the screen names; anything else is "other". */
const KNOWN_ACTOR_TYPES = [
  'user',
  'system',
  'api_key',
  'bot',
  'partner_agent',
  'candidate',
] as const;

export function actorKindOf(actorType: string): AuditActorKind {
  return (KNOWN_ACTOR_TYPES as readonly string[]).includes(actorType)
    ? (actorType as AuditActorKind)
    : 'other';
}

export interface AuditWindow {
  from: Date;
  to: Date;
}

/**
 * The window every read and export is bounded by (the partitions outside it are never touched). `to` defaults to a minute ahead of now
 * (a row written this second is in), `from` to AUDIT_LOG_DEFAULT_RANGE_DAYS before `to`. 422 AUDIT_RANGE_INVALID when `to` is not after
 * `from` or the window is longer than AUDIT_LOG_MAX_RANGE_DAYS.
 */
export function resolveWindow(
  f: Pick<AuditLogFilters, 'from' | 'to'>,
  now: Date = new Date(),
): AuditWindow {
  const to = f.to ? new Date(f.to) : new Date(now.getTime() + 60_000);
  const from = f.from
    ? new Date(f.from)
    : new Date(to.getTime() - AUDIT_LOG_DEFAULT_RANGE_DAYS * DAY_MS);
  if (
    Number.isNaN(from.getTime()) ||
    Number.isNaN(to.getTime()) ||
    to.getTime() <= from.getTime()
  ) {
    throw new AppError(
      ERROR_CODES.AUDIT_RANGE_INVALID,
      'The end of the range must be after its start.',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
  if (to.getTime() - from.getTime() > AUDIT_LOG_MAX_RANGE_DAYS * DAY_MS) {
    throw new AppError(
      ERROR_CODES.AUDIT_RANGE_INVALID,
      `Choose a range of at most ${AUDIT_LOG_MAX_RANGE_DAYS} days.`,
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
  return { from, to };
}

/** `%`, `_` and `\` in a user's text are literal in a LIKE (the Reference's own search let them act as wildcards; ours does not). */
export const likeEscape = (text: string): string => text.replace(/[\\%_]/g, (c) => `\\${c}`);

/** A position in the list: `at` as Postgres printed it (microseconds survive a round trip) and the row id. */
export interface RowPosition {
  atText: string;
  id: number;
}

const POSITION = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

export function encodePosition(p: RowPosition): string {
  return Buffer.from(`${p.atText}|${p.id}`, 'utf8').toString('base64url');
}

/** Decodes a cursor or an entry id; null when it is not one this module produced. */
export function decodePosition(raw: string): RowPosition | null {
  let text: string;
  try {
    text = Buffer.from(raw, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const [atText, idRaw, ...rest] = text.split('|');
  const id = Number(idRaw);
  if (
    rest.length > 0 ||
    !atText ||
    !POSITION.test(atText) ||
    !Number.isSafeInteger(id) ||
    id <= 0
  ) {
    return null;
  }
  return { atText, id };
}

export interface FilterContext {
  orgId: number;
  window: AuditWindow;
  /** `users.id` of the `actorId` filter (resolved by the caller); undefined = no actor filter. */
  actorDbId?: number;
  after?: RowPosition | null;
}

/**
 * The WHERE of the list, the facets and the export, over `audit_log a`. Always names `org_id` and an `at` range (RLS sits underneath;
 * the range prunes partitions and lets the (org_id, at, id) index answer). Text search is the module and the action only.
 */
export function buildWhere(f: AuditLogFilters, ctx: FilterContext): SQL {
  const parts: SQL[] = [
    sql`a.org_id = ${ctx.orgId}`,
    sql`a.at >= ${ctx.window.from.toISOString()}::timestamptz`,
    sql`a.at < ${ctx.window.to.toISOString()}::timestamptz`,
  ];
  if (ctx.actorDbId !== undefined) {
    parts.push(sql`a.actor_type = 'user' AND a.actor_id = ${ctx.actorDbId}`);
  }
  if (f.actorType) {
    parts.push(
      f.actorType === 'other'
        ? sql`a.actor_type NOT IN ('user', 'system', 'api_key', 'bot', 'partner_agent', 'candidate')`
        : sql`a.actor_type = ${f.actorType}`,
    );
  }
  if (f.module) parts.push(sql`a.module = ${f.module}`);
  if (f.action) parts.push(sql`a.action = ${f.action}`);
  if (f.recordId !== undefined) parts.push(sql`a.record_id = ${f.recordId}`);
  if (f.requestId) parts.push(sql`a.request_id = ${f.requestId}`);
  if (f.q) {
    const like = `%${likeEscape(f.q)}%`;
    parts.push(sql`(a.module ILIKE ${like} ESCAPE '\\' OR a.action ILIKE ${like} ESCAPE '\\')`);
  }
  if (f.actAs) parts.push(sql`jsonb_exists(a.delta, '_impersonatedBy')`);
  if (ctx.after) {
    parts.push(sql`(a.at, a.id) < (${ctx.after.atText}::timestamptz, ${ctx.after.id})`);
  }
  return sql.join(parts, sql` AND `);
}

// --- CSV ----------------------------------------------------------------------------------------------------------------------

export const CSV_BOM = '﻿';
export const CSV_HEADER = [
  'time_utc',
  'actor_type',
  'actor',
  'acting_as_support',
  'support_reason',
  'module',
  'action',
  'record_id',
  'request_id',
  'changed_fields',
  'changes',
] as const;

/** A CSV cell: quoted, and a leading formula character (`=`, `+`, `-`, `@`, tab, CR) is defused so a spreadsheet never runs it. */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) || s !== String(value ?? '') ? `"${s.replace(/"/g, '""')}"` : s;
}

export const csvLine = (cells: unknown[]): string => cells.map(csvCell).join(',');
