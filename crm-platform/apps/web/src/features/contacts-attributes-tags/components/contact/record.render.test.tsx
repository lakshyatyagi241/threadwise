import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@crm/ui';
import {
  makeSession,
  renderAccount as render,
} from '@/features/auth-registration-security/account/render-test-utils';
import type { ReactElement } from 'react';

/** The screens ask for a toast; a ToastProvider stands around every render. */
const renderAccount: typeof render = (element: ReactElement, options) =>
  render(<ToastProvider dismissLabel="Dismiss">{element}</ToastProvider>, options).replace(
    /<div aria-live="polite"[^>]*><\/div>/,
    '',
  );
import type { ContactRow } from '../../api/schemas';
import { PersonaProvider } from '@/features/persona';
import { denyList, genericView, viewFrom } from '@/features/persona/testing';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
  usePathname: () => '/contacts/x',
  useSearchParams: () => new URLSearchParams(),
}));

import { ContactActionBar } from './action-bar';
import { CollapseCard } from './collapse-card';
import { KeyDetails, cityKey } from './key-details';
import { AssociationCards, ChannelTicks } from './association-cards';

/** The one action row, Key details and the folded cards, in English and Arabic from the real messages. */

const ID = '294dca7c-5806-4548-9035-dcca9befc7b1';
const can = (...keys: string[]) =>
  makeSession({ permissions: Object.fromEntries(keys.map((k) => [k, 'all'])) });

const contact = (over: Partial<ContactRow> = {}) =>
  ({
    id: ID,
    displayId: null,
    name: 'Priya Sharma',
    firstName: 'Priya',
    lastName: 'Sharma',
    email: 'priya@example.com',
    phone: '+919876543210',
    companyId: null,
    ownerId: null,
    lifecycleState: 'active',
    lifecycleStage: 'new',
    status: null,
    leadScore: 72,
    whatsappSubscriptionStatus: 'subscribed',
    smsSubscriptionStatus: null,
    emailSubscriptionStatus: null,
    isUnsubscribed: false,
    isMinor: false,
    dateOfBirth: null,
    lastActivityAt: '2026-10-10T10:00:00.000Z',
    source: 'Instagram',
    customFields: { address: 'Pune' },
    rowVersion: 1,
    createdAt: '2026-03-05T12:00:00.000Z',
    updatedAt: '2026-03-05T12:00:00.000Z',
    ...over,
  }) as unknown as ContactRow;

const bar = (permissions: string[], c = contact(), locale: 'en' | 'ar' = 'en') =>
  renderAccount(
    <ContactActionBar contact={c} onAdd={() => undefined} onDeleted={() => undefined} />,
    {
      locale,
      session: can(...permissions),
    },
  );

describe('ContactActionBar', () => {
  const all = [
    'record.contacts.update',
    'record.contacts.delete',
    'record.tasks.create',
    'record.tasks.read',
    'inbox.conversation.reply',
    'call.calls.use',
    'call.logs.create',
  ];

  it('is ONE row: Note, Task, Call, Meeting, Message and the ... menu, nothing else', () => {
    const out = bar(all);
    const labels = [...out.matchAll(/<button[^>]*title="([^"]+)"/g)].map((m) => m[1]);
    for (const name of ['Note', 'Task', 'Meeting']) expect(labels).toContain(name);
    expect(out).toContain('>Call<');
    expect(out).toContain('>Message<');
    expect(out).toContain('aria-label="More actions"');
    // the company is no longer a button of the row: it is in the menu
    expect(out).not.toContain('>Add company<');
    expect(out).not.toContain('flex-wrap items-center gap-2 border');
    expect(out.match(/role="group"/g)).toHaveLength(1);
  });

  it('draws a Call arrow with the other ways when there are several, and none when there is one', () => {
    expect(bar(all)).toContain('aria-label="Other ways to call"');
    // only logging: the button is "Log a call" and there is no arrow
    const logOnly = bar(['call.logs.create'], contact({ phone: null }));
    expect(logOnly).toContain('>Log a call<');
    expect(logOnly).not.toContain('Other ways to call');
  });

  it('shows no Call without calling or call logging, and no Message without the inbox reply permission', () => {
    const out = bar(['record.contacts.update']);
    expect(out).not.toContain('>Call<');
    expect(out).not.toContain('>Message<');
    expect(out).toContain('>Note<');
  });

  it('disables Call with the reason when the number cannot be dialled (masked), and shows the reason for Message', () => {
    const out = bar(
      ['call.calls.use', 'inbox.conversation.reply'],
      contact({ phone: '+9198xxxxxx10', email: null }),
    );
    expect(out).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?Call/);
    expect(out).toContain('No phone number');
  });

  it('reads in Arabic', () => {
    expect(bar(all, contact(), 'ar')).toContain('role="group"');
  });
});

