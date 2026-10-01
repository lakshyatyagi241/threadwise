import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type {
  ComposeSender,
  ComposeTemplate,
  ContactGroupResponse,
  ContactResponse,
  TagResponse,
} from '@crm/contracts';
import { AudiencePicker } from './audience-picker';
import { ComposePreview } from './compose-preview';
import { OverridesPanel } from './overrides-panel';
import { ScheduleSection } from './schedule-section';
import { SenderPicker } from './sender-picker';

const messages = JSON.parse(
  readFileSync(join(process.cwd(), 'messages', 'en', 'broadcasts.json'), 'utf8'),
) as Record<string, unknown>;
const html = (el: ReactElement) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      {el}
    </NextIntlClientProvider>,
  );

const sender = (over: Partial<ComposeSender> = {}): ComposeSender => ({
  key: 'waba:1',
  label: 'Cloud',
  phone: '+919800000001',
  engine: 'waba',
  engineLabel: 'Meta',
  isDefault: true,
  ...over,
});
const none = () => undefined;

describe('sender picker', () => {
  it('no number: a warning; one number: a fixed row with no checkbox', () => {
    expect(
      html(<SenderPicker senders={[]} checked={[]} shares={{}} onChecked={none} onShare={none} />),
    ).toContain('No connected devices.');
    const one = html(
      <SenderPicker
        senders={[sender()]}
        checked={[]}
        shares={{}}
        onChecked={none}
        onShare={none}
      />,
    );
    expect(one).toContain('Send from device');
    expect(one).toContain('Cloud');
    expect(one).not.toContain('type="checkbox"');
  });

  it('several numbers: tick list with live shares, engine headers only when engines differ', () => {
    const two = [sender(), sender({ key: 'waba:2', label: 'Second' })];
    const same = html(
      <SenderPicker
        senders={two}
        checked={['waba:1', 'waba:2']}
        shares={{ 'waba:1': 7, 'waba:2': 3 }}
        onChecked={none}
        onShare={none}
      />,
    );
    expect(same).toContain('Multi-device');
    expect(same).toContain('70%');
    expect(same).toContain('30%');
    expect(same).not.toContain('Meta</div>');
    const mixed = html(
      <SenderPicker
        senders={[
          ...two,
          sender({
            key: 'baileys:3',
            engine: 'baileys',
            engineLabel: 'Unofficial API',
            label: 'Phone',
          }),
        ]}
        checked={[]}
        shares={{}}
        onChecked={none}
        onShare={none}
      />,
    );
    expect(mixed).toContain('Unofficial API');
    expect(mixed).toContain('Meta');
    expect(mixed).toContain('—');
  });
});

describe('audience picker', () => {
  const contact = (id: string, name: string, phone: string) =>
    ({ id, name, firstName: null, lastName: null, phone }) as ContactResponse;
  const props = {
    tags: [{ id: 't1', name: 'VIP', color: null }] as TagResponse[],
    groups: [{ id: 'g1', name: 'Leads' }] as ContactGroupResponse[],
    contacts: [contact('c1', 'Asha Rao', '+91 98'), contact('c2', 'Ravi', '+91 77')],
    contactsDenied: false,
    selectedTags: [],
    selectedGroups: ['g1'],
    selectedContacts: ['c1'],
    onTags: none,
    onGroups: none,
    onContacts: none,
  };
  it('shows chips, the table, the selected count and the checked state', () => {
    const out = html(<AudiencePicker {...props} />);
    for (const s of ['VIP', 'Leads', 'Asha Rao', 'Ravi', '1 selected', 'Search by name or phone'])
      expect(out).toContain(s);
  });
  it('hides the tag and group rows when there are none; says so when contacts are empty or denied', () => {
    const out = html(<AudiencePicker {...props} tags={[]} groups={[]} contacts={[]} />);
    expect(out).not.toContain('Tags');
    expect(out).toContain('No contacts yet.');
    expect(html(<AudiencePicker {...props} contactsDenied />)).toContain(
      'You do not have access to the contact list',
    );
  });
});

describe('schedule section', () => {
  const base = {
    date: '2026-10-05',
    time: '09:30',
    timezone: 'Asia/Kolkata',
    minDate: '2026-10-02',
    onType: none,
    onDate: none,
    onTime: none,
    onTimezone: none,
  };
  it('send now hides the date, time and zone; later shows them with the earliest date', () => {
    const now = html(<ScheduleSection type="now" {...base} />);
    expect(now).toContain('Send now');
    expect(now).not.toContain('Send date');
    const later = html(<ScheduleSection type="later" {...base} />);
    for (const s of [
      'Send date',
      'Send time',
      'Timezone',
      'min="2026-10-02"',
      'value="09:30"',
      'Asia/Kolkata',
    ])
      expect(later).toContain(s);
  });
});

describe('compose preview', () => {
  const tpl: ComposeTemplate = {
    id: 't',
    name: 'promo',
    header: 'Sale',
    body: 'Hi {{1}}',
    footer: 'STOP',
    category: 'marketing',
    type: 'standard',
    engine: 'waba',
    language: 'en_US',
    buttons: [{ type: 'url', text: 'Shop' }],
    variableMap: { body: [{ num: 1, key: 'first_name' }] },
    attachmentType: 'VIDEO',
    attachmentUrl: null,
    senderLabel: null,
    twilioReady: false,
  };
  it('empty until a template is picked; then samples, buttons and the media chip', () => {
    expect(html(<ComposePreview template={undefined} selected={0} later={false} />)).toContain(
      'Pick a template to preview…',
    );
    const out = html(<ComposePreview template={tpl} selected={12} later />);
    for (const s of [
      'Hi John',
      'Sale',
      'STOP',
      'Shop',
      'Video preview',
      'Marketing',
      '>12<',
      'Later',
    ])
      expect(out).toContain(s);
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
