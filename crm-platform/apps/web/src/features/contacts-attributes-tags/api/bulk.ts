'use client';

import { z } from 'zod';
import { BULK_IDS_MAX } from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';
import { toApiError } from '@/lib/api/errors';
import type { BulkTarget } from '../lib/selection';
import { contactFilterBody } from './contacts';
import {
  bulkResultSchema,
  bulkSelectionResultSchema,
  dedupePreviewSchema,
  dedupeResultSchema,
} from './schemas';

/**
 * Bulk actions over a selection (TW-CON-019..025). A target is explicit ids or the saved filter behind
 * "select all N matching"; the API resolves a filter itself, so every action works for both. One request per
 * action, one result shape: how many matched, how many changed, which ones failed.
 */

/** The `ids` / `filter` half of every bulk body. */
export function selectionBody(target: BulkTarget) {
  return target.kind === 'ids' ? { ids: target.ids } : { filter: contactFilterBody(target.filter) };
}

/**
 * "Send campaign" from the Hub: a broadcast draft whose audience is this selection (ticked rows open in the wizard's Contacts mode), created so the wizard opens on it. Returns the draft's
 * id (the guided flow resumes at `/campaigns/create?draft=<id>`).
 */
export async function startCampaignDraft(target: BulkTarget): Promise<string> {
  const draft = await apiFetch('/broadcast-wizard/drafts', {
    method: 'POST',
    body: {
      // Ticked rows are the wizard's own "contacts" mode (`contactIds`); a whole filtered view has no equivalent there, so it travels as
      // the `selection` source.
      audience:
        target.kind === 'ids'
          ? { groupIds: [], segmentIds: [], rules: null, contactIds: target.ids }
          : { groupIds: [], segmentIds: [], rules: null, selection: selectionBody(target) },
    },
    schema: z.object({ id: z.string().uuid() }),
  });
  return draft.id;
}

export interface BulkOutcome {
  matched: number;
  changed: number;
  failed: number;
}

/** Explicit id lists are capped per request; a longer one is sent in slices and the outcomes added up. */
async function run(path: string, target: BulkTarget, extra: object = {}): Promise<BulkOutcome> {
  const bodies =
    target.kind === 'ids' && target.ids.length > BULK_IDS_MAX
      ? Array.from({ length: Math.ceil(target.ids.length / BULK_IDS_MAX) }, (_, i) => ({
          ids: target.ids.slice(i * BULK_IDS_MAX, (i + 1) * BULK_IDS_MAX),
        }))
      : [selectionBody(target)];
  const total: BulkOutcome = { matched: 0, changed: 0, failed: 0 };
  for (const body of bodies) {
    const r = await apiFetch(path, {
      method: 'POST',
      body: { ...body, ...extra },
      schema: bulkSelectionResultSchema,
    });
    total.matched += r.matched;
    total.changed += r.changed;
    total.failed += r.failedCount;
  }
  return total;
}

/** `eraseHistory: false` keeps the conversations without the contacts' identity; absent means they are erased with the contact. */
export const bulkDelete = (target: BulkTarget, opts: { eraseHistory?: boolean } = {}) =>
  run('/contacts/bulk/delete', target, opts.eraseHistory === false ? { eraseHistory: false } : {});

export const bulkGroupMembership = (
  target: BulkTarget,
  groupId: string,
  action: 'add' | 'remove',
) => run('/contacts/bulk/group', target, { groupId, action });

/** By tag id, or by name (adding a name that matches no tag creates the tag). */
export const bulkTag = (
  target: BulkTarget,
  action: 'add' | 'remove',
  tag: { tagId?: string; name?: string },
) => run('/contacts/bulk/tag', target, { action, ...tag });

/**
 * Hands the target to one person, or to nobody (`null`). Unlike `bulkUpdate` this takes "all N matching" too, so a whole
 * person's book moves in one request (`POST /contacts/bulk/owner`); the API holds the target to the caller's record scope.
 */
export const bulkOwner = (target: BulkTarget, ownerId: string | null) =>
  run('/contacts/bulk/owner', target, { ownerId });

/**
 * Exports as CSV. The API streams the file (at most 200,000 rows), so this reads the response as a blob rather than
 * through the JSON client. Returns the file and the filename the server suggested.
 */
export async function exportContacts(
  target: BulkTarget,
  signal?: AbortSignal,
): Promise<{ blob: Blob; filename: string }> {
  const res = await fetch('/api/v2/contacts/export', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/csv, application/json',
      'X-Request-Id': crypto.randomUUID(),
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: JSON.stringify({ ...selectionBody(target), bom: true }),
    credentials: 'same-origin',
    signal,
  });
  if (!res.ok) {
    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    throw toApiError(res.status, json, res.headers.get('x-request-id'));
  }
  const disposition = res.headers.get('content-disposition') ?? '';
  const filename = /filename="?([^";]+)"?/.exec(disposition)?.[1] ?? 'contacts-export.csv';
  return { blob: await res.blob(), filename };
}

// --- dedupe (TW-CON-025): preview the duplicate sets, then merge them into the oldest of each ---

export const previewDuplicates = (signal?: AbortSignal) =>
  apiFetch('/contacts/duplicates', { schema: dedupePreviewSchema, signal });

/** Merges up to `maxSets` sets per call; the answer says how many are left, so callers loop until it is 0. */
export const mergeDuplicates = (maxSets = 1000) =>
  apiFetch('/contacts/dedupe', { method: 'POST', body: { maxSets }, schema: dedupeResultSchema });

/** The fields a bulk update can set; each one left out is left as it is on every contact. */
export interface BulkUpdateValues {
  lifecycleStage?: string;
  status?: string;
  /** A person's id; `null` clears the owner. */
  ownerId?: string | null;
  lostReason?: string | null;
  otherLostReason?: string | null;
  /** Custom properties by key, in their stored type; `null` clears that property on every contact. Keys left out are not touched. */
  customFields?: Record<string, unknown>;
}

/**
 * Sets the same fields on the selected contacts (`POST /contacts/bulk/update`). Explicit ids only (the API takes at most 500
 * per call, so a longer list is sent in slices); each row succeeds or fails on its own, so a few bad ones never sink the rest.
 */
export async function bulkUpdate(
  ids: readonly string[],
  values: BulkUpdateValues,
): Promise<BulkOutcome> {
  const total: BulkOutcome = { matched: 0, changed: 0, failed: 0 };
  for (let i = 0; i < ids.length; i += BULK_IDS_MAX) {
    const r = await apiFetch('/contacts/bulk/update', {
      method: 'POST',
      body: { ids: ids.slice(i, i + BULK_IDS_MAX), values },
      schema: bulkResultSchema,
    });
    total.matched += r.succeeded.length + r.failed.length;
    total.changed += r.succeeded.length;
    total.failed += r.failed.length;
  }
  return total;
}
