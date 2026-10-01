import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EmptyState, StatTile } from '@crm/ui';
import type { RowView } from '../lib/row-view';
import { ContactAvatar, GroupChip, TagPill } from './chips';
import { ContactsGrid, ContactsTable, type ListHandlers } from './contacts-list';
import { TagsEditor } from './tags-editor';

const messages = JSON.parse(
  readFileSync(join(process.cwd(), 'messages', 'en', 'contacts-attributes-tags.json'), 'utf8'),
) as Record<string, unknown>;

const html = (el: ReactElement) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      {el}
    </NextIntlClientProvider>,
  );

const row = (over: Partial<RowView> = {}): RowView => ({
  id: '294dca7c-5806-4548-9035-dcca9befc7b1',
  name: 'Aarav Sharma',
  language: 'English',
  email: 'aarav@example.com',
  phone: '+91 98765 43210',
  memo: 'Met at the fair',
  status: '',
  stage: 'qualified',
  optedOut: false,
  groups: [{ id: 'g1', name: 'VIP', color: '#7C3AED' }],
  tags: [{ id: 't1', name: 'Hot lead', color: '#2E7D32' }],
  attributes: [{ key: 'order_id', label: 'Order Id', text: 'A12', full: 'Order Id: A12' }],
  ...over,
});

const handlers = (over: Partial<ListHandlers> = {}): ListHandlers => ({
  selected: new Set(),
  canEdit: true,
  canDelete: true,
  stageLabel: (v) => v.toUpperCase(),
  statusLabel: (v) => v,
  onToggle: () => undefined,
  onEdit: () => undefined,
  onDelete: () => undefined,
  ...over,
});

describe('ContactsTable', () => {
  const table = (
    rows: RowView[],
    over: Partial<ListHandlers> = {},
    state: 'none' | 'some' | 'all' = 'none',
  ) =>
    html(
      <ContactsTable
        rows={rows}
        headerState={state}
        onToggleAll={() => undefined}
        {...handlers(over)}
      />,
    );

  it('shows name, language, attribute chips, groups, tags, email, phone, memo and stage', () => {
    const out = table([row()]);
    for (const text of [
      'Aarav Sharma',
      'English',
      'Order Id:',
      'A12',
      'VIP',
      'Hot lead',
      'aarav@example.com',
      '+91 98765 43210',
      'Met at the fair',
      'QUALIFIED',
    ]) {
      expect(out, text).toContain(text);
    }
  });

  it('links the name to the detail page (WaDesk had no detail link)', () => {
    expect(table([row()])).toContain('href="/contacts/294dca7c-5806-4548-9035-dcca9befc7b1"');
  });

  it('labels every checkbox for screen readers and reflects the selection', () => {
    const out = table(
      [row()],
      { selected: new Set(['294dca7c-5806-4548-9035-dcca9befc7b1']) },
      'all',
    );
    expect(out).toContain('aria-label="Select all loaded contacts"');
    expect(out).toContain('aria-label="Select Aarav Sharma"');
    expect(out.match(/checked=""/g)?.length).toBe(2);
  });

  it('shows dashes for an empty groups, tags, email and phone', () => {
    const out = table([row({ groups: [], tags: [], email: '', phone: '' })]);
    expect(out.match(/&mdash;|—/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it('badges an opted-out contact', () => {
    expect(table([row({ optedOut: true })])).toContain('Opted out');
  });

  it('hides edit and delete without the permissions', () => {
    const out = table([row()], { canEdit: false, canDelete: false });
    expect(out).not.toContain('aria-label="Edit Aarav Sharma"');
    expect(out).not.toContain('aria-label="Delete Aarav Sharma"');
    expect(table([row()])).toContain('aria-label="Delete Aarav Sharma"');
  });

  it('makes tag chips filter buttons only when the API can filter by tag', () => {
    expect(table([row()])).not.toContain('Filter by Hot lead');
    expect(table([row()], { onFilterTag: () => undefined })).toContain(
      'title="Filter by Hot lead"',
    );
  });
});

describe('ContactsGrid', () => {
  it('renders one card per contact with the same data', () => {
    const out = html(
      <ContactsGrid rows={[row(), row({ id: 'other', name: 'Priya Patel' })]} {...handlers()} />,
    );
    expect(out.match(/<li /g)).toHaveLength(2);
    expect(out).toContain('Priya Patel');
    expect(out).toContain('Order Id:');
  });
});

describe('TagsEditor (WD-CON-038..040)', () => {
  const tags = [
    { id: 't1', name: 'VIP', color: '#6A1B9A' },
    { id: 't2', name: 'Lead', color: null },
  ];
  const editor = (over: Partial<Parameters<typeof TagsEditor>[0]> = {}) =>
    html(
      <TagsEditor
        attached={[tags[0]!]}
        all={tags}
        canCreate
        onAttach={() => undefined}
        onDetach={() => undefined}
        {...over}
      />,
    );

  it('shows attached tags with a remove button and marks them pressed in the picker', () => {
    const out = editor();
    expect(out).toContain('aria-label="Remove tag VIP"');
    expect(out).toContain('aria-pressed="true"');
    expect(out).toContain('aria-pressed="false"');
  });

  it('shows the empty copy when no tag is attached', () => {
    expect(editor({ attached: [] })).toContain('No tags yet.');
  });

  it('explains how to create the first tag, or that none exist when creating is not allowed', () => {
    expect(editor({ attached: [], all: [] })).toContain(
      'type a name below to create the first one',
    );
    const noCreate = editor({ attached: [], all: [], canCreate: false });
    expect(noCreate).toContain('No tags in this workspace yet.');
    expect(noCreate).not.toContain('Add tag');
  });

  it('offers the typed-name box with the workspace tags as suggestions', () => {
    const out = editor();
    expect(out).toContain('placeholder="Add or pick a tag..."');
    expect(out).toContain('<datalist');
  });
});

describe('chips and shared tiles', () => {
  it('gives the avatar its initials', () => {
    expect(html(<ContactAvatar id="x" name="Aarav Sharma" />)).toContain('>AS<');
  });

  it('colours group dots and tag pills from their own colour', () => {
    expect(html(<GroupChip name="VIP" color="#7C3AED" />)).toContain('#7C3AED');
    expect(html(<TagPill name="Hot" color="#2E7D32" />)).toContain('#2E7D32');
  });

  it('renders a stat tile and an empty state', () => {
    const tile = html(<StatTile label="Total contacts" value="120" hint="in your workspace" />);
    expect(tile).toContain('Total contacts');
    expect(tile).toContain('120');
    const empty = html(
      <EmptyState
        title="No data found"
        message="Try clearing filters"
        actions={<button>Reset</button>}
      />,
    );
    expect(empty).toContain('No data found');
    expect(empty).toContain('Reset');
  });
});
