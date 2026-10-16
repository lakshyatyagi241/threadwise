import { describe, expect, it } from 'vitest';
import { ToastProvider } from '@crm/ui';
import type { AttributePickerFeed, WaForm, WaFormField } from '@crm/contracts';
import {
  makeSession,
  renderAccount,
  type Seed,
} from '@/features/auth-registration-security/account/render-test-utils';
import { KEYS } from '@/features/contacts-attributes-tags/api/contacts';
import { WA_FORM_KEYS } from '../api/wa-forms-hooks';
import { WaFormBuilderScreen } from './wa-form-builder-screen';

const DEFAULT_FIELDS: WaFormField[] = [
  { id: 'fld_name', kind: 'short_text', label: 'Name', required: true, mapsTo: 'name' },
  { id: 'fld_notes', kind: 'paragraph', label: 'Notes', required: false },
  { id: 'fld_age', kind: 'number', label: 'Your age', required: false },
  { id: 'fld_dob', kind: 'date', label: 'Date of birth', required: false },
  {
    id: 'fld_consent',
    kind: 'checkbox',
    label: 'I agree to receive marketing messages',
    required: false,
    options: ['I agree'],
  },
];

const form = (fields: WaFormField[] = DEFAULT_FIELDS): WaForm => ({
  id: '33333333-3333-4333-8333-333333333333',
  title: 'Lead capture',
  purpose: null,
  slug: 'lead-capture',
  audienceType: 'lead_capture',
  submissionCap: 0,
  capReachedNote: null,
  sendButtonLabel: 'Send',
  thankYouNote: null,
  definition: { screens: [{ id: 'A', fields }] },
  status: 'draft',
  isLive: false,
  publishedAt: null,
  publishError: null,
  fieldsCount: fields.length,
  submissionCount: 0,
  createdAt: '2026-10-08T00:00:00.000Z',
  rowVersion: 1,
});

const feed = (custom: AttributePickerFeed['custom'] = []): AttributePickerFeed => ({
  system: [],
  custom,
});

const ALL = {
  'wfl.forms.read': 'all',
  'wfl.forms.create': 'all',
  'wfl.forms.manage': 'all',
  'wfl.forms.delete': 'all',
} as const;

function render(customAttributes: AttributePickerFeed['custom'] = [], fields?: WaFormField[]) {
  const f = form(fields);
  const seed: Seed = [
    [WA_FORM_KEYS.detail(f.id), f],
    [KEYS.attributePicker, feed(customAttributes)],
  ];
  return renderAccount(
    <ToastProvider dismissLabel="x">
      <WaFormBuilderScreen id={f.id} />
    </ToastProvider>,
    { session: makeSession({ permissions: ALL as never }), seed },
  );
}

describe('the WhatsApp Form builder — contact property mapping', () => {
  it('offers the system contact fields to map to', () => {
    const html = render();
    expect(html).toContain('Maps to');
    expect(html).toContain('Contact fields');
    expect(html).toContain('Full name');
    expect(html).toContain('First name');
    expect(html).toContain('Job title');
  });

  it('lists the active custom attributes alongside the system fields', () => {
    const html = render([
      { key: 'budget', name: 'Budget', description: null, value: null },
    ]);
    expect(html).toContain('Custom properties');
    expect(html).toContain('Budget');
  });

  it('does not offer a custom-properties group when there are none', () => {
    const html = render([]);
    expect(html).not.toContain('Custom properties');
  });
});

describe('the WhatsApp Form builder — privacy mapping (age, date of birth, consent)', () => {
  it('offers the privacy group, with age/date-of-birth/consent options, on the matching field kinds', () => {
    const html = render();
    expect(html).toContain('Privacy &amp; consent');
    expect(html).toContain('Age (minor check)');
    expect(html).toContain('Date of birth (minor check)');
    expect(html).toContain('Marketing consent (WhatsApp)');
    expect(html).toContain('Service agreement (not marketing)');
  });

  it('does not offer the privacy group at all on a form with no number, date or checkbox field', () => {
    const html = render(undefined, [
      { id: 'fld_name', kind: 'short_text', label: 'Name', required: true },
      { id: 'fld_notes', kind: 'paragraph', label: 'Notes', required: false },
    ]);
    expect(html).not.toContain('Privacy &amp; consent');
  });
});
