import { describe, expect, it } from 'vitest';
import {
  makeSession,
  renderAccount,
} from '@/features/auth-registration-security/account/render-test-utils';
import type { ContactRow } from '../../api/schemas';
import { ContactQuickView, QuickTabs } from '../contact-quick-view';
import { NOTE_KEYS } from '../../api/notes';
import { navGroups, quickTabs } from '../../lib/sections';
import { SectionNav } from '../contact-detail';
import { ComplianceBody, LocationBody, SubscriptionBody } from './cards';
import { OptInPill, ScoreRing, SocialIcons } from './parts';

/** The quick view's and the details page's own pieces, in English and Arabic, from the real messages (a missing key fails the render). */

const ID = '294dca7c-5806-4548-9035-dcca9befc7b1';
const can = (...keys: string[]) =>
  makeSession({ permissions: Object.fromEntries(keys.map((k) => [k, 'all'])) });

const contact = (over: Partial<ContactRow> = {}) =>
  ({
    id: ID,
    displayId: null,
    name: 'Aarav Sharma',
    firstName: 'Aarav',
    lastName: 'Sharma',
    email: 'aarav@example.com',
    phone: '+919876543210',
    companyId: null,
    ownerId: null,
    lifecycleState: 'active',
    lifecycleStage: 'new',
    status: null,
    leadScore: null,
    whatsappSubscriptionStatus: null,
    smsSubscriptionStatus: null,
    emailSubscriptionStatus: null,
    isUnsubscribed: false,
    isMinor: false,
    dateOfBirth: null,
    lastActivityAt: null,
    source: null,
    customFields: {},
    rowVersion: 1,
    createdAt: '2026-03-05T12:00:00.000Z',
    updatedAt: '2026-03-05T12:00:00.000Z',
    ...over,
  }) as unknown as ContactRow;

describe('SubscriptionBody', () => {
  it('says Yes only for a subscribed channel and No for the others', () => {
    const out = renderAccount(
      <SubscriptionBody contact={contact({ whatsappSubscriptionStatus: 'subscribed' })} />,
      { session: can('contacts.consent.read') },
    );
    expect(out.match(/>Yes</g)).toHaveLength(1);
    expect(out.match(/>No</g)).toHaveLength(2);
    expect(out).toContain('WhatsApp');
    expect(out).toContain('SMS');
  });

  it('shows every channel as No in red, with the reason, for a contact who opted out', () => {
    const out = renderAccount(
      <SubscriptionBody
        contact={contact({ whatsappSubscriptionStatus: 'subscribed', isUnsubscribed: true })}
      />,
      { session: can('contacts.consent.read') },
    );
    expect(out.match(/>Yes</g)).toBeNull();
    expect(out.match(/border-danger\/30 bg-danger\/10 text-danger/g)).toHaveLength(3);
    expect(out).toContain('opted out of marketing messages');
  });

  it('links to the consent card only for someone who may read it', () => {
    const withLink = renderAccount(<SubscriptionBody contact={contact()} />, {
      session: can('contacts.consent.read'),
    });
    expect(withLink).toContain(`href="/contacts/${ID}/consent"`);
    const without = renderAccount(<SubscriptionBody contact={contact()} />, { session: can() });
    expect(without).not.toContain('/consent');
  });

  it('reads in Arabic', () => {
    const out = renderAccount(<SubscriptionBody contact={contact()} />, {
      locale: 'ar',
      session: can('contacts.consent.read'),
    });
    expect(out).toContain('دليل كل موافقة');
  });
});

describe('ScoreRing and the pills', () => {
  it('draws the score with its band, and a dash when there is none', () => {
    const hot = renderAccount(<ScoreRing score={92} label="Lead score 92, Hot" />);
    expect(hot).toContain('aria-label="Lead score 92, Hot"');
    expect(hot).toContain('stroke-success');
    expect(hot).toContain('>92<');
    expect(renderAccount(<ScoreRing score={50} label="x" />)).toContain('stroke-warning');
    expect(renderAccount(<ScoreRing score={10} label="x" />)).toContain('stroke-muted-foreground');
    const none = renderAccount(<ScoreRing score={null} label="Not scored" />);
    expect(none).toContain('—');
    expect(none).not.toContain('stroke-success');
  });

  it('the opt-in pill is green, grey or red', () => {
    expect(renderAccount(<OptInPill value="yes" />)).toContain('text-success');
    expect(renderAccount(<OptInPill value="no" />)).toContain('text-muted-foreground');
    expect(renderAccount(<OptInPill value="out" />)).toContain('text-danger');
  });

  it('shows social links only for http(s) addresses and opens them safely', () => {
    const out = renderAccount(
      <SocialIcons
        contact={contact({
          customFields: { linkedin_url: 'https://linkedin.com/in/ana', facebook: 'javascript:x' },
        })}
      />,
    );
    expect(out).toContain('href="https://linkedin.com/in/ana"');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).not.toContain('javascript:');
    expect(renderAccount(<SocialIcons contact={contact()} />)).toBe('');
  });
});

describe('LocationBody and ComplianceBody', () => {
  it('names the country of the number and shows the time zone property', () => {
    const out = renderAccount(
      <LocationBody
        contact={contact({ customFields: { timezone: 'Asia/Kolkata', address: '12 MG Road' } })}
      />,
      { seed: [[['cat', 'fields', false], []]] },
    );
    expect(out).toContain('India');
    expect(out).toContain('Asia/Kolkata');
    expect(out).toContain('12 MG Road');
  });

  it('shows the minor flag from the list row and the opt-out state', () => {
    const out = renderAccount(
      <ComplianceBody contact={contact({ isMinor: true, isUnsubscribed: true })} />,
      { session: can() },
    );
    expect(out).toContain('Opted out of marketing');
    expect(out).toContain('Minor');
  });
});

