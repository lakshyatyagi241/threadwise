// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WabaComplianceInfo } from '@crm/contracts';
import en from '../../../../messages/en/whatsapp-cloud-api-waba.json';
import { ComplianceCard } from './compliance-card';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const hooks = vi.hoisted(() => ({
  record: null as WabaComplianceInfo | null,
  mutate: vi.fn(),
}));

vi.mock('../api/hooks', () => ({
  useCompliance: () => ({ isPending: false, isError: false, data: hooks.record }),
  useUpdateCompliance: () => ({ mutate: hooks.mutate, isPending: false }),
}));

const EMPTY: WabaComplianceInfo = {
  entityName: null,
  entityType: null,
  entityTypeCustom: null,
  isRegistered: null,
  customerCare: { email: null, mobile: null, landline: null },
  grievanceOfficer: { name: null, email: null, mobile: null, landline: null },
};

let root: Root;
let host: HTMLElement;
beforeEach(() => {
  hooks.mutate.mockReset();
  hooks.record = EMPTY;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function mount() {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={en}>
        <ComplianceCard id="11111111-1111-4111-8111-111111111111" />
      </NextIntlClientProvider>,
    );
  });
}

/** React reads a value change only through the element's own setter, so the test uses it as the browser does. */
function setValue(el: Element, value: string) {
  const proto =
    el instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
  act(() => {
    el.dispatchEvent(
      new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }),
    );
  });
}

const input = (id: string) => host.querySelector<HTMLInputElement>(`#${id}`)!;
const submit = () =>
  act(() => {
    host
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });

describe('the compliance form', () => {
  it('opens on Other, which asks for the custom type and not for the registration answer', () => {
    mount();
    const type = host.querySelector<HTMLSelectElement>('#cp-type')!;
    expect(type.value).toBe('OTHER');
    expect(input('cp-type-custom')).not.toBeNull();
    expect(host.querySelector('input[name="cp-registered"]')).not.toBeNull();
  });

  it('shows what is missing, by field, and sends nothing', () => {
    mount();
    submit();
    const text = host.textContent ?? '';
    expect(text).toContain('Enter the legal name of the business');
    expect(text).toContain('Describe the business type');
    expect(text).toContain('Say whether the business is registered');
    expect(text).toContain('Enter an email, a mobile or a landline');
    expect(text).toContain("Enter the grievance officer's name");
    expect(hooks.mutate).not.toHaveBeenCalled();
  });

  it('sends the trimmed answers when the form is complete', () => {
    mount();
    setValue(input('cp-name'), '  Acme Traders  ');
    setValue(host.querySelector('#cp-type')!, 'PARTNERSHIP');
    act(() => {
      host.querySelector<HTMLInputElement>('input[name="cp-registered"]')!.click();
    });
    setValue(input('cp-care-email'), ' care@acme.example ');
    setValue(input('cp-officer-name'), 'Asha Rao');
    setValue(input('cp-officer-mobile'), '+919876543210');
    submit();
    expect(hooks.mutate).toHaveBeenCalledTimes(1);
    expect(hooks.mutate.mock.calls[0]![0]).toEqual({
      entityName: 'Acme Traders',
      entityType: 'PARTNERSHIP',
      isRegistered: true,
      customerCare: { email: 'care@acme.example', mobile: '', landline: '' },
      grievanceOfficer: { name: 'Asha Rao', email: '', mobile: '+919876543210', landline: '' },
    });
  });
});
