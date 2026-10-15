import { describe, expect, it } from 'vitest';
import { buildBroadcastPlan } from '../broadcast/plan';
import { indexTemplates, linkTemplate, type TemplateRow } from '../broadcast/template-link';
import { campaigns } from '../transform/broadcast';
import { STEPS } from '../transform';
import { STEP_DEPS } from '../load/steps';
import type { Ctx } from '../transform/types';

const T = (id: number, name: string, language: string, metaId: string | null): TemplateRow => ({ id, name, language, metaId });
const rows = [T(1, 'diwali', 'en', 'M1'), T(2, 'diwali', 'hi', 'M2'), T(3, 'promo', 'en', 'M3'), T(4, 'dup_meta_a', 'en', 'MX'), T(5, 'dup_meta_b', 'en', 'MX')];
const idx = indexTemplates(rows, [['tpl-1', 1], ['tpl-2', 2], ['tpl-3', 3], ['tpl-gone', 99]]);
const doc = (o: Record<string, unknown>) => ({ _id: 'c1', broadcast_template_id: 'tpl-3', broadcast_template_name: 'promo', ...o });
const meta = (...m: string[]) => new Set(m);

describe('campaign -> template link: exact rules', () => {
  it('1. the Waboo template id, when the name agrees', () => {
    expect(linkTemplate(doc({}), idx, undefined)).toEqual({ id: 3, how: 'reference', why: null });
    expect(linkTemplate(doc({}), idx, meta('M3'))).toEqual({ id: 3, how: 'reference', why: null });
  });
  it('a name that differs from the linked template is a conflict, never a link', () => {
    expect(linkTemplate(doc({ broadcast_template_name: 'other' }), idx, undefined)).toEqual({ id: null, how: null, why: 'CONFLICT' });
  });
  it('the recipients Meta id must agree with the template id', () => {
    expect(linkTemplate(doc({}), idx, meta('M1')).why).toBe('CONFLICT');
    expect(linkTemplate(doc({}), idx, meta('M1', 'M3')).id).toBe(3); // two distinct values = no Meta id
  });
  it('2. the Meta id finds the template when the id does not resolve', () => {
    const d = doc({ broadcast_template_id: 'tpl-gone', broadcast_template_name: 'diwali' });
    expect(linkTemplate(d, idx, meta('M2'))).toEqual({ id: 2, how: 'meta', why: null });
    expect(linkTemplate(doc({ broadcast_template_id: 'tpl-gone', meta_template_id: 'M1' }), idx, undefined).id).toBe(1);
  });
  it('a Meta id shared by two templates is ambiguous; one that matches none says the template is not loaded', () => {
    expect(linkTemplate(doc({ broadcast_template_id: 'nope' }), idx, meta('MX')).why).toBe('AMBIGUOUS');
    expect(linkTemplate(doc({ broadcast_template_id: 'nope', broadcast_template_name: 'promo' }), idx, meta('MZ')).why).toBe('NOT_FOUND');
  });
  it('3. the name only when nothing else is known: one row links, several languages are ambiguous, the language disambiguates', () => {
    const named = (o: Record<string, unknown>) => doc({ broadcast_template_id: 'nope', ...o });
    expect(linkTemplate(named({ broadcast_template_name: 'promo' }), idx, undefined)).toEqual({ id: 3, how: 'name', why: null });
    expect(linkTemplate(named({ broadcast_template_name: 'diwali' }), idx, undefined).why).toBe('AMBIGUOUS');
    expect(linkTemplate(named({ broadcast_template_name: 'diwali', language: 'hi' }), idx, undefined).id).toBe(2);
    expect(linkTemplate(named({ broadcast_template_name: 'missing' }), idx, undefined).why).toBe('NOT_FOUND');
  });
  it('nothing to go on = NO_REFERENCE; an unresolved id without a name = NOT_FOUND', () => {
    expect(linkTemplate({ _id: 'c' }, idx, undefined).why).toBe('NO_REFERENCE');
    expect(linkTemplate({ _id: 'c', broadcast_template_id: 'nope' }, idx, undefined).why).toBe('NOT_FOUND');
  });
});

describe('campaign transform writes template_id', () => {
  const ctx = { fallbackAt: '2026-06-01T00:00:00.000Z', ref: () => undefined, idx: { hasUsers: false } } as unknown as Ctx;
  const camp = { _id: 'c1', id: 'c1', broadcast_id: 'c1', broadcast_name: 'Blast', type: 'whatsapp', status: 'completed', recipients: 0, broadcast_template_id: 'tpl-1', broadcast_template_name: 'diwali' };
  const run = async (templates: ReturnType<typeof indexTemplates>) => {
    const source = {
      clients: () => ['x'],
      collections: () => ['broadcasting'],
      read: async function* () {
        yield camp;
      },
      fileOf: () => null,
      badLines: () => [],
    };
    const plan = await buildBroadcastPlan({
      source: source as never,
      client: 'x',
      settings: { failedSendAttempts: 3, keepTestBroadcasts: false, nonTerminalStatus: 'cancelled' },
      contactsByDigits: new Map(),
      templates,
      shas: [],
    });
    const ref = (c: string, k: unknown) => (c === 'broadcasting' && k === 'c1' ? { table: 'wpcampaigns', id: 1, uuid: 'u' } : undefined);
    return campaigns.transform(camp, { ...ctx, ref, bcast: plan } as unknown as Ctx) as unknown as {
      rows: Array<{ row: Record<string, unknown> }>;
      soft: Array<{ code: string }>;
    };
  };
  it('links a loaded template and drops the TEMPLATE_UNLINKED soft issue', async () => {
    const o = await run(idx);
    expect(o.rows[0]!.row.template_id).toBe(1);
    expect(o.soft.map((s) => s.code)).not.toContain('TEMPLATE_UNLINKED');
  });
  it('without the template it stays NULL and is counted', async () => {
    const o = await run(indexTemplates([], []));
    expect(o.rows[0]!.row.template_id).toBeNull();
    expect(o.soft.filter((s) => s.code === 'TEMPLATE_UNLINKED')).toHaveLength(1);
  });
  it('template_id is a written column now, template_id_a / _b stay at their default', () => {
    expect(campaigns.tables.wpcampaigns!.columns.map((c) => c.name)).toContain('template_id');
    expect(campaigns.tables.wpcampaigns!.constants).not.toHaveProperty('template_id');
    expect(campaigns.tables.wpcampaigns!.constants).toMatchObject({ template_id_a: null, template_id_b: null });
  });
});

describe('load order', () => {
  it('templates load before campaigns (STEPS order and STEP_DEPS)', () => {
    const at = (h: string) => STEPS.findIndex((s) => s.handler === h);
    expect(at('templates')).toBeGreaterThanOrEqual(0);
    expect(at('templates')).toBeLessThan(at('campaigns'));
    expect(STEP_DEPS.campaigns).toContain('templates');
  });
});
