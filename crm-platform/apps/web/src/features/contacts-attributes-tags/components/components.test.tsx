import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EmptyState, StatTile } from '@crm/ui';
import { allColumns, visibleColumns, type ColumnId } from '../lib/columns';
import type { RowView } from '../lib/row-view';
import { ContactAvatar, GroupChip, TagPill } from './chips';
import { menuActions } from '../lib/row-actions';
import {
  frozenEdge,
  isScrolledSideways,
  STICKY_NAME,
  STICKY_NAME_HEAD,
  STICKY_SELECT,
} from '../lib/sticky';
import { ContactsGrid, ContactsTable, type ListHandlers } from './contacts-list';
import { ContactsPagination } from './contacts-pagination';
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
  custom: { order_id: 'A12' },
  createdAt: '2026-03-05T12:00:00.000Z',
  ...over,
});

const handlers = (over: Partial<ListHandlers> = {}): ListHandlers => ({
  selected: new Set(),
  canEdit: true,
  canDelete: true,
  stageLabel: (v) => v.toUpperCase(),
  statusLabel: (v) => v,
  onToggle: () => undefined,
  onView: () => undefined,
  onAddToGroup: () => undefined,
  onTag: () => undefined,
  onEdit: () => undefined,
  onDelete: () => undefined,
  ...over,
});

const ATTRS = [{ key: 'order_id', name: 'Order Id' }];
const EVERY_COLUMN = visibleColumns(
  allColumns(ATTRS).map((c) => c.id),
  ATTRS,
);

