import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type {
  ComposeTemplate,
  ContactGroupResponse,
  ContactResponse,
  SegmentResponse,
  TagResponse,
} from '@crm/contracts';
import { AudiencePicker } from './audience-picker';
import { OverridesPanel } from './overrides-panel';

const messages = JSON.parse(
  readFileSync(join(process.cwd(), 'messages', 'en', 'broadcasts.json'), 'utf8'),
) as Record<string, unknown>;
const html = (el: ReactElement) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      {el}
    </NextIntlClientProvider>,
  );

const none = () => undefined;

describe('audience picker', () => {
  const contact = (id: string, name: string, phone: string) =>
    ({ id, name, firstName: null, lastName: null, phone }) as ContactResponse;
  const props = {
    tags: [{ id: 't1', name: 'VIP', color: null }] as TagResponse[],
    groups: [{ id: 'g1', name: 'Leads' }] as ContactGroupResponse[],
    segments: [{ id: 's1', name: 'Hot leads', memberCount: 12 }] as SegmentResponse[],
    contacts: [contact('c1', 'Asha Rao', '+91 98'), contact('c2', 'Ravi', '+91 77')],
    contactsDenied: false,
    filter: {},
    onFilter: none,
    selectedTags: [],
    selectedGroups: ['g1'],
    selectedSegments: [],
    selectedContacts: ['c1'],
    onTags: none,
    onGroups: none,
    onSegments: none,
    onContacts: none,
  };
  it('shows chips, the table, the selected count and the checked state', () => {
    const out = html(<AudiencePicker {...props} />);
    for (const s of [
      'VIP',
      'Leads',
      'Hot leads · 12',
      'Filter contacts',
      'Asha Rao',
      'Ravi',
      '1 selected',
      'Search by name or phone',
    ])
      expect(out).toContain(s);
  });
  it('keeps the segment, tag and group rows when there are none and links to making one; says so when contacts are empty or denied', () => {
    const out = html(
      <AudiencePicker {...props} segments={[]} tags={[]} groups={[]} contacts={[]} />,
    );
    for (const s of ['No segments yet.', 'No tags yet.', 'No groups yet.', 'Create one'])
      expect(out).toContain(s);
    expect(out).toContain('No contacts yet.');
    expect(html(<AudiencePicker {...props} contactsDenied />)).toContain(
      'You do not have access to the contact list',
    );
  });
});

describe('overrides panel', () => {
  const t = (o: Partial<ComposeTemplate> = {}): ComposeTemplate => ({
    id: 't',
    name: 'promo',
    header: 'Sale {{name}}',
    body: 'Hi {{1}} order {{2}}',
    footer: null,
    category: 'marketing',
    type: 'standard',
    engine: 'waba',
    language: 'en_US',
    buttons: [
      { type: 'url', text: 'Shop', value: 'https://x.test/{{1}}' },
      { type: 'quick_reply', text: 'Yes' },
    ],
    variableMap: {
      body: [
        { num: 1, key: 'first_name' },
        { num: 2, key: 'order_id' },
      ],
    },
    attachmentType: null,
    attachmentUrl: null,
    senderLabel: null,
    twilioReady: false,
    ...o,
  });
  const catalog = {
    groups: [
      {
        group: 'contact' as const,
        items: [
          { key: 'first_name', label: 'First name', sample: 'Asha' },
          { key: 'email', label: 'Email', sample: null },
        ],
      },
    ],
  };

  it('one row per slot with its own name, what a blank fills with, chips and the button value', () => {
    const out = html(<OverridesPanel template={t()} catalog={catalog} onChange={none} />);
    for (const s of [
      'Fill in this send',
      'First name',
      'Auto-fills from',
      'Asha',
      '{{order_id}}',
      'Button values',
      'Shop',
      'Leave blank to auto-fill',
    ])
      expect(out).toContain(s);
    expect(out).not.toContain('>Yes<'); // a quick reply carries no send-time value
  });
  it('a slot with no matching attribute and no default warns that it sends empty', () => {
    expect(
      html(
        <OverridesPanel
          template={t({ body: 'Hi {{1}}', variableMap: {} })}
          catalog={catalog}
          onChange={none}
        />,
      ),
    ).toContain('this will send empty');
  });
  it('auth templates are locked; Twilio keeps variables but drops buttons; a template with nothing to fill says so', () => {
    expect(
      html(<OverridesPanel template={t({ type: 'auth' })} catalog={catalog} onChange={none} />),
    ).toContain('freshly generated OTP');
    const tw = html(
      <OverridesPanel template={t({ engine: 'twilio' })} catalog={catalog} onChange={none} />,
    );
    expect(tw).toContain('Content SID');
    expect(tw).not.toContain('Button values');
    expect(
      html(
        <OverridesPanel
          template={t({ header: null, body: 'Hello', buttons: [], variableMap: {} })}
          catalog={catalog}
          onChange={none}
        />,
      ),
    ).toContain('sends exactly as written');
  });
  it('a media header offers a link field with the type limit', () => {
    const out = html(
      <OverridesPanel
        template={t({
          header: null,
          attachmentType: 'IMAGE',
          attachmentUrl: 'https://x.test/a.png',
        })}
        catalog={catalog}
        onChange={none}
      />,
    );
    for (const s of ['Header media', 'JPG or PNG', 'public HTTPS link', 'https://x.test/a.png'])
      expect(out).toContain(s);
  });
});
