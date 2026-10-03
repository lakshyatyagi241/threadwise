import { describe, expect, it } from 'vitest';
import { LEAD_SOURCE_KINDS, LEAD_SOURCE_STATUSES } from '@crm/contracts';
import { ID, source } from '../test-fixtures';
import {
  COMING_SOON_PROVIDERS,
  STATUS_TONE,
  attentionHref,
  attentionTotal,
  canRotate,
  isConnector,
  isUuid,
  parseTab,
  sourceHref,
  sourceRow,
  sourceRows,
} from './source-view';

describe('the sources list', () => {
  it('shows the name, kind, status, token hint, last event and attention count of a source', () => {
    const r = sourceRow(source({ needsAttention: 3 }));
    expect(r).toMatchObject({
      id: ID(1),
      name: 'Zapier: Facebook lead ads',
      kind: 'webhook',
      status: 'active',
      tokenHint: 'x9Qk',
      needsAttention: 3,
      connector: false,
    });
    expect(r.lastEventAt).toBe('2026-10-03T09:30:00.000Z');
  });

  it('links the attention badge into the events filtered to the leads that wait, only when some wait', () => {
    expect(sourceRow(source({ needsAttention: 2 })).attentionHref).toBe(
      `/lead-sources/${ID(1)}?events=attention#events`,
    );
    expect(attentionHref(ID(5))).toBe(`/lead-sources/${ID(5)}?events=attention#events`);
    expect(sourceRow(source({ needsAttention: 0 })).attentionHref).toBeNull();
  });

  it('a connector source has no token to show and is told apart', () => {
    const c = source({ kind: 'connector', tokenHint: null });
    expect(isConnector(c)).toBe(true);
    expect(canRotate(c)).toBe(false);
    expect(sourceRow(c)).toMatchObject({ connector: true, tokenHint: null });
    expect(canRotate(source())).toBe(true);
  });

  it('keeps a source of a kind without a door in the list, with its kind', () => {
    for (const kind of LEAD_SOURCE_KINDS) expect(sourceRow(source({ kind })).kind).toBe(kind);
  });

  it('a blank token hint is no hint', () => {
    expect(sourceRow(source({ tokenHint: '  ' })).tokenHint).toBeNull();
    expect(sourceRow(source({ tokenHint: null })).tokenHint).toBeNull();
  });

  it('adds up what needs attention across sources', () => {
    expect(
      attentionTotal([
        source({ needsAttention: 2 }),
        source({ needsAttention: 0 }),
        source({ needsAttention: 5 }),
      ]),
    ).toBe(7);
    expect(attentionTotal([])).toBe(0);
    expect(sourceRows([source(), source({ id: ID(2) })]).map((r) => r.id)).toEqual([ID(1), ID(2)]);
  });

  it('gives each status a tone', () => {
    for (const s of LEAD_SOURCE_STATUSES) expect(STATUS_TONE[s]).toBeTypeOf('string');
    expect(STATUS_TONE.active).toBe('success');
    expect(STATUS_TONE.paused).toBe('neutral');
  });
});

describe('addresses', () => {
  it('opens the Ads tab by default and the Webhook tab when asked', () => {
    expect(parseTab(undefined)).toBe('ads');
    expect(parseTab(null)).toBe('ads');
    expect(parseTab('webhook')).toBe('webhook');
    expect(parseTab('rules')).toBe('ads');
  });

  it('builds a source address from a uuid and refuses anything else', () => {
    expect(sourceHref(ID(3))).toBe(`/lead-sources/${ID(3)}`);
    expect(isUuid(ID(3))).toBe(true);
    expect(isUuid('new')).toBe(false);
    expect(isUuid('../x')).toBe(false);
  });

  it('lists the four providers without a door as coming soon', () => {
    expect([...COMING_SOON_PROVIDERS]).toEqual(['meta', 'linkedin', 'tiktok', 'google']);
  });
});