describe('ContactsTable', () => {
  const table = (
    rows: RowView[],
    over: Partial<ListHandlers> = {},
    state: 'none' | 'some' | 'all' = 'none',
    columns = EVERY_COLUMN,
  ) =>
    html(
      <ContactsTable
        rows={rows}
        columns={columns}
        headerState={state}
        onToggleAll={() => undefined}
        {...handlers(over)}
      />,
    );

  it('shows name, language, attribute value, groups, tags, email, phone, memo, stage and date', () => {
    const out = table([row()]);
    for (const text of [
      'Aarav Sharma',
      'English',
      'Order Id',
      'A12',
      '05 Mar 2026, 12:00 PM',
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

  it('shows a plain dash for every empty value', () => {
    const out = table([
      row({ groups: [], tags: [], email: '', phone: '', custom: {}, createdAt: '' }),
    ]);
    expect(out.match(/>-<\/span>/g)?.length).toBeGreaterThanOrEqual(6);
    expect(out).not.toContain('—');
  });

  it('falls back to "No Name" for a contact without a name', () => {
    expect(table([row({ name: '' })])).toContain('No Name');
  });

  it('draws only the chosen columns, with bold titles', () => {
    const chosen: ColumnId[] = ['name', 'phone', 'email', 'tags', 'createdOn'];
    const out = table([row()], {}, 'none', visibleColumns(chosen, ATTRS));
    for (const title of ['Contact Name', 'Phone Number', 'Email ID', 'Tags', 'Created On']) {
      expect(out, title).toContain(title);
    }
    for (const gone of ['Order Id', 'Groups', 'Language', 'Memo', 'Stage']) {
      expect(out, gone).not.toContain(`>${gone}<`);
    }
    expect(out).not.toContain('Met at the fair');
    expect(out).toContain('font-semibold');
  });

  it('shows two tag chips and folds the rest into +N with the full list on hover', () => {
    const tags = ['One', 'Two', 'Three', 'Four'].map((name, i) => ({
      id: `t${i}`,
      name,
      color: null,
    }));
    const out = table([row({ tags })]);
    expect(out).toContain('>One<');
    expect(out).toContain('>Two<');
    expect(out).not.toContain('>Three<');
    expect(out).toContain('>+2<');
    expect(out).toContain('title="Three, Four"');
  });

  it('truncates long emails with an ellipsis and keeps the full address as the tooltip', () => {
    const email = 'a.very.long.address.for.testing@some-long-domain-name.example.com';
    const out = table([row({ email })]);
    expect(out).toContain('truncate');
    expect(out).toContain(`title="${email}"`);
  });

  it('badges an opted-out contact', () => {
    expect(table([row({ optedOut: true })])).toContain('Opted out');
  });

  it('hides edit, add to group, tag and delete from the row menu without the permissions', () => {
    // The menu is a portal that only exists while open, so what is checked here is the pure decision it renders from.
    expect(menuActions({ edit: false, delete: false })).toEqual(['view']);
    expect(menuActions({ edit: true, delete: false })).toEqual(['view', 'edit', 'group', 'tag']);
    expect(menuActions({ edit: true, delete: true })).toEqual([
      'view',
      'edit',
      'group',
      'tag',
      'delete',
    ]);
  });

  it('puts call, WhatsApp, email and the menu beside the name', () => {
    const out = table([row()]);
    expect(out).toContain('href="tel:+919876543210"');
    expect(out).toContain('href="https://wa.me/919876543210"');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('href="mailto:aarav@example.com"');
    expect(out).toContain('aria-label="WhatsApp Aarav Sharma"');
    expect(out).toContain('aria-label="More actions for Aarav Sharma"');
  });

  it('disables call, WhatsApp and email instead of hiding them when the contact has no phone or email', () => {
    const out = table([row({ phone: '', email: '' })]);
    expect(out).not.toContain('href="tel:');
    expect(out).not.toContain('wa.me');
    expect(out).not.toContain('href="mailto:');
    expect(out.match(/aria-label="No phone number"/g)).toHaveLength(1);
    expect(out).toContain('aria-label="No phone number for WhatsApp"');
    expect(out).toContain('aria-label="No email address"');
    expect(out.match(/disabled=""/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it('freezes the checkbox and the name cell and keeps the scroll area focusable', () => {
    const out = table([row()]);
    expect(out).toContain(STICKY_NAME);
    expect(out).toContain(STICKY_SELECT);
    expect(out).toContain(STICKY_NAME_HEAD);
    expect(out).toContain('tabindex="0"');
    expect(out).toContain('thin-scrollbar');
    // no shadow until the table has scrolled sideways
    expect(out).not.toContain('shadow-[6px_0_8px');
  });

  it('shows the frozen-edge shadow only while scrolled sideways', () => {
    expect(frozenEdge(false)).toBe('');
    expect(frozenEdge(true)).toContain('shadow-[6px_0_8px');
    expect(frozenEdge(true)).toContain('rtl:shadow-[-6px_0_8px');
    expect(isScrolledSideways(0)).toBe(false);
    expect(isScrolledSideways(120)).toBe(true);
    expect(isScrolledSideways(-120)).toBe(true);
  });

  it('shows the phone and the email as outlined pills', () => {
    const out = table([row()]);
    expect(out).toContain('rounded-full border border-border bg-background');
    expect(out).toContain('title="+91 98765 43210"');
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

describe('ContactsPagination', () => {
  const footer = (over: Partial<Parameters<typeof ContactsPagination>[0]> = {}) =>
    html(
      <ContactsPagination
        page={1}
        total={5000}
        limit={200}
        loading={false}
        onPage={() => undefined}
        onLimit={() => undefined}
        onRecount={() => undefined}
        {...over}
      />,
    );

  it('shows Previous, 1 2 3 4 5 ... 25, Next, the total count and the page-size select', () => {
    const out = footer();
    for (const text of ['>Previous<', '>Next<', '>Total count<', '>5,000<', '200 per page']) {
      expect(out, text).toContain(text);
    }
    for (const n of [1, 2, 3, 4, 5, 25]) expect(out).toContain(`aria-label="Page ${n}"`);
    expect(out).not.toContain('aria-label="Page 6"');
    expect(out).toContain('aria-current="page"');
    for (const n of [10, 25, 50, 100, 200]) expect(out).toContain(`${n} per page`);
    expect(out).not.toContain('500 per page');
  });

  it('mutes Previous on the first page and Next on the last', () => {
    expect(footer({ page: 1 })).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Previous page"/);
    expect(footer({ page: 25 })).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Next page"/);
    expect(footer({ page: 3 })).not.toContain('disabled=""');
  });

  it('has one page and a dash while the total is unknown', () => {
    const out = footer({ total: undefined, page: 1 });
    expect(out).toContain('>-<');
    expect(out).toMatch(/aria-label="Next page"/);
  });
});
