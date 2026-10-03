import { describe, expect, it } from 'vitest';
import {
  applyTemplateEvent,
  languageMatches,
  localStatusFor,
  normalizeQualityScore,
  type TemplateFacts,
} from '../../../src/modules/whatsapp-cloud-api-waba/template-event-rules';

const NOW = new Date('2026-10-02T10:00:00Z');
const row = (over: Partial<TemplateFacts> = {}): TemplateFacts => ({
  status: 'pending',
  metaStatus: 'PENDING',
  qualityScore: null,
  category: 'marketing',
  approvedAt: null,
  metaTemplateId: '123',
  ...over,
});

describe('status updates (TW-TPL-029 rule 4)', () => {
  it('approves: Meta status, local status, and approved_at once', () => {
    const p = applyTemplateEvent(
      'message_template_status_update',
      { event: 'approved', message_template_id: 123 },
      row(),
      NOW,
    )!;
    expect(p).toMatchObject({
      metaStatus: 'APPROVED',
      status: 'approved',
      approvedAt: NOW,
      rejectionReasonCode: null,
    });
    const again = applyTemplateEvent(
      'message_template_status_update',
      { event: 'APPROVED' },
      row({ approvedAt: new Date('2026-09-01') }),
      NOW,
    )!;
    expect(again.approvedAt).toBeUndefined();
  });

  it('records the rejection reason, defaulting to NONE', () => {
    expect(
      applyTemplateEvent(
        'message_template_status_update',
        { event: 'REJECTED', reason: 'invalid_format' },
        row(),
        NOW,
      ),
    ).toMatchObject({
      metaStatus: 'REJECTED',
      status: 'rejected',
      rejectionReasonCode: 'INVALID_FORMAT',
    });
    expect(
      applyTemplateEvent('message_template_status_update', { event: 'REJECTED' }, row(), NOW)!
        .rejectionReasonCode,
    ).toBe('NONE');
  });

  it('pauses for 24 hours on PAUSED and marks the local status paused', () => {
    const p = applyTemplateEvent(
      'message_template_status_update',
      { event: 'PAUSED' },
      row({ status: 'approved' }),
      NOW,
    )!;
    expect(p.pausedUntil).toEqual(new Date('2026-10-03T10:00:00Z'));
    expect(p.status).toBe('paused');
    expect(p.metaStatus).toBe('PAUSED');
  });

  it('handles the states Reference never listed (FLAGGED, REINSTATED) without throwing', () => {
    expect(
      applyTemplateEvent('message_template_status_update', { event: 'FLAGGED' }, row(), NOW),
    ).toMatchObject({ metaStatus: 'FLAGGED' });
    expect(
      applyTemplateEvent('message_template_status_update', { event: 'REINSTATED' }, row(), NOW),
    ).toMatchObject({ metaStatus: 'REINSTATED' });
  });

  it('ignores an event with no state', () => {
    expect(applyTemplateEvent('message_template_status_update', {}, row(), NOW)).toBeNull();
  });

  it('backfills a missing Meta id on a row matched by name', () => {
    const p = applyTemplateEvent(
      'message_template_status_update',
      { event: 'PENDING', message_template_id: 999 },
      row({ metaTemplateId: null }),
      NOW,
    )!;
    expect(p.metaTemplateId).toBe('999');
  });

  it('maps Meta states to the local status', () => {
    expect(localStatusFor('IN_APPEAL')).toBe('pending');
    expect(localStatusFor('DISABLED')).toBe('disabled');
    expect(localStatusFor('PAUSED')).toBe('paused');
    expect(localStatusFor('DELETED')).toBe('deleted');
    expect(localStatusFor('SOMETHING_NEW')).toBeNull();
  });
});

describe('quality and category updates (TW-TPL-030)', () => {
  it('stores the score and pauses a red marketing template for a day', () => {
    const p = applyTemplateEvent(
      'message_template_quality_update',
      { new_quality_score: 'RED' },
      row(),
      NOW,
    )!;
    expect(p.qualityScore).toBe('RED');
    expect(p.pausedUntil).toEqual(new Date('2026-10-03T10:00:00Z'));
  });

  it('does not auto-pause an authentication template', () => {
    const p = applyTemplateEvent(
      'message_template_quality_update',
      { new_quality_score: 'RED' },
      row({ category: 'authentication' }),
      NOW,
    )!;
    expect(p.qualityScore).toBe('RED');
    expect(p.pausedUntil).toBeUndefined();
  });

  it('keeps the old score when Meta says UNKNOWN, and reads a nested score object', () => {
    expect(normalizeQualityScore('UNKNOWN', 'GREEN')).toBe('GREEN');
    expect(normalizeQualityScore({ score: 'yellow' }, null)).toBe('YELLOW');
    expect(normalizeQualityScore(undefined, null)).toBe('UNKNOWN');
  });

  it('upper-cases the corrected category (both field names Meta has used)', () => {
    expect(
      applyTemplateEvent('template_category_update', { new_category: 'marketing' }, row(), NOW)!
        .metaCategory,
    ).toBe('MARKETING');
    expect(
      applyTemplateEvent('template_category_update', { correct_category: 'utility' }, row(), NOW)!
        .metaCategory,
    ).toBe('UTILITY');
    expect(applyTemplateEvent('template_category_update', {}, row(), NOW)).toBeNull();
  });

  it('only marks a components update as seen', () => {
    expect(
      applyTemplateEvent(
        'message_template_components_update',
        { message_template_id: 1 },
        row(),
        NOW,
      ),
    ).toEqual({ lastSyncedAt: NOW });
  });

  it('ignores a field it does not know', () => {
    expect(applyTemplateEvent('something_else', {}, row(), NOW)).toBeNull();
  });
});

describe('languageMatches', () => {
  it('tolerates the region Meta resolved', () => {
    expect(languageMatches('en', 'en_US')).toBe(true);
    expect(languageMatches('en_US', 'en')).toBe(true);
    expect(languageMatches('en-GB', 'en_gb')).toBe(true);
    expect(languageMatches('hi', 'en_US')).toBe(false);
  });
});
