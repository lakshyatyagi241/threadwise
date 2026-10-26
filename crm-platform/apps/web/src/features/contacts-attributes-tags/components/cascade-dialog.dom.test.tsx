// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  FieldDependencyResponse,
  FieldOptionDependencyResponse,
  FieldOptionResponse,
  FieldResponse,
} from '@crm/contracts';
import { ToastProvider } from '@crm/ui';
import { loadMessages } from '@/i18n/messages';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const state = vi.hoisted(() => ({
  replace: vi.fn(async (_id: string, _body: unknown) => undefined),
  remove: vi.fn(async (_id: string) => undefined),
}));
vi.mock('../api/properties', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/properties')>()),
  replaceCascade: (id: string, body: unknown) => state.replace(id, body),
  removeCascade: (id: string) => state.remove(id),
  invalidateProperties: () => Promise.resolve([]),
}));

import { CascadeDialog } from './cascade-dialog';

const option = (
  id: string,
  fieldId: string,
  value: string,
  position: number,
): FieldOptionResponse =>
  ({
    id,
    fieldId,
    value,
    label: value,
    position,
    isHidden: false,
    rowVersion: 1,
  }) as FieldOptionResponse;

const select = (
  id: string,
  key: string,
  label: string,
  options: FieldOptionResponse[],
): FieldResponse =>
  ({
    id,
    key,
    label,
    fieldType: 'select',
    sectionId: 's1',
    position: 0,
    rowVersion: 1,
    isRequired: false,
    isMasked: false,
    isActive: true,
    isSystem: false,
    isHidden: false,
    isReadOnly: false,
    config: {},
    options,
    optionCount: options.length,
  }) as FieldResponse;

const region = select('region', 'region', 'Region', [
  option('o-n', 'region', 'north', 0),
  option('o-s', 'region', 'south', 1),
]);
const city = select('city', 'city', 'City', [
  option('o-d', 'city', 'delhi', 0),
  option('o-m', 'city', 'mumbai', 1),
  option('o-c', 'city', 'chennai', 2),
]);
const fields = [region, city];

const messages = loadMessages('en') as unknown as Parameters<
  typeof NextIntlClientProvider
>[0]['messages'];

let host: HTMLElement | undefined;
let root: Root | undefined;

beforeEach(() => {
  // jsdom has no modal dialogs: the dialog only needs these two to exist.
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
  state.replace.mockClear();
  state.remove.mockClear();
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  host = undefined;
  root = undefined;
});

async function mount(
  dependencies: FieldDependencyResponse[] = [],
  optionDependencies: FieldOptionDependencyResponse[] = [],
) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <QueryClientProvider client={new QueryClient()}>
          <ToastProvider dismissLabel="Dismiss">
            <CascadeDialog
              open
              fields={fields}
              dependencies={dependencies}
              optionDependencies={optionDependencies}
              canEdit
              onClose={() => undefined}
            />
          </ToastProvider>
        </QueryClientProvider>
      </NextIntlClientProvider>,
    );
  });
}

const byText = (text: string, tag = 'button') =>
  [...document.querySelectorAll<HTMLElement>(tag)].find((el) => el.textContent?.trim() === text);

/** The checkbox for `choice` in the block titled `parent`. */
function tick(parent: string, choice: string): HTMLInputElement {
  const block = [...document.querySelectorAll<HTMLElement>('div.rounded-md')].find(
    (el) => el.querySelector(':scope > div')?.textContent?.trim() === parent,
  );
  const label = [...(block?.querySelectorAll('label') ?? [])].find(
    (el) => el.textContent?.trim() === choice,
  );
  return label!.querySelector('input')!;
}

async function choose(selectId: string, value: string) {
  const el = document.getElementById(selectId) as HTMLSelectElement;
  await act(async () => {
    el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe('CascadeDialog', () => {
  it('says there are no dependent fields yet, and offers to add one', async () => {
    await mount();
    expect(document.body.textContent).toContain('No dependent fields yet.');
    expect(byText('Add dependent field')).toBeDefined();
  });

  it('saves the grid as option pairs of the chosen parent and dependent property', async () => {
    await mount();
    await act(async () => byText('Add dependent field')!.click());
    const parentSelect = document.querySelector('select') as HTMLSelectElement;
    await choose(parentSelect.id, 'region');
    const childSelect = document.querySelectorAll('select')[1] as HTMLSelectElement;
    await choose(childSelect.id, 'city');

    await act(async () => tick('north', 'delhi').click());
    await act(async () => tick('south', 'chennai').click());
    await act(async () => byText('Save')!.click());

    expect(state.replace).toHaveBeenCalledTimes(1);
    expect(state.replace).toHaveBeenCalledWith('city', {
      dependsOnFieldId: 'region',
      optionPairs: [
        { parentOptionId: 'o-n', childOptionId: 'o-d' },
        { parentOptionId: 'o-s', childOptionId: 'o-c' },
      ],
    });
  });

  it('lists an existing cascade and opens it with its saved pairs ticked', async () => {
    const link: FieldDependencyResponse = {
      id: 'l1',
      fieldId: 'city',
      dependsOnFieldId: 'region',
      dependsOnOptionId: null,
      dependsOnValue: null,
      createdAt: '2026-10-01T00:00:00.000Z',
    };
    const pair: FieldOptionDependencyResponse = {
      id: 'p1',
      parentFieldId: 'region',
      parentOptionId: 'o-n',
      childFieldId: 'city',
      childOptionId: 'o-m',
      createdAt: '2026-10-01T00:00:00.000Z',
    };
    await mount([link], [pair]);
    expect(document.body.textContent).toContain('City');
    expect(document.body.textContent).toContain('depends on Region');

    await act(async () =>
      document.querySelector<HTMLButtonElement>('[aria-label="Edit City"]')!.click(),
    );
    expect(tick('north', 'mumbai').checked).toBe(true);
    expect(tick('north', 'delhi').checked).toBe(false);
    expect(tick('south', 'mumbai').checked).toBe(false);
  });

  it('a cascade child cannot be picked twice: it is no longer offered as a new dependent property', async () => {
    const link: FieldDependencyResponse = {
      id: 'l1',
      fieldId: 'city',
      dependsOnFieldId: 'region',
      dependsOnOptionId: null,
      dependsOnValue: null,
      createdAt: '2026-10-01T00:00:00.000Z',
    };
    await mount([link]);
    await act(async () => byText('Add dependent field')!.click());
    const childSelect = document.querySelectorAll('select')[1] as HTMLSelectElement;
    expect([...childSelect.options].map((o) => o.value)).not.toContain('city');
  });
});
