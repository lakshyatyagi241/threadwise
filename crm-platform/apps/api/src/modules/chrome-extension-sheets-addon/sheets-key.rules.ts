import { createHash, randomBytes } from 'node:crypto';
import { EXT_SHEETS_KEY_PATTERN, EXT_SHEETS_KEY_PREFIX } from '@crm/contracts';

/** A fresh key: `wsn_live_` plus 32 hex characters (the Reference format, so a client that pattern-matches a key keeps working). */
export function generateSheetsKey(): string {
  return EXT_SHEETS_KEY_PREFIX + randomBytes(16).toString('hex');
}

/**
 * sha256, not a slow hash, on purpose: the secret is 128 random bits, so there is nothing to stretch, and the key is looked up by this hash
 * on every call of a polled API. Only the hash and the last 8 characters are stored.
 */
export function hashSheetsKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

export const sheetsKeySuffix = (key: string): string => key.slice(-8);

/** Cheap shape check before any lookup: a token that cannot be one of ours never reaches the database. */
export const looksLikeSheetsKey = (token: string): boolean => EXT_SHEETS_KEY_PATTERN.test(token);

/** `wsn_live_••••••••<suffix>`: what the page prints for an active key. */
export const maskedSheetsKey = (suffix: string): string =>
  `${EXT_SHEETS_KEY_PREFIX}••••••••${suffix}`;

/** The bearer token of an `Authorization` header, or null when the header is absent or not a bearer one. */
export function bearerToken(header: string | undefined): string | null {
  if (!header || !/^Bearer\s+/i.test(header)) return null;
  const token = header.replace(/^Bearer\s+/i, '').trim();
  return token === '' ? null : token;
}

/** `last_used_at` is written at most this often per key: a polled API must not rewrite one row on every request. */
export const LAST_USED_EVERY_SECONDS = 60;
/** Requests one key may make in a minute, before the plan's own API ceiling (`api_rate_limit_per_minute`) is applied on top. */
export const SHEETS_KEY_RATE_PER_MINUTE = 120;
/** Failed authentications one address may make in a minute before it is refused outright. */
export const SHEETS_AUTH_FAILURES_PER_MINUTE = 30;

/** The capabilities a call may need, each the marketplace scope that must be consented and the permission keys the member must hold. */
export const SHEETS_CAPABILITIES = {
  readContacts: { scope: 'contacts.read', keys: ['record.contacts.read'] },
  writeContacts: {
    scope: 'contacts.write',
    // A member who may only create, or only update, can still run a sync: each row is checked against what it needs.
    keys: ['record.contacts.create', 'record.contacts.update'],
  },
  readCatalog: { scope: 'catalog.read', keys: ['cat.products.read', 'store.storefront.read'] },
  writeCatalog: {
    scope: 'catalog.write',
    keys: ['cat.products.create', 'cat.products.update', 'store.shops.manage'],
  },
} as const;
export type SheetsCapability = keyof typeof SHEETS_CAPABILITIES;
