import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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
import { ContactsKanban } from './contacts-kanban';
import { ContactsTable, type ListHandlers } from './contacts-list';
import { DEFAULT_FILTERS } from '../api/contacts';
import { ContactsPagination } from './contacts-pagination';
import { ContactsToolbar, type ContactsToolbarProps } from './contacts-toolbar';
import { AppliedFilters } from './applied-filters';
import { FirstRun } from './first-run';
import { SelectionBar } from './selection-bar';
import { SlashTextarea } from './slash-picker';
import { TagsEditor } from './tags-editor';

/** The domain's English strings: the main file and the `contacts-attributes-tags.<part>.json` slices the app merges with it. */
function merge(
  base: Record<string, unknown>,
  over: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    const b = out[k];
    out[k] =
      typeof v === 'object' && v !== null && typeof b === 'object' && b !== null
        ? merge(b as Record<string, unknown>, v as Record<string, unknown>)
        : v;
  }
  return out;
}
const messages = readdirSync(join(process.cwd(), 'messages', 'en'))
  .filter((f) => /^contacts-attributes-tags(\..+)?\.json$/.test(f) || f === 'segments.json')
  .sort()
  .reduce<Record<string, unknown>>(
    (all, f) =>
      merge(all, JSON.parse(readFileSync(join(process.cwd(), 'messages', 'en', f), 'utf8'))),
    {},
  );

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
  ownerId: null,
  companyId: null,
  optedOut: false,
  whatsappOptIn: 'yes',
  smsOptIn: 'no',
  emailOptIn: 'out',
  source: 'Meta lead ads',
  lastActivityAt: '2026-03-06T08:30:00.000Z',
  groups: [{ id: 'g1', name: 'VIP', color: '#7C3AED' }],
  tags: [{ id: 't1', name: 'Hot lead', color: '#2E7D32' }],
  attributes: [{ key: 'order_id', label: 'Order Id', text: 'A12', full: 'Order Id: A12' }],
  custom: { order_id: 'A12' },
  createdAt: '2026-03-05T12:00:00.000Z',
  leadScore: null,
  leadScoreSource: null,
  leadScoredAt: null,
  uncontactedSince: null,
  nextFollowUp: null,
  dateOfBirth: null,
  isMinor: false,
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
      'Mar 5, 2026, 12:00 PM',
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

  it('makes sortable headers buttons, marks the sorted one, and leaves tags and groups alone', () => {
    const out = html(
      <ContactsTable
        rows={[row()]}
        columns={EVERY_COLUMN}
        headerState="none"
        onToggleAll={() => undefined}
        sort={{ key: 'email', order: 'desc' }}
        onSort={() => undefined}
        onMoveColumn={() => undefined}
        onNudgeColumn={() => undefined}
        {...handlers()}
      />,
    );
    expect(out.match(/aria-sort="descending"/g)?.length).toBe(1);
    expect(out).toContain('Sort by Email ID');
    expect(out).not.toContain('Sort by Tags');
    expect(out).not.toContain('Sort by Groups');
    // Every column but the name can be dragged.
    expect(out.match(/draggable="true"/g)?.length).toBe(EVERY_COLUMN.length - 1);
  });

  it('has no sort buttons or drag handles without handlers (the read-only listing)', () => {
    const out = table([row()]);
    expect(out).not.toContain('Sort by');
    expect(out).not.toContain('aria-sort');
    expect(out).not.toContain('draggable="true"');
  });

  it('links the name to the detail page (Reference had no detail link)', () => {
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

  describe('the hover actions over the name', () => {
    const send = { onSend: () => undefined, onChat: () => undefined, onOpenQuick: () => undefined };

    it('offers only Message, Call, the quick add and the "..." menu: at most three icons', () => {
      const out = table([row()], send);
      expect(out).toContain('aria-label="Message Aarav Sharma"');
      expect(out).toContain('aria-label="Call Aarav Sharma"');
      expect(out).toContain('aria-label="Add a note, task or meeting for Aarav Sharma"');
      expect(out).toContain('aria-label="More actions for Aarav Sharma"');
      // what used to sit beside the name is in the menu now, not an icon of its own
      for (const gone of [
        'Open the details of',
        'Edit Aarav',
        'Add a note to',
        'Email Aarav',
        'WhatsApp Aarav',
        'Chat with',
      ]) {
        expect(out, gone).not.toContain(`aria-label="${gone}`);
      }
    });

    it('lays the strip over the end of the name cell, so showing it moves nothing', () => {
      const out = table([row()], send);
      // overlaid (absolute, at the end edge), with a fade behind it, not a sibling that takes width
      expect(out).toContain('absolute inset-y-0 end-0');
      expect(out).toContain('bg-[linear-gradient(to_right,transparent');
      expect(out).toContain('rtl:bg-[linear-gradient(to_left,transparent');
      // the name is not squeezed while the strip is on screen (the old rule truncated it on hover)
      expect(out).not.toContain('group-hover:max-w-');
      expect(out).not.toContain('group-focus-within:max-w-');
    });

    it('shows on hover and keyboard focus, and keeps the menu in view on a narrow or touch screen', () => {
      const out = table([row()], send);
      expect(out).toContain('group-hover:opacity-100');
      expect(out).toContain('focus-within:opacity-100');
      expect(out).toContain('max-sm:!opacity-100');
      // icons only where a pointer can hover and there is room; the menu (drawn when opened) repeats them everywhere else
      expect(out).toContain('hidden sm:[@media(hover:hover)]:flex');
      // the name leaves room for the always-visible menu on a narrow or touch screen
      expect(out).toContain('max-sm:max-w-[calc(100%-2rem)]');
    });

    it('draws an icon only where the person has the permission for it', () => {
      const out = table([row()], {
        ...send,
        canEdit: false,
        can: { note: false, task: false, call: false, send: false, chat: false },
      });
      for (const gone of ['Message Aarav', 'Call Aarav', 'Add a note, task or meeting']) {
        expect(out, gone).not.toContain(`aria-label="${gone}`);
      }
      // the menu is still there, with "View"
      expect(out).toContain('aria-label="More actions for Aarav Sharma"');
    });

    it('keeps the quick add for creating tasks alone (no contact update needed)', () => {
      const out = table([row()], {
        ...send,
        canEdit: false,
        can: { note: false, task: true, call: false, send: false, chat: false },
      });
      expect(out).toContain('aria-label="Add a note, task or meeting for Aarav Sharma"');
    });

    it('has no call or message icon without a handler for them', () => {
      const out = table([row()]);
      expect(out).not.toContain('Call Aarav Sharma');
      expect(out).not.toContain('Message Aarav Sharma');
      expect(out).not.toContain('href="tel:');
      expect(out).not.toContain('wa.me');
    });

    it('disables Message and Call, with the reason as the tip, when the contact cannot be reached', () => {
      const out = table([row({ phone: '', email: '' })], send);
      expect(out).toContain('aria-label="No phone number or email address"');
      expect(out).toContain('aria-label="No phone number"');
      expect(out.match(/disabled=""/g)?.length).toBeGreaterThanOrEqual(2);
    });

    it('says why Message is off when no channel is connected', () => {
      const out = table([row()], { ...send, connected: { whatsapp: false, email: false } });
      expect(out).toContain(
        'aria-label="No connected WhatsApp number or mailbox for this contact"',
      );
    });

    it('keeps the name a link to the details page, opening the quick view on a plain click', () => {
      const out = table([row()], send);
      expect(out).toContain('href="/contacts/294dca7c-5806-4548-9035-dcca9befc7b1"');
    });
  });

  it('shows WhatsApp, SMS and email opt-in as quiet marks: a green tick, a faint dot, a red cross when opted out', () => {
    const cols = visibleColumns(['name', 'whatsapp', 'sms', 'emailOptIn'], ATTRS);
    const out = table([row()], {}, 'none', cols);
    // the headings are full labels in tooltips (WhatsApp is shortened in the heading itself)
    for (const title of ['WhatsApp opt-in', 'SMS opt-in', 'Email opt-in']) {
      expect(out, title).toContain(title);
    }
    expect(out).toContain('bg-success/15 text-success');
    expect(out).toContain('text-muted-foreground/50');
    expect(out).toContain('bg-danger/10 text-danger');
    // tooltips say the state with the channel; the word is for screen readers only, never printed on every row
    expect(out).toContain('title="WhatsApp opt-in: Yes"');
    expect(out).toContain('title="SMS opt-in: No"');
    expect(out).toContain('title="Opted out of marketing messages"');
    expect(out.match(/<span class="sr-only">Yes<\/span>/g)).toHaveLength(1);
    expect(out.match(/<span class="sr-only">No<\/span>/g)).toHaveLength(2);
    expect(out).not.toContain('border-success/30 bg-success/10 text-success');
  });

  it('shortens the headings that were cut off, with the full label as the tooltip', () => {
    const chosen: ColumnId[] = [
      'name',
      'phone',
      'email',
      'stage',
      'whatsapp',
      'owner',
      'createdOn',
    ];
    const out = html(
      <ContactsTable
        rows={[row()]}
        columns={visibleColumns(chosen, ATTRS)}
        headerState="none"
        onToggleAll={() => undefined}
        sort={{ key: 'createdAt', order: 'desc' }}
        onSort={() => undefined}
        {...handlers()}
      />,
    );
    for (const short of ['Phone', 'Email', 'Stage', 'WhatsApp', 'Owner', 'Created']) {
      expect(out, short).toContain(`<span class="truncate">${short}</span>`);
    }
    expect(out).not.toContain('<span class="truncate">Phone Number</span>');
    expect(out).not.toContain('<span class="truncate">Lifecycle Stage</span>');
    // the full label is still one hover away
    expect(out).toContain('title="Sort by Phone Number. Drag');
    expect(out).toContain('title="Sort by Created On. Drag');
  });

  it('draws the stage caret only on hover or focus of the row, but always on a touch screen', () => {
    const out = table([row()], { onStageChange: () => undefined, stageChoices: [] });
    expect(out).toContain('opacity-0 transition-opacity group-hover:opacity-100');
    expect(out).toContain('group-focus-within:opacity-100');
    expect(out).toContain('[@media(hover:none)]:opacity-100');
  });

  it('mutes the owner avatar', () => {
    const out = table([row({ ownerId: '11111111-1111-4111-8111-111111111111' })], {
      ownerLabel: () => 'Asha Rao',
    });
    expect(out).toContain('opacity-70 saturate-50');
  });

  it('shows the source and the last activity, and a dash for a contact with neither', () => {
    const cols = visibleColumns(['name', 'source', 'lastActivity'], ATTRS);
    const out = table([row()], {}, 'none', cols);
    expect(out).toContain('Meta lead ads');
    expect(out).toContain('Mar 6, 2026, 8:30 AM');
    const empty = table([row({ source: '', lastActivityAt: null })], {}, 'none', cols);
    expect(empty.match(/>-<\/span>/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('ends the header row with the add-column picker and gives each column its menu', () => {
    const out = html(
      <ContactsTable
        rows={[row()]}
        columns={visibleColumns(['name', 'phone', 'email'], ATTRS)}
        headerState="none"
        onToggleAll={() => undefined}
        sort={{ key: 'email', order: 'desc' }}
        onSort={() => undefined}
        onSortTo={() => undefined}
        columnTools={{
          addable: [],
          onAdd: () => undefined,
          onHide: () => undefined,
          hasFilter: () => true,
          onFilter: () => undefined,
        }}
        {...handlers()}
      />,
    );
    expect(out).toContain('aria-label="Add column"');
    expect(out).toContain('aria-label="Options for the Email ID column"');
    // the name column has a menu too (sort and filter), but nothing to hide
    expect(out).toContain('aria-label="Options for the Contact Name column"');
    // one extra header cell and one extra, empty body cell for the "+"
    expect(out.match(/<th /g)).toHaveLength(5);
  });

  it('has no add-column header without the tools (the read-only listing)', () => {
    const out = table([row()]);
    expect(out).not.toContain('aria-label="Add column"');
  });

  it('disables Call and keeps Message off the chat (never a dead link) for a masked phone number', () => {
    // Needs a send handler, same as the hover-actions describe block above, or the whole strip
    // (message/call) is absent regardless of masking and these assertions are vacuous.
    const out = table([row({ phone: '+xxxxxxxx0025' })], {
      onSend: () => undefined,
      onChat: () => undefined,
      onOpenQuick: () => undefined,
    });
    expect(out).not.toContain('href="tel:');
    expect(out).not.toContain('wa.me');
    expect(out.match(/aria-label="No phone number"/g)).toHaveLength(1);
    // the email is still reachable, so Message is on (as an email), and the menu offers no copy of the masked number
    expect(out).toContain('aria-label="Message Aarav Sharma"');
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

describe('Owner column', () => {
  const ASHA = '11111111-1111-4111-8111-111111111111';
  const cols = visibleColumns(['name', 'owner'], ATTRS);
  const render = (rows: RowView[], over: Partial<ListHandlers> = {}) =>
    html(
      <ContactsTable
        rows={rows}
        columns={cols}
        headerState="none"
        onToggleAll={() => undefined}
        {...handlers(over)}
      />,
    );

  it('shows the owner with initials and name', () => {
    const out = render([row({ ownerId: ASHA })], { ownerLabel: () => 'Asha Rao' });
    expect(out).toContain('>Owner<');
    expect(out).toContain('Asha Rao');
    expect(out).toContain('>AR<');
  });

  it('says Unassigned, muted, for a contact nobody owns', () => {
    const out = render([row({ ownerId: null })]);
    expect(out).toContain('text-muted-foreground">Unassigned<');
  });

  it('is not sortable', () => {
    const out = html(
      <ContactsTable
        rows={[row()]}
        columns={cols}
        headerState="none"
        onToggleAll={() => undefined}
        sort={{ key: 'email', order: 'desc' }}
        onSort={() => undefined}
        {...handlers()}
      />,
    );
    expect(out).not.toContain('Sort by Owner');
  });
});

describe('ContactsKanban', () => {
  const noop = () => undefined;
  const stages = [
    { value: 'new', label: 'New' },
    { value: 'qualified', label: 'Qualified' },
    { value: 'won', label: 'Won' },
  ];
  const board = (filters = DEFAULT_FILTERS) =>
    html(
      <QueryClientProvider client={new QueryClient()}>
        <ContactsKanban
          filters={filters}
          stages={stages}
          toView={() => row()}
          onStageChange={noop}
          stageBusyId={null}
        />
      </QueryClientProvider>,
    );
  it('has one column per stage', () => {
    const out = board();
    for (const s of ['New', 'Qualified', 'Won']) expect(out).toContain(s);
    expect(out.match(/<section /g)).toHaveLength(3);
    expect(out).toContain('Contacts by stage');
  });
  it('a stage chosen in Filters narrows the board to that column', () => {
    const out = board({ ...DEFAULT_FILTERS, lifecycleStage: 'qualified' });
    expect(out.match(/<section /g)).toHaveLength(1);
    expect(out).toContain('Qualified');
    expect(out).not.toContain('Won');
  });
});

describe('TagsEditor (TW-CON-038..040)', () => {
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
        total={30442}
        limit={50}
        rowsOnPage={50}
        loading={false}
        onPage={() => undefined}
        onLimit={() => undefined}
        {...over}
      />,
    );

  it('says "Showing 1-50 of 30,442" and offers 1 2 3 4 5, arrows and the page-size select', () => {
    const out = footer();
    expect(out).toContain('Showing 1-50 of 30,442');
    for (const n of [1, 2, 3, 4, 5]) expect(out).toContain(`aria-label="Page ${n}"`);
    // the API is cursor-only: pages beyond the reach are not drawn as buttons, the footer says where the end is
    expect(out).not.toContain('aria-label="Page 6"');
    expect(out).not.toContain('aria-label="Page 609"');
    expect(out).toContain('Page 1 of 609');
    expect(out).toContain('aria-current="page"');
    expect(out).toContain('aria-label="Previous page"');
    expect(out).toContain('aria-label="Next page"');
    for (const n of [10, 25, 50, 100, 200]) expect(out).toContain(`${n} per page`);
    expect(out).not.toContain('500 per page');
  });

  it('numbers the rows of a later and a short last page', () => {
    expect(footer({ page: 3 })).toContain('Showing 101-150 of 30,442');
    expect(footer({ page: 609, rowsOnPage: 42 })).toContain('Showing 30,401-30,442 of 30,442');
    expect(footer({ total: 0, rowsOnPage: 0 })).toContain('Showing 0-0 of 0');
  });

  it('is a footer that stays put: it does not shrink and sits under the scrolling rows', () => {
    expect(footer()).toContain('shrink-0 flex-wrap');
  });

  it('turns Previous off on the first page and Next off on the last', () => {
    expect(footer({ page: 1 })).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Previous page"/);
    expect(footer({ page: 609 })).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Next page"/);
    expect(footer({ page: 3 })).not.toContain('disabled=""');
  });

  it('shows "about" for an estimated total, and a dash while the total is unknown', () => {
    expect(footer({ approximate: true })).toContain('of about 30,442');
    const out = footer({ total: undefined, rowsOnPage: 0 });
    expect(out).toContain('of -');
    expect(out).toMatch(/aria-label="Next page"/);
  });
});

describe('ContactsToolbar', () => {
  const noop = () => undefined;
  const OWNERS = [
    {
      id: '11111111-1111-4111-8111-111111111111',
      fullName: 'Asha Rao',
      email: 'asha@x.test',
      canAssign: true,
    },
  ];
  const toolbar = (
    over: Partial<ContactsToolbarProps> = {},
    filters: Partial<ContactsToolbarProps['filter']['filters']> = {},
  ) =>
    html(
      <QueryClientProvider client={new QueryClient()}>
        <ContactsToolbar
          q=""
          onQ={noop}
          focusSearch={0}
          filter={{
            filters: {
              group: '',
              imported: false,
              segment: '',
              tag: '',
              owner: '',
              team: '',
              lifecycleStage: '',
              status: '',
              minor: '',
              consent: '',
              source: '',
              followUp: '',
              rules: '',
              ...filters,
            },
            onChange: noop,
            stats: undefined,
            groups: [],
            segments: [],
            segmentsState: 'ready',
            onRetrySegments: noop,
            canCreateSegment: false,
            tags: [],
            owners: OWNERS,
            teams: [],
            meId: OWNERS[0]!.id,
            stages: [],
            statuses: [],
            onAiSummary: noop,
            conditionCount: 0,
          }}
          allColumns={allColumns([])}
          columnIds={
            ['name', 'phone', 'email', 'stage', 'whatsapp', 'owner', 'createdOn'] as ColumnId[]
          }
          onApplyColumns={noop}
          onResetColumns={noop}
          view="list"
          onView={noop}
          can={{ export: false, import: false, merge: false, createGroups: false }}
          exporting={false}
          onExportAll={noop}
          onImport={noop}
          onDedupe={noop}
          onNewGroup={noop}
          showStats={false}
          onToggleStats={noop}
          onRefresh={noop}
          refreshing={false}
          {...over}
        />
      </QueryClientProvider>,
    );

  it('is one slim row: search, Filter, Columns with a count, the layout toggle, the "..." menu and refresh', () => {
    const out = toolbar();
    expect(out).toContain('placeholder="Search contacts..."');
    expect(out).toContain('>Filter<');
    expect(out).toContain('>Columns<');
    expect(out).toContain('aria-label="7 columns shown"');
    expect(out).toContain('aria-label="List view"');
    expect(out).toContain('aria-label="Board view (by stage)"');
    expect(out).toContain('aria-label="More Actions"');
    expect(out).toContain('aria-label="Refresh"');
  });

  it('has none of the separate dropdowns the old toolbar had', () => {
    const out = toolbar();
    for (const gone of [
      'Select Segment',
      'Select Tag',
      'Send Campaign',
      '>More Actions<',
      '>Sort<',
    ]) {
      expect(out, gone).not.toContain(gone);
    }
  });

  it('shows Add Contact and Create View only when the person may', () => {
    expect(toolbar()).not.toContain('Add Contact');
    expect(toolbar()).not.toContain('Create View');
    const out = toolbar({ onAdd: noop, onCreateView: noop });
    expect(out).toContain('Add Contact');
    expect(out).toContain('Create View');
  });

  it('counts the filters that are on in a badge on the Filter button', () => {
    expect(toolbar()).not.toContain('bg-brand px-1.5');
    const out = toolbar({}, { tag: 'abc', lifecycleStage: 'new', owner: 'none' });
    expect(out).toContain('bg-brand px-1.5 text-[11px] leading-5 text-brand-foreground">3<');
  });
});

describe('applied filters and the selection bar', () => {
  const noop = () => undefined;

  it('draws one removable chip per filter, Clear all and Save as segment', () => {
    const out = html(
      <AppliedFilters
        chips={[
          { id: 'tag:1', kind: 'tag', label: 'Tag: VIP', value: 'VIP', clear: { tag: '' } },
          {
            id: 'rules',
            kind: 'rules',
            label: 'Conditions: 2',
            value: 'Conditions: 2',
            clear: { rules: '' },
          },
        ]}
        onRemove={noop}
        onClearAll={noop}
        onSaveAsSegment={noop}
      />,
    );
    expect(out).toContain('Tag: VIP');
    expect(out).toContain('aria-label="Remove filter: Tag: VIP"');
    expect(out).toContain('aria-label="Remove filter: Conditions: 2"');
    expect(out).toContain('>Clear all<');
    expect(out).toContain('>Save as segment<');
  });

  it('draws nothing when no filter is on', () => {
    expect(html(<AppliedFilters chips={[]} onRemove={noop} onClearAll={noop} />)).toBe('');
  });

  const bar = (over: Partial<Parameters<typeof SelectionBar>[0]> = {}) =>
    html(
      <QueryClientProvider client={new QueryClient()}>
        <SelectionBar
          count={3}
          busy={false}
          can={{ update: true, delete: true, export: true, createTags: true }}
          onClear={noop}
          onSendCampaign={noop}
          onExport={noop}
          onDelete={noop}
          onAssignOwner={noop}
          onChangeStage={noop}
          onUpdate={noop}
          onMarkUncontacted={noop}
          picker={null}
          onPicker={noop}
          onGroup={async () => true}
          onTagApply={async () => true}
          {...over}
        />
      </QueryClientProvider>,
    );

  it('offers Send campaign, Tag, Assign owner, Change stage, Export, Delete and More', () => {
    const out = bar();
    expect(out).toContain('3 selected');
    for (const action of [
      'Send campaign',
      'Tag',
      'Assign owner',
      'Change stage',
      'Export',
      'Delete',
      'More',
    ]) {
      expect(out, action).toContain(action);
    }
  });

  it('says "All matching selected" for a selection that stands for the whole filter', () => {
    expect(bar({ count: null })).toContain('All matching selected');
  });

  it('shows only what the permissions allow', () => {
    const out = bar({ can: { update: false, delete: false, export: false, createTags: false } });
    expect(out).toContain('Send campaign');
    for (const gone of ['Assign owner', 'Change stage', '>Tag<', 'Export', 'Delete', '>More<']) {
      expect(out, gone).not.toContain(gone);
    }
  });
});

describe('SlashTextarea', () => {
  it('uses only ARIA attributes a textarea may carry (aria-expanded is not one: axe flags it as critical)', () => {
    const markup = html(
      <QueryClientProvider client={new QueryClient()}>
        <SlashTextarea value="Hello /" onChange={() => undefined} label="Message" />
      </QueryClientProvider>,
    );
    expect(markup).toContain('aria-label="Message"');
    expect(markup).toContain('aria-autocomplete="list"');
    expect(markup).not.toContain('aria-expanded');
  });
});

describe('FirstRun', () => {
  it('offers the three ways to start, each only where the person may', () => {
    const all = html(
      <FirstRun
        onAdd={() => undefined}
        onImport={() => undefined}
        connectHref="/channels/whatsapp"
      />,
    );
    expect(all).toContain('Add your first contacts');
    expect(all).toContain('Create Contacts');
    expect(all).toContain('Import a CSV file');
    expect(all).toContain('href="/channels/whatsapp"');
    expect(all).toContain('Connect WhatsApp');
    const some = html(<FirstRun onAdd={() => undefined} />);
    expect(some).not.toContain('Import a CSV file');
    expect(some).not.toContain('Connect WhatsApp');
    const none = html(<FirstRun />);
    expect(none).not.toContain('<button');
    expect(none).toContain('Add your first contact, or import a CSV file to get started.');
  });
});
