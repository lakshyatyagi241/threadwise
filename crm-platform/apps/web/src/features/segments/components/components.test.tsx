import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Segment } from '../api/schemas';
import { buildCatalog, invalidConditions, type FieldDef, type Lookups } from '../lib/fields';
import {
  addCondition,
  addGroup,
  emptyRoot,
  newCondition,
  type Condition,
  type Group,
} from '../lib/model';
import { LivePreview } from './live-preview';
import { AttentionChip, GroupVsSegment, MemberCount, VisibilityChip } from './parts';
import { RuleBuilder, type ConditionWarning } from './rule-builder';
import { ValueInput } from './value-inputs';

const read = (locale: string) =>
  JSON.parse(
    readFileSync(join(process.cwd(), 'messages', locale, 'segments.json'), 'utf8'),
  ) as Record<string, unknown>;

const html = (el: ReactElement, locale = 'en') =>
  renderToStaticMarkup(
    <NextIntlClientProvider
      locale={locale}
      messages={read(locale)}
      timeZone="UTC"
      now={new Date('2026-10-02T12:00:00Z')}
    >
      <QueryClientProvider client={new QueryClient()}>{el}</QueryClientProvider>
    </NextIntlClientProvider>,
  );

const lookups: Lookups = {
  stages: [
    { value: 'new', label: 'New' },
    { value: 'won', label: 'Won' },
  ],
  statuses: [],
  tags: [{ value: 't1', label: 'VIP', color: '#7C3AED' }],
  groups: [],
  users: [{ value: 'u1', label: 'Asha' }],
  properties: [{ key: 'visits', label: 'Visits', fieldType: 'integer', options: [] }],
};
const catalog = buildCatalog(lookups);
const field = (id: string): FieldDef => catalog.find((f) => f.id === id)!;
const label = (f: FieldDef) => ('key' in f.label ? f.label.key : f.label.text);
const cond = (
  id: string,
  operator: Condition['operator'],
  value: Condition['value'],
): Condition => ({
  ...newCondition(field(id)),
  operator,
  value,
});
const noop = () => undefined;

function tree(): Group {
  let r = emptyRoot();
  r = addCondition(r, r.id, cond('lifecycleStage', 'equals', 'new'));
  r = addCondition(r, r.id, cond('lastActivityAt', 'more_than_days_ago', '30'));
  r = addGroup(r, r.id, cond('tags', 'has_any', ['t1']));
  return r;
}

const builder = (over: Partial<Parameters<typeof RuleBuilder>[0]> = {}) =>
  html(
    <RuleBuilder
      root={tree()}
      catalog={catalog}
      fieldLabel={label}
      dispatch={noop}
      warnings={new Map()}
      problems={{}}
      showProblems={false}
      serverProblems={{}}
      {...over}
    />,
  );

describe('rule builder', () => {
  it('draws every condition with a field picker grouped Journey / Who / Activity / Properties, an operator and a value', () => {
    const out = builder();
    for (const g of ['Journey', 'Who', 'Activity', 'Properties'])
      expect(out).toContain(`label="${g}"`);
    expect(out).toContain('aria-label="Field of condition 1"');
    expect(out).toContain('aria-label="Operator of condition 2"');
    expect(out).toContain('aria-label="Value of condition 3.1"');
    // the date operator shows days with the "days ago" suffix
    expect(out).toContain('days ago');
  });

  it('shows the AND / OR toggle for the group and for the nested group, AND by default and OR inside', () => {
    const out = builder();
    expect(out.match(/role="radiogroup"/g)?.length).toBe(2);
    expect(out).toContain('All (AND)');
    expect(out).toContain('Any (OR)');
    expect(out.match(/aria-checked="true"/g)?.length).toBe(2);
  });

  it('numbers conditions inside a group by their place ("3.1") so labels stay unique', () => {
    const out = builder();
    expect(out).toContain('Condition 3.1');
    expect(out.match(/aria-label="Condition 1"/g)?.length).toBe(1);
  });

  it('disables moving the first item up and the last down, and offers add condition / add group', () => {
    const out = builder();
    expect(out).toContain('Add condition');
    expect(out).toContain('Add group');
    expect(out).toMatch(/disabled=""[^>]*aria-label="Move up"/);
  });

  it('disables "Add group" at the third level and says why', () => {
    let r = tree();
    const level2 = r.children[2]!.id;
    r = addGroup(r, level2, cond('tags', 'has_any', ['t1']));
    const out = builder({ root: r });
    expect(out).toContain('Groups can be nested up to 3 levels deep.');
  });

  it('flags a condition that points at something deleted, with the fix prompt', () => {
    const t = tree();
    const bad = cond('tags', 'has_any', ['t1', 'gone']);
    const root = addCondition(t, t.id, bad);
    const warnings = new Map<string, ConditionWarning>([...invalidConditions(root, catalog, true)]);
    const out = builder({ root, warnings });
    expect(out).toContain('A value you chose was deleted.');
    expect(out).toContain('Remove deleted values');
    expect(out).toContain('(deleted)');
  });

  it('shows a deleted property as such, and the validation message of an unfinished condition', () => {
    const t = tree();
    const gone = { ...cond('lifecycleStage', 'equals', ''), field: 'custom.old' };
    const root = addCondition(t, t.id, gone);
    const out = builder({
      root,
      showProblems: true,
      problems: { [gone.id]: 'field' },
      warnings: new Map([[gone.id, { type: 'field' } as ConditionWarning]]),
    });
    expect(out).toContain('Deleted property (custom.old)');
    expect(out).toContain('This property no longer exists.');
  });

  it('shows the server message on the condition it names', () => {
    const root = tree();
    const c = root.children[0] as Condition;
    expect(builder({ root, serverProblems: { [c.id]: 'a number is required' } })).toContain(
      'a number is required',
    );
  });

  it('renders in Arabic from the Arabic messages', () => {
    const out = html(
      <RuleBuilder
        root={tree()}
        catalog={catalog}
        fieldLabel={label}
        dispatch={noop}
        warnings={new Map()}
        problems={{}}
        showProblems={false}
        serverProblems={{}}
      />,
      'ar',
    );
    expect(out).toContain('إضافة شرط');
    expect(out).toContain('الكل (و)');
  });
});