describe('CollapseCard', () => {
  it('shows its title and what is inside when folded, and draws nothing of the content', () => {
    const out = renderAccount(
      <CollapseCard id="t-closed" title="Privacy" summary="Marketing allowed">
        <p>SECRET CONTENT</p>
      </CollapseCard>,
    );
    expect(out).toContain('Privacy');
    expect(out).toContain('Marketing allowed');
    expect(out).toContain('aria-expanded="false"');
    expect(out).not.toContain('SECRET CONTENT');
  });

  it('draws the content when it starts open, and then no summary', () => {
    const out = renderAccount(
      <CollapseCard id="t-open" title="Subscription status" summary="WhatsApp Yes" defaultOpen>
        <p>OPEN CONTENT</p>
      </CollapseCard>,
    );
    expect(out).toContain('OPEN CONTENT');
    expect(out).toContain('aria-expanded="true"');
    expect(out).not.toContain('WhatsApp Yes');
  });

  it('opens when something outside asks for it', () => {
    const out = renderAccount(
      <CollapseCard id="t-signal" title="Company" openSignal={1}>
        <p>COMPANY SEARCH</p>
      </CollapseCard>,
    );
    expect(out).toContain('COMPANY SEARCH');
  });
});

describe('KeyDetails', () => {
  const draw = (permissions: string[], c = contact(), locale: 'en' | 'ar' = 'en') =>
    renderAccount(<KeyDetails contact={c} />, {
      locale,
      session: can(...permissions),
      seed: [[['cat', 'fields', false], []]],
    });

  it('lists the few things people look up first, in order', () => {
    const out = draw([]);
    const labels = [...out.matchAll(/<dt[^>]*>([^<]+)<\/dt>/g)].map((m) => m[1]);
    expect(labels).toEqual([
      'Phone',
      'Email',
      'Owner',
      'Company',
      'Address',
      'Source',
      'Created at',
      'Last activity',
    ]);
    expect(out).toContain('priya@example.com');
    expect(out).toContain('Instagram');
    expect(out).toContain('Pune');
  });

  it('offers a pencil beside each editable value only to someone who may update contacts', () => {
    const editable = draw(['record.contacts.update']);
    expect(editable).toContain('aria-label="Edit Phone"');
    expect(editable).toContain('aria-label="Edit Email"');
    expect(editable).toContain('aria-label="Edit Source"');
    expect(editable).toContain('Edit all');
    const readOnly = draw([]);
    expect(readOnly).not.toContain('aria-label="Edit ');
    expect(readOnly).not.toContain('Edit all');
  });

  it('never offers to edit a masked phone number', () => {
    const out = draw(['record.contacts.update'], contact({ phone: '+9198xxxxxx10' }));
    expect(out).not.toContain('aria-label="Edit Phone"');
    expect(out).toContain('xxxxxx10');
  });

  it('shows "Add ..." for an empty value and a way to show everything', () => {
    const out = draw(['record.contacts.update'], contact({ source: null, customFields: {} }));
    expect(out).toContain('Add source');
    expect(out).toContain('Show all details');
    expect(out).toContain('aria-expanded="false"');
  });

  it('shows the tags line and the groups of the contact under the rows', () => {
    const out = draw(
      ['record.contacts.update'],
      contact({ groups: [{ id: 'g1', name: 'Wholesale buyers', color: null }] } as never),
    );
    expect(out).toContain('Add tag');
    expect(out).toContain('Groups');
    expect(out).toContain('Wholesale buyers');
    expect(draw([]).includes('Groups')).toBe(false);
  });

  it('can fold on a phone: the title is a button that says whether the list is open', () => {
    const out = draw([]);
    expect(out).toContain('aria-expanded="true"');
    expect(out).toContain('About this contact');
    expect(out).toContain('md:hidden');
  });

  it('uses the workspace city property when it has one', () => {
    expect(cityKey([{ key: 'City' }, { key: 'x' }])).toBe('City');
    expect(cityKey([{ key: 'x' }])).toBeNull();
    expect(cityKey(undefined)).toBeNull();
  });

  it('reads in Arabic', () => {
    expect(draw([], contact(), 'ar')).toContain('priya@example.com');
  });
});