describe('details page sub-nav', () => {
  const nav = (current: 'overview' | 'notes', permissions: string[]) =>
    renderAccount(
      <SectionNav
        contactId={ID}
        current={current}
        groups={navGroups((p) => permissions.includes(p))}
        counts={{ notes: { n: 3, more: false }, tasks: { n: 12, more: true } }}
      />,
      { session: can(...permissions) },
    );

  it('lists the sections in three groups with the current one marked and a link each', () => {
    const out = nav('notes', ['record.deals.read']);
    for (const group of ['Contact', 'Related', 'Record']) expect(out).toContain(`>${group}<`);
    expect(out).toContain(`href="/contacts/${ID}"`);
    expect(out).toContain(`href="/contacts/${ID}/notes"`);
    expect(out).toContain(`href="/contacts/${ID}/deals"`);
    expect(out).toContain(`href="/contacts/${ID}/history"`);
    expect(out.match(/aria-current="page"/g)).toHaveLength(1);
  });

  it('uses short labels and shows counts as small badges, a + when there are more', () => {
    const out = nav('overview', ['record.tasks.read']);
    expect(out).toMatch(/Notes<span[^>]*>3<\/span>/);
    expect(out).toMatch(/Tasks<span[^>]*>12\+<\/span>/);
    expect(out).toContain('>Source<');
    expect(out).not.toContain('Contact details');
  });

  it('leaves out a section the person may not open', () => {
    const out = nav('overview', []);
    expect(out).not.toContain('/deals');
    expect(out).not.toContain('/tasks');
    expect(out).not.toContain('/consent');
    expect(out).not.toContain('>Related<');
  });

  it('scrolls sideways on a phone and stacks on a wide screen', () => {
    const out = nav('overview', []);
    expect(out).toContain('overflow-x-auto');
    expect(out).toContain('lg:flex-col');
  });
});

describe('ContactQuickView', () => {
  it('is a named dialog that stays shut and empty without a contact', () => {
    const out = renderAccount(
      <ContactQuickView
        contactId=""
        panel="overview"
        focus={null}
        previousId={null}
        nextId={null}
        position={null}
        onNavigate={() => undefined}
        onPanel={() => undefined}
        onClose={() => undefined}
      />,
    );
    expect(out).toContain('<dialog');
    expect(out).toContain('aria-label="Contact quick view"');
    expect(out).not.toContain('Contact sections');
  });
});

describe('QuickTabs', () => {
  const page = (data: unknown[], hasMore = false) => ({
    pages: [{ data, page: { hasMore, nextCursor: hasMore ? 'n' : null, limit: 50 } }],
    pageParams: [undefined],
  });
  const tabs = (perms: string[]) => quickTabs((p) => perms.includes(p));
  const draw = (
    perms: string[],
    current: Parameters<typeof QuickTabs>[0]['current'],
    more = false,
  ) =>
    renderAccount(
      <QuickTabs contactId={ID} tabs={tabs(perms)} current={current} onSelect={() => undefined} />,
      {
        session: can(...perms),
        seed: [[[...NOTE_KEYS.list(ID), {}], page([{ id: 'n1' }, { id: 'n2' }], more)]],
      },
    );

  it('is a tab list: Overview, Activity, Notes, Meetings and Files, Tasks when tasks may be read, and a menu for the rest', () => {
    const out = draw(['record.tasks.read', 'inbox.conversation.read'], 'notes');
    expect(out).toContain('role="tablist"');
    for (const name of ['Overview', 'Activity', 'Notes', 'Tasks', 'Meetings', 'Files']) {
      expect(out, name).toContain(`>${name}`);
    }
    expect(out.match(/role="tab"/g)).toHaveLength(6);
    // the rest (Conversations, Communication stats, Properties) sit behind "+3 more"
    expect(out).toContain('+3 more');
    expect(out).toContain('aria-label="More sections"');
  });

  it('marks the current tab, with only that tab in the tab order', () => {
    const out = draw([], 'notes');
    expect(out.match(/aria-selected="true"/g)).toHaveLength(1);
    expect(out.match(/tabindex="0"/g)).toHaveLength(1);
    expect(out).toMatch(/id="qv-tab-notes"[^>]*aria-selected="true"/);
  });

  it('has no Tasks tab without the permission to read tasks, and no Conversations without the inbox', () => {
    const out = draw([], 'overview');
    expect(out).not.toContain('qv-tab-tasks');
    expect(out).toContain('+2 more');
  });

  it('shows the count of notes as a small badge, and a + when there are more pages', () => {
    expect(draw([], 'overview')).toMatch(/>Notes<span[^>]*>2<\/span>/);
    expect(draw([], 'overview', true)).toMatch(/>Notes<span[^>]*>2\+<\/span>/);
  });

  it('names the open section on the menu when it is one of the rest', () => {
    const out = draw(['inbox.conversation.read'], 'conversations');
    expect(out).toMatch(/Conversations<svg/);
    expect(out).not.toContain('+3 more');
  });

  it('reads in Arabic, with logical (not left/right) spacing', () => {
    const out = renderAccount(
      <QuickTabs contactId={ID} tabs={tabs([])} current="overview" onSelect={() => undefined} />,
      { session: can(), locale: 'ar' },
    );
    expect(out).toContain('role="tablist"');
    expect(out).not.toMatch(/\b(?:ml|mr|pl|pr)-\d/);
  });
});
