import { createHash } from 'node:crypto';

const hash = (text: string): string => createHash('sha256').update(text).digest('hex').slice(0, 16);

const toLf = (text: string): string => text.replace(/\r\n/g, '\n');
const toCrlf = (text: string): string => toLf(text).replace(/\n/g, '\r\n');

/**
 * The checksum recorded for a migration file: the first 16 hex characters of the sha256 of its text with line endings
 * normalised to LF, so a Windows (CRLF) checkout of the same SQL hashes the same as a Linux one.
 */
export function migrationChecksum(sql: string): string {
  return hash(toLf(sql));
}

/**
 * Every checksum a file may legitimately have been recorded under, the current one first: normalised to LF, its text as it
 * is on disk, or its CRLF form (ledgers written by older runners on a Windows checkout). A real change to the SQL matches none.
 */
export function acceptedChecksums(sql: string): string[] {
  return [...new Set([hash(toLf(sql)), hash(sql), hash(toCrlf(sql))])];
}

export function recordedChecksumMatches(recorded: string, sql: string): boolean {
  return acceptedChecksums(sql).includes(recorded);
}