describe('AssociationCards', () => {
  const draw = (
    permissions: string[],
    c = contact(),
    locale: 'en' | 'ar' = 'en',
    scoringOn = true,
  ) =>
    renderAccount(<AssociationCards contact={c} />, {
      locale,
      session: can(...permissions),
      seed: [
        [['cat', 'fields', false], []],
        // GET /lead-scoring/status: the workspace switch.
        [['lead-scoring', 'status'], { enabled: scoringOn }],
      ],
    });

  const all = [
    'record.contacts.read',
    'record.contacts.update',
    'contacts.consent.read',
    'record.companies.read',
    'record.tasks.read',
    'record.tasks.create',
  ];

  it('is a stack of one-line cards: Open tasks and Subscription open, the rest folded', () => {
    const out = draw(all);
    for (const title of [
      'Open tasks',
      'Subscription status',
      'Lead score',
      'Time zone and location',
      'Privacy',
    ]) {
      expect(out, title).toContain(title);
    }
    // two open by default: tasks and subscription
    expect(out.match(/aria-expanded="true"/g)).toHaveLength(2);
    for (const folded of ['Lead score', 'Time zone and location', 'Privacy']) {
      expect(out).toMatch(new RegExp(`aria-expanded="false"[^>]*>[\\s\\S]*?${folded}`));
    }
    // folded cards say what is inside, and none of their content is drawn
    expect(out).toContain('Marketing allowed');
    expect(out).toContain('72 ·');
    expect(out).not.toContain('No privacy flags');
    // no card is taller than about 200 px open
    expect(out).toContain('max-h-[200px]');
  });

  it('leaves out the Lead score card while lead scoring is off, a typed score included', () => {
    for (const source of ['ai', 'manual'] as const) {
      const out = draw(all, contact({ leadScoreSource: source }), 'en', false);
      expect(out).not.toContain('Lead score');
      expect(out).not.toContain('72 ·');
      // the other cards are all still there
      for (const title of ['Open tasks', 'Subscription status', 'Time zone and location'])
        expect(out, title).toContain(title);
    }
  });

  it('puts the three channel ticks in the Subscription row, folded or open', () => {
    const out = draw(all, contact({ whatsappSubscriptionStatus: 'subscribed' }));
    expect(out).toContain('WhatsApp: Yes');
    expect(out).toContain('Email: No');
    expect(out).toContain('SMS: No');
    const out2 = renderAccount(<ChannelTicks contact={contact({ isUnsubscribed: true })} />);
    expect(out2).toContain('Opted out of marketing messages');
  });

  it('offers + Add on Open tasks only to someone who may create tasks, and on Company only without a company', () => {
    expect(draw(all)).toContain('+ Add');
    const readOnly = draw(['record.contacts.read', 'record.tasks.read']);
    expect(readOnly).not.toContain('+ Add');
  });

  it('leaves out the cards a person has no access to', () => {
    const out = draw([]);
    expect(out).not.toContain('Time zone and location');
    expect(out).not.toContain('Open tasks');
    expect(out).not.toContain('Deals');
    expect(out).toContain('Subscription status');
  });

  it('reads in Arabic', () => {
    expect(draw(['record.contacts.read'], contact(), 'ar')).toContain('aria-expanded');
  });
});

describe('hidden by the workspace persona', () => {
  const perms = [
    'record.contacts.read',
    'record.contacts.update',
    'record.companies.read',
    'record.tasks.read',
    'record.tasks.create',
    'inbox.conversation.reply',
    'call.calls.use',
    'call.logs.create',
  ];
  const persona = (ids: string[]) => viewFrom({ definition: denyList(ids) });
  const actionBar = (view: ReturnType<typeof persona> | null) =>
    renderAccount(
      <PersonaProvider view={view}>
        <ContactActionBar contact={contact()} onAdd={() => undefined} onDeleted={() => undefined} />
      </PersonaProvider>,
      { session: can(...perms) },
    );
  const cards = (view: ReturnType<typeof persona> | null) =>
    renderAccount(
      <PersonaProvider view={view}>
        <AssociationCards contact={contact()} />
      </PersonaProvider>,
      {
        session: can(...perms, 'record.deals.read'),
        seed: [
          [['cat', 'fields', false], []],
          [['lead-scoring', 'status'], { enabled: true }],
        ],
      },
    );

  it('the generic persona draws exactly what no persona draws (action bar and cards)', () => {
    expect(actionBar(genericView())).toBe(actionBar(null));
    expect(cards(genericView())).toBe(cards(null));
  });

  it('leaves out the action buttons the persona hides, and only those', () => {
    const out = actionBar(persona(['action:contact.meeting', 'action:contact.note']));
    expect(out).not.toContain('>Meeting<');
    expect(out).not.toContain('>Note<');
    for (const kept of ['>Task<', '>Call<', '>Message<']) expect(out, kept).toContain(kept);
  });

  it('leaves out the Tasks, Deals and Company cards and the Lead score card the persona hides', () => {
    const before = cards(null);
    expect(before).toContain('Open tasks');
    expect(before).toContain('Lead score');
    const out = cards(
      persona([
        'section:contact.tasks',
        'section:contact.deals',
        'section:contact.company',
        'action:contact.score',
      ]),
    );
    expect(out).not.toContain('Open tasks');
    expect(out).not.toContain('Lead score');
    expect(out).toContain('Subscription status');
  });
});
