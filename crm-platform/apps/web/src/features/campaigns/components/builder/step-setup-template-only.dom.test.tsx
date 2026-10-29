// @vitest-environment jsdom
import { NextIntlClientProvider } from 'next-intl';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComposeSender } from '@crm/contracts';
import { loadMessages } from '@/i18n/messages';
import { EMPTY_FORM } from '../../lib/builder-model';
import { StepSetup } from './step-setup';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

const sender: ComposeSender = {
  key: 'baileys:3f2b8c1e-0000-4000-8000-000000000001',
  label: 'Line 1',
  phone: '+910000000001',
  engine: 'baileys',
  engineLabel: 'Personal',
  isDefault: true,
};

let root: ReturnType<typeof createRoot> | null = null;
function mount(templateOnly: boolean, patch = vi.fn()) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(
      <NextIntlClientProvider locale="en" messages={loadMessages('en')} timeZone="UTC">
        <StepSetup
          form={{ ...EMPTY_FORM, senderKey: sender.key, type: 'template', templateId: 'x' }}
          patch={patch}
          senders={[sender]}
          engine="baileys"
          onSender={() => undefined}
          notVerified={false}
          templateOnly={templateOnly}
        />
      </NextIntlClientProvider>,
    );
  });
  return patch;
}
afterEach(() => {
  act(() => root?.unmount());
  document.body.innerHTML = '';
});

const card = (title: string) =>
  [...document.querySelectorAll('button[role="radio"]')].find((b) =>
    b.textContent?.includes(title),
  ) as HTMLElement;

describe('the campaign type when it is opened from a template ("Use in a broadcast")', () => {
  it('shows all three types, with the custom message and the flow off and the template chosen, and says why', () => {
    mount(true);
    expect(card('Use template').getAttribute('aria-checked')).toBe('true');
    expect(card('Use template').getAttribute('aria-disabled')).toBeNull();
    expect(card('Custom message').getAttribute('aria-disabled')).toBe('true');
    expect(card('Flow builder').getAttribute('aria-disabled')).toBe('true');
    expect(document.body.textContent).toContain('You came from a template');
  });

  it('a click on a disabled type changes nothing', () => {
    const patch = mount(true);
    act(() => card('Custom message').click());
    act(() => card('Flow builder').click());
    expect(patch).not.toHaveBeenCalled();
  });

  it('leaves the three types open on a campaign that did not start from a template', () => {
    mount(false);
    expect(card('Custom message').getAttribute('aria-disabled')).toBeNull();
    expect(card('Flow builder').getAttribute('aria-disabled')).toBeNull();
    expect(document.body.textContent).not.toContain('You came from a template');
  });
});
