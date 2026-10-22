// @vitest-environment jsdom
import { NextIntlClientProvider } from 'next-intl';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FieldResponse } from '@crm/contracts';
import { loadMessages } from '@/i18n/messages';
import type { BulkPropertyChanges } from '../lib/bulk-properties';
import { BulkPropertiesSection } from './bulk-properties-section';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const f = (key: string) =>
  ({
    id: key,
    key,
    label: `Label ${key}`,
    fieldType: 'text',
    isRequired: false,
    isActive: true,
    isSystem: false,
    isHidden: false,
    isReadOnly: false,
    isMasked: false,
    position: 0,
    config: {},
    options: [],
  }) as unknown as FieldResponse;

let host: HTMLElement;
let root: Root;

function mount(changes: BulkPropertyChanges, onChange: (next: BulkPropertyChanges) => void) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={loadMessages('en')} timeZone="UTC">
        <BulkPropertiesSection
          fields={[f('city'), f('tier')]}
          changes={changes}
          problems={{}}
          count={3}
          idPrefix="x"
          onChange={onChange}
        />
      </NextIntlClientProvider>,
    );
  });
}

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('BulkPropertiesSection remove (×)', () => {
  it('takes only that property out of the update and keeps the others', () => {
    const onChange = vi.fn();
    mount({ city: { mode: 'set', value: 'Pune' }, tier: { mode: 'clear' } }, onChange);
    const x = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Remove Label city from the update"]',
    )!;
    act(() => x.click());
    expect(onChange).toHaveBeenCalledWith({ tier: { mode: 'clear' } });
  });

  it('removes a property that is set to be cleared the same way', () => {
    const onChange = vi.fn();
    mount({ tier: { mode: 'clear' } }, onChange);
    const x = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Remove Label tier from the update"]',
    )!;
    act(() => x.click());
    expect(onChange).toHaveBeenCalledWith({});
  });
});
