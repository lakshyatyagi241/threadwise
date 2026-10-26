// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { ToastProvider } from '@crm/ui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../../../../messages/en/whatsapp-cloud-api-waba.json';
import { BusinessProfileCard } from './business-profile-card';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const hooks = vi.hoisted(() => ({
  update: vi.fn(),
  profile: {
    about: 'Testing GETA',
    description: null,
    address: null,
    email: null,
    websites: [],
    vertical: null,
    profilePictureUrl: null,
  },
}));

vi.mock('../api/hooks', () => ({
  useProfile: () => ({ isPending: false, isError: false, data: hooks.profile }),
  useUpdateProfile: () => ({ isPending: false, mutateAsync: hooks.update }),
  useUploadLogo: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));

let root: Root;
let host: HTMLElement;
beforeEach(() => {
  hooks.update.mockReset();
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
        <ToastProvider dismissLabel="Dismiss">
          <BusinessProfileCard id="11111111-1111-4111-8111-111111111111" />
        </ToastProvider>
      </NextIntlClientProvider>,
    );
  });
}

function saveButton() {
  const button = [...host.querySelectorAll('button')].find(
    (b) => b.textContent === 'Update profile',
  );
  if (!button) throw new Error('Update profile button not found');
  return button;
}

describe('BusinessProfileCard save feedback', () => {
  it('shows Changes saved as a toast in the corner, after a successful save', async () => {
    hooks.update.mockResolvedValue(undefined);
    mount();

    await act(async () => saveButton().click());

    expect(hooks.update).toHaveBeenCalledOnce();
    expect(host.querySelector('[role="status"]')?.textContent).toContain('Changes saved.');
    expect(host.querySelector('form [role="status"]')).toBeNull();
  });

  it('shows the failure as a toast when the save fails', async () => {
    hooks.update.mockRejectedValue(new Error('network'));
    mount();

    await act(async () => saveButton().click());

    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Something went wrong.');
    expect(host.querySelector('[role="status"]')).toBeNull();
  });
});
