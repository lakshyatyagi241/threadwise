/**
 * What a Meta template webhook does to the local template row (WD-WABA-041, WD-TPL-029, 030). Pure: it takes the event and the
 * row's current facts and returns the columns to change, so every rule is pinned by a test and the SQL stays a dumb write.
 */

export interface TemplateFacts {
  status: string;
  metaStatus: string | null;
  qualityScore: string | null;
  category: string;
  approvedAt: Date | null;
  metaTemplateId: string | null;
}

export interface TemplatePatch {
  metaStatus?: string;
  status?: string;
  rejectionReasonCode?: string | null;
  pausedUntil?: Date;
  approvedAt?: Date;
  qualityScore?: string;
  metaCategory?: string;
  metaTemplateId?: string;
  lastSyncedAt: Date;
}

const DAY_MS = 86_400_000;
const QUALITY = new Set(['GREEN', 'YELLOW', 'RED', 'UNKNOWN']);

/** `new_quality_score` arrives as a string, or as `{ score }` in some Meta versions. */
export function normalizeQualityScore(raw: unknown, current: string | null): string {
  const pick = typeof raw === 'object' && raw !== null ? (raw as { score?: unknown }).score : raw;
  const v = typeof pick === 'string' ? pick.trim().toUpperCase() : '';
  if (!QUALITY.has(v) || v === 'UNKNOWN') return current ?? 'UNKNOWN';
  return v;
}

/** Meta's template state to the local `status` column; every state not listed leaves the local status as it was. */
export function localStatusFor(metaStatus: string): string | null {
  switch (metaStatus) {
    case 'APPROVED':
      return 'approved';
    case 'REJECTED':
      return 'rejected';
    case 'PENDING':
    case 'IN_APPEAL':
      return 'pending';
    default:
      return null;
  }
}

export function applyTemplateEvent(
  field: string,
  value: Record<string, unknown>,
  row: TemplateFacts,
  now: Date,
): TemplatePatch | null {
  const patch: TemplatePatch = { lastSyncedAt: now };
  const id = value.message_template_id;
  // A row matched by name has no Meta id yet: backfill it.
  if (id !== undefined && id !== null && !row.metaTemplateId) patch.metaTemplateId = String(id);

  switch (field) {
    case 'message_template_status_update': {
      const event = String(value.event ?? '').toUpperCase();
      if (!event) return null;
      patch.metaStatus = event;
      patch.rejectionReasonCode =
        event === 'REJECTED' ? String(value.reason ?? '').toUpperCase() || 'NONE' : null;
      if (event === 'PAUSED') patch.pausedUntil = new Date(now.getTime() + DAY_MS);
      const local = localStatusFor(event);
      if (local) patch.status = local;
      if (event === 'APPROVED' && !row.approvedAt) patch.approvedAt = now;
      return patch;
    }
    case 'message_template_quality_update': {
      const score = normalizeQualityScore(
        value.new_quality_score ?? value.quality_score,
        row.qualityScore,
      );
      if (
        score === (row.qualityScore ?? 'UNKNOWN') &&
        (value.new_quality_score ?? value.quality_score) === undefined
      )
        return null;
      patch.qualityScore = score;
      // A red template is paused for a day, except authentication ones (those stay blocked at send time instead).
      if (score === 'RED' && row.category.toLowerCase() !== 'authentication')
        patch.pausedUntil = new Date(now.getTime() + DAY_MS);
      return patch;
    }
    case 'template_category_update': {
      const category = String(value.new_category ?? value.correct_category ?? '').toUpperCase();
      if (!category) return null;
      patch.metaCategory = category;
      return patch;
    }
    case 'message_template_components_update':
      // Logged only: the local copy is not overwritten (WaDesk). The row is still marked as seen.
      return { lastSyncedAt: now };
    default:
      return null;
  }
}

/** `en` matches `en_US` and the other way round: Meta reports the region it resolved, the template stored the language asked for. */
export function languageMatches(stored: string, reported: string): boolean {
  const a = stored.toLowerCase().replace('-', '_');
  const b = reported.toLowerCase().replace('-', '_');
  return a === b || a.split('_')[0] === b.split('_')[0];
}
