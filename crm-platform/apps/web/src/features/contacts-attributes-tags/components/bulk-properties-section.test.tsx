import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { FieldResponse } from '@crm/contracts';
import { BulkPropertiesSection } from './bulk-properties-section';

const messages = JSON.parse(
  readFileSync(join(process.cwd(), 'messages', 'en', 'contacts-attributes-tags.json'), 'utf8'),
) as Record<string, unknown>;

const html = (el: ReactElement) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      {el}
    </NextIntlClientProvider>,
  );

const f = (key: string, fieldType: FieldResponse['fieldType'], over: Partial<FieldResponse> = {}) =>
  ({
    id: key,
    key,
    label: `Label ${key}`,
    fieldType,
    isRequired: false,
    isActive: true,
    isSystem: false,
    isHidden: false,
    isReadOnly: false,
    isMasked: false,
    position: 0,
    config: {},
    options: [
      { id: 'o1', fieldId: key, value: 'gold', label: 'Gold', position: 0, isHidden: false },
    ],
    ...over,
  }) as unknown as FieldResponse;

const base = {
  count: 3,
  idPrefix: 'x',
  problems: {},
  onChange: () => undefined,
};

describe('BulkPropertiesSection', () => {
  it('renders nothing when the workspace has no editable property', () => {
    expect(
      html(
        <BulkPropertiesSection
          {...base}
          fields={[f('a', 'text', { isSystem: true })]}
          changes={{}}
        />,
      ),
    ).toBe('');
  });

  it('starts on Keep: an "Add property" button, no rows', () => {
    const out = html(<BulkPropertiesSection {...base} fields={[f('city', 'text')]} changes={{}} />);
    expect(out).toContain('Custom properties');
    expect(out).toContain('Add property');
    expect(out).not.toContain('Label city');
    expect(out).toContain('all 3 selected contacts');
  });

  it('draws each added property with its typed input, a Clear action and a Keep action', () => {
    const out = html(
      <BulkPropertiesSection
        {...base}
        fields={[
          f('city', 'text'),
          f('tier', 'select'),
          f('budget', 'integer'),
          f('joined', 'date'),
        ]}
        changes={{
          city: { mode: 'set', value: 'Pune' },
          tier: { mode: 'set', value: 'gold' },
          budget: { mode: 'set', value: '5' },
          joined: { mode: 'set', value: '2026-03-04' },
        }}
      />,
    );
    expect(out).toContain('value="Pune"');
    expect(out).toContain('<option value="gold" selected="">Gold</option>');
    expect(out).toContain('type="number"');
    expect(out).toContain('type="date"');
    expect(out).toContain('value="2026-03-04"');
    expect((out.match(/>Clear</g) ?? []).length).toBe(4);
    expect((out.match(/>Keep</g) ?? []).length).toBe(4);
  });

  it('a cleared property shows what will happen and offers "Set a value"; a required one cannot be cleared', () => {
    const out = html(
      <BulkPropertiesSection
        {...base}
        fields={[f('city', 'text'), f('must', 'text', { isRequired: true })]}
        changes={{ city: { mode: 'clear' }, must: { mode: 'set', value: 'x' } }}
      />,
    );
    expect(out).toContain('Will be emptied on all 3 selected contacts.');
    expect(out).toContain('Set a value');
    expect(out).toMatch(/<button[^>]*disabled=""[^>]*>Clear<\/button>/);
  });

  it('shows the per-property problem under the row', () => {
    const out = html(
      <BulkPropertiesSection
        {...base}
        fields={[f('city', 'text'), f('budget', 'integer')]}
        changes={{ city: { mode: 'set', value: '' }, budget: { mode: 'set', value: 'abc' } }}
        problems={{ city: 'empty', budget: 'number' }}
      />,
    );
    expect(out).toContain('Enter a value, or choose Clear.');
    expect(out).toContain('Enter a number.');
  });
});