describe('value inputs by operator', () => {
  const input = (id: string, operator: Condition['operator'], value: Condition['value']) =>
    html(
      <ValueInput
        field={field(id)}
        operator={operator}
        value={value}
        onChange={noop}
        label="Value"
      />,
    );

  it('text, number, date', () => {
    expect(input('source', 'contains', 'web')).toContain('value="web"');
    expect(input('leadScore', 'gt', '40')).toContain('type="number"');
    expect(input('createdAt', 'before', '2026-03-01')).toContain('type="date"');
  });

  it('relative dates take whole days with the right suffix', () => {
    expect(input('lastActivityAt', 'in_last_days', '7')).toContain('>days<');
    expect(input('lastActivityAt', 'more_than_days_ago', '7')).toContain('days ago');
    expect(input('lastActivityAt', 'in_last_days', '7')).toContain('max="3650"');
  });

  it('ranges show two inputs', () => {
    const out = input('createdAt', 'between', { from: '2026-01-01', to: '2026-02-01' });
    expect(out.match(/type="date"/g)?.length).toBe(2);
    expect(
      input('leadScore', 'between', { from: '1', to: '9' }).match(/type="number"/g)?.length,
    ).toBe(2);
  });

  it('a single choice is a select of the field options, with a stale value shown as deleted', () => {
    const out = input('lifecycleStage', 'equals', 'old');
    expect(out).toContain('<option value="new">New</option>');
    expect(out).toContain('(deleted)');
    expect(input('owner', 'equals', 'u1')).toContain('Asha');
  });

  it('several choices are chips with an Add button; typed lists are chips with a text box', () => {
    const picked = input('tags', 'has_any', ['t1']);
    expect(picked).toContain('VIP');
    expect(picked).toContain('aria-haspopup="listbox"');
    const typed = input('source', 'in', ['web', 'ads']);
    expect(typed).toContain('web');
    expect(typed).toContain('Remove ads');
  });

  it('renders nothing for an operator that takes no value', () => {
    expect(input('source', 'is_empty', null)).toBe('');
    expect(input('unsubscribed', 'is_true', null)).toBe('');
  });
});

const segment = (over: Partial<Segment> = {}): Segment => ({
  id: 'id',
  name: 'Hot leads',
  description: null,
  color: null,
  visibility: 'private',
  ownerId: 'u1',
  ownerName: 'Asha',
  rules: {
    type: 'group',
    combinator: 'and',
    children: [{ type: 'condition', field: 'source', operator: 'is_empty' }],
  },
  rulesVersion: 1,
  memberCount: 1204,
  countApproximate: false,
  memberCountAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  invalidConditions: [],
  canEdit: true,
  rowVersion: 1,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-02T00:00:00.000Z',
  ...over,
});

describe('member count, chips and help', () => {
  it('shows an exact count, "about N" for an estimate, and "-" before the first count', () => {
    expect(html(<MemberCount segment={segment()} />)).toContain('1,204');
    expect(
      html(<MemberCount segment={segment({ memberCount: 12000, countApproximate: true })} />),
    ).toContain('about 12,000');
    expect(
      html(<MemberCount segment={segment({ memberCount: null, memberCountAt: null })} />),
    ).toContain('>-<');
  });

  it('has a recount button only when the person can recount, and says when it was counted', () => {
    expect(html(<MemberCount segment={segment()} />)).not.toContain('Recount members');
    const out = html(<MemberCount segment={segment()} onRefresh={noop} />);
    expect(out).toContain('aria-label="Recount members"');
    expect(out).toContain('Counted 5 minutes ago');
  });

  it('marks a private or shared segment, and a segment that needs fixing', () => {
    expect(html(<VisibilityChip visibility="private" />)).toContain('Private');
    expect(html(<VisibilityChip visibility="shared" />)).toContain('Shared');
    expect(html(<AttentionChip count={2} />)).toContain('2 conditions need fixing');
  });

  it('explains Group vs Segment in both languages', () => {
    const en = html(<GroupVsSegment />);
    expect(en).toContain('Group: a list you fill by hand');
    expect(en).toContain('Segment: a saved rule that fills itself');
    expect(html(<GroupVsSegment />, 'ar')).toContain('الشريحة: قاعدة محفوظة تملأ نفسها');
  });
});

describe('live preview', () => {
  it('asks to finish a condition before there is anything to count', () => {
    const out = html(<LivePreview rules={null} incomplete={0} stageLabel={(v) => v} />);
    expect(out).toContain('Live preview');
    expect(out).toContain('Finish a condition to see who matches.');
  });

  it('says how many unfinished conditions are left out', () => {
    const out = html(<LivePreview rules={null} incomplete={2} stageLabel={(v) => v} />);
    expect(out).toContain('2 conditions are not finished and are left out of the preview.');
  });

  it('shows a loading state while the first answer is on its way', () => {
    const rules = {
      type: 'group',
      combinator: 'and',
      children: [{ type: 'condition', field: 'source', operator: 'is_empty' }],
    } as const;
    const out = html(<LivePreview rules={rules as never} incomplete={0} stageLabel={(v) => v} />);
    expect(out).toContain('aria-label="Loading preview"');
  });
});
