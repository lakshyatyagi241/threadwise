import { describe, expect, it } from 'vitest';
import { renderIntl } from '@/features/flow-builder-editor/test-utils/intl';
import { AudiencePicker } from './audience-picker';

const base = {
  tags: [],
  groups: [],
  segments: [],
  contacts: [],
  contactsDenied: false,
  filter: {},
  onFilter: () => undefined,
  selectedTags: [],
  selectedGroups: [],
  selectedSegments: [],
  selectedContacts: [],
  onTags: () => undefined,
  onGroups: () => undefined,
  onSegments: () => undefined,
  onContacts: () => undefined,
};

describe('AudiencePicker: how the picks combine (row 290)', () => {
  it('offers Any and All when the caller can choose how the picks combine, and marks the current one', () => {
    const html = renderIntl(<AudiencePicker {...base} match="all" onMatch={() => undefined} />);
    expect(html).toContain('role="radiogroup"');
    expect(html.match(/role="radio"/g)).toHaveLength(2);
    expect(html).toMatch(/aria-checked="true"[^>]*>[^<]*All of them/);
    expect(html).toMatch(/aria-checked="false"[^>]*>[^<]*Any of them/);
  });

  it('shows no switch where the caller does not choose, such as the WhatsApp broadcast', () => {
    const html = renderIntl(<AudiencePicker {...base} />);
    expect(html).not.toContain('role="radio"');
  });

  it('names the contacts section, so the individual contacts read as an audience option', () => {
    const html = renderIntl(<AudiencePicker {...base} />);
    expect(html).toContain('Contacts');
  });
});
