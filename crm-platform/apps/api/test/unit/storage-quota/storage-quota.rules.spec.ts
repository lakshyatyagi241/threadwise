import { describe, expect, it } from 'vitest';
import {
  BYTES_PER_GB,
  COUNTED_STORAGE_CATEGORIES,
  STORAGE_CATEGORIES,
  STORAGE_CATEGORY_DEFS,
  STORAGE_ERROR_CODES,
  PLAN_LIMIT_KEYS,
  PLATFORM_PERMISSION_KEYS,
  storageFleetResponseSchema,
  storageSummarySchema,
} from '@crm/contracts';
import {
  categoryForAreaKey,
  areaOfKey,
  teamChatBlobKey,
} from '../../../src/common/storage-meter/storage-key-category';
import {
  capBytesFromGb,
  effectiveMode,
  levelFor,
  usedPercent,
} from '../../../src/modules/storage-quota/storage-quota.rules';

describe('storage quota rules', () => {
  it('turns whole GB into bytes (2^30), and 0 or garbage into unlimited', () => {
    expect(capBytesFromGb(5)).toBe(5 * BYTES_PER_GB);
    expect(capBytesFromGb(0)).toBe(0);
    expect(capBytesFromGb(-3)).toBe(0);
    expect(capBytesFromGb(Number.NaN)).toBe(0);
    expect(capBytesFromGb(1.9)).toBe(BYTES_PER_GB);
  });

  it('levels: unlimited is always ok; 80% warns; the cap itself is full; beyond it is over', () => {
    const cap = 1000;
    expect(levelFor(10 ** 12, 0)).toBe('ok');
    expect(levelFor(799, cap)).toBe('ok');
    expect(levelFor(800, cap)).toBe('warn80');
    expect(levelFor(999, cap)).toBe('warn80');
    expect(levelFor(1000, cap)).toBe('full');
    expect(levelFor(1001, cap)).toBe('over');
  });

  it('mode: missing or unknown is observe, off is off, and enforce (not built) behaves as observe', () => {
    expect(effectiveMode(undefined)).toBe('observe');
    expect(effectiveMode('observe')).toBe('observe');
    expect(effectiveMode('OFF')).toBe('off');
    expect(effectiveMode('enforce')).toBe('observe');
    expect(effectiveMode('banana')).toBe('observe');
    expect(effectiveMode(42)).toBe('observe');
  });

  it('percent of the cap, null when unlimited', () => {
    expect(usedPercent(50, 200)).toBe(25);
    expect(usedPercent(50, 0)).toBeNull();
  });

  it('keys written straight through MediaStorageService.put get their category by area; chat/ and platform areas get none', () => {
    expect(categoryForAreaKey('marketing/7/x.png')).toBe('campaign_media');
    expect(categoryForAreaKey('scheduled/7/x.png')).toBe('scheduled_media');
    expect(categoryForAreaKey('telegram/7/1_ab.jpg')).toBe('channel_profile_media');
    expect(categoryForAreaKey('ai-training/7/ab.txt')).toBe('ai_training_file');
    expect(categoryForAreaKey('chat/7/2027/01/x.png')).toBeNull();
    expect(categoryForAreaKey('site/x.png')).toBeNull();
    expect(areaOfKey('marketing/7/x')).toBe('marketing');
    expect(areaOfKey('nope')).toBeNull();
  });

  it('a Postgres blob has a registry key of its own', () => {
    expect(teamChatBlobKey(42)).toBe('pg:team_chat_attachment_blobs:42');
  });
});

describe('storage quota contracts', () => {
  it('every category has a definition and the system kinds are never blocked or counted', () => {
    for (const c of STORAGE_CATEGORIES) expect(STORAGE_CATEGORY_DEFS[c], c).toBeDefined();
    for (const c of ['temporary_export', 'privacy_export', 'system_asset', 'payment_proof'] as const) {
      expect(STORAGE_CATEGORY_DEFS[c].counted).toBe(false);
      expect(STORAGE_CATEGORY_DEFS[c].policy).toBe('never');
    }
    expect(COUNTED_STORAGE_CATEGORIES).not.toContain('privacy_export');
  });

  it('customer-origin kinds can never be refused outright (grace, then metadata only)', () => {
    for (const c of STORAGE_CATEGORIES) {
      const d = STORAGE_CATEGORY_DEFS[c];
      if (d.origin === 'customer') expect(d.policy, c).toBe('grace_then_metadata_only');
      if (d.origin === 'agent') expect(d.policy, c).toBe('block');
    }
  });

  it('the error code, the plan limit key and the operator permission keys are registered', () => {
    expect(STORAGE_ERROR_CODES.STORAGE_QUOTA_EXCEEDED).toBe('STORAGE_QUOTA_EXCEEDED');
    expect(PLAN_LIMIT_KEYS).toContain('storage_gb');
    expect(PLATFORM_PERMISSION_KEYS).toContain('platform.workspace.storage');
    expect(PLATFORM_PERMISSION_KEYS).toContain('platform.workspace.storage_grant');
  });

  it('the summary and fleet shapes parse what the API builds', () => {
    const summary = {
      mode: 'observe',
      hotBytes: 10,
      reservedBytes: 0,
      coldBytes: 0,
      capBytes: 0,
      level: 'ok',
      overSince: null,
      byCategory: [{ category: 'inbox_media', hotBytes: 10, coldBytes: 0, objects: 1 }],
      lastReconciledAt: null,
    };
    expect(storageSummarySchema.parse(summary)).toEqual(summary);
    const fleet = {
      mode: 'observe',
      generatedAt: new Date().toISOString(),
      totals: { workspaces: 1, hotBytes: 10, coldBytes: 0, reservedBytes: 0, objects: 1 },
      byCategory: summary.byCategory,
      top: [],
      levels: { ok: 1, warn80: 0, full: 0, over: 0 },
      drift: { lastRunAt: null, workspacesWithDrift: 0, driftBytes: 0 },
    };
    expect(storageFleetResponseSchema.parse(fleet).levels.ok).toBe(1);
  });
});
