// @vitest-environment jsdom
import { NextIntlClientProvider } from 'next-intl';
import { act, useState, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { FieldResponse } from '@crm/contracts';
import { loadMessages } from '@/i18n/messages';
import type { BulkPropertyChanges } from '../lib/bulk-properties';
import { BulkPropertiesSection } from './bulk-properties-section';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
    options: [],
    ...over,
  }) as unknown as FieldResponse;

/** Holds the changes in state the way the bulk dialog does, and shows the keys still in the update. */
function Harness({ fields, initial }: { fields: FieldResponse[]; initial: BulkPropertyChanges }) {
  const [changes, setChanges] = useState<BulkPropertyChanges>(initial);
  return (
    <>
      <BulkPropertiesSection
        fields={fields}
        changes={changes}
        problems={{}}
        count={3}
        idPrefix="x"
        onChange={setChanges}
      />
      <output data-testid="keys">{Object.keys(changes).join(',')}</output>
    </>
  );
}

let host: HTMLElement;
let root: Root;

function mount(ui: ReactElement) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={loadMessages('en')} timeZone="UTC">
        {ui}
      </NextIntlClientProvider>,
    );
  });
}

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const keysLeft = () => host.querySelector('[data-testid="keys"]')!.textContent;
const crossFor = (label: string) =>
  host.querySelector<HTMLButtonElement>(`button[aria-label="Remove ${label}"]`);

describe('BulkPropertiesSection remove cross', () => {
  it('takes only that property off the update when its cross is pressed', () => {
    mount(
      <Harness
        fields={[f('city', 'text'), f('tier', 'text')]}
        initial={{
          city: { mode: 'set', value: 'Pune' },
          tier: { mode: 'set', value: 'gold' },
        }}
      />,
    );
    expect(keysLeft()).toBe('city,tier');

    act(() => crossFor('Label city')!.click());

    expect(keysLeft()).toBe('tier');
    expect(host.textContent).not.toContain('Label city');
    expect(crossFor('Label tier')).not.toBeNull();
    expect(document.activeElement?.textContent).toBe('Add property');
  });

  it('also takes off a required property: dropping it from the update touches no data', () => {
    mount(
      <Harness
        fields={[f('must', 'text', { isRequired: true })]}
        initial={{ must: { mode: 'set', value: 'x' } }}
      />,
    );

    act(() => crossFor('Label must')!.click());

    expect(keysLeft()).toBe('');
    expect(crossFor('Label must')).toBeNull();
  });
});
