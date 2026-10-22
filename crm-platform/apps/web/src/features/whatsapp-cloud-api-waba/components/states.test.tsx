import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';

const q = (over: Record<string, unknown> = {}) =>
  ({
    isPending: false,
    isError: false,
    error: null,
    data: undefined,
    refetch: () => undefined,
    ...over,
  }) as never;
const state = vi.hoisted(() => ({
  mutation: () => ({ isPending: false, mutate: () => undefined }) as never,
  numbers: {} as unknown,
  readiness: {} as unknown,
  profile: {} as unknown,
}));

vi.mock('../api/hooks', () => ({
  useNumbers: () => state.numbers,
  useReadiness: () => state.readiness,
  useProfile: () => state.profile,
  useUpdateProfile: state.mutation,
  useSetPrimary: state.mutation,
  useResubscribe: state.mutation,
  useRegister: state.mutation,
  useRequestCode: state.mutation,
  useVerifyCode: state.mutation,
  useDisconnect: state.mutation,
  useRemove: state.mutation,
  useConnectManual: state.mutation,
  useVerifyToken: state.mutation,
  useConnectEmbedded: state.mutation,
}));
vi.mock('@/features/whatsapp-providers', () => ({ WorkspaceProviderNote: () => null }));
vi.mock('../groups/remove-number-warning', () => ({ RemoveNumberMessage: () => null }));
vi.mock('./use-facebook-sdk', () => ({ useFacebookSdk: () => ({ fb: null, failed: false }) }));

import { BusinessProfileCard } from './business-profile-card';
import { NumbersScreen } from './numbers-screen';
import { useErrorText } from './use-error-text';

const en = JSON.parse(
  readFileSync(join(process.cwd(), 'messages', 'en', 'whatsapp-cloud-api-waba.json'), 'utf8'),
) as Record<string, unknown>;
const html = (el: ReactElement) =>
  renderToStaticMarkup(
    <NextIntlClientProvider
      locale="en"
      messages={en}
      timeZone="UTC"
      onError={(e) => {
        throw e;
      }}
    >
      <QueryClientProvider client={new QueryClient()}>{el}</QueryClientProvider>
    </NextIntlClientProvider>,
  );

function Probe({ error }: { error: unknown }) {
  const text = useErrorText();
  return <p>{text(error).text}</p>;
}

describe('WABA numbers states', () => {
  beforeEach(() => {
    state.numbers = q({ data: { items: [] } });
    state.readiness = q({ data: { embeddedSignupReady: false, missing: [] } });
    state.profile = q();
  });

  it('shows an error state with a retry when the numbers fail to load', () => {
    state.numbers = q({ isError: true, error: new Error('boom') });
    const out = html(<NumbersScreen />);
    expect(out).toContain('Could not load your WhatsApp numbers.');
    expect(out).toContain('Try again');
    expect(out).not.toContain('Connect your first WABA number');
    expect(out).not.toContain('boom');
  });

  it('shows the empty state with the primary action when there are no numbers yet', () => {
    const out = html(<NumbersScreen />);
    expect(out).toContain('Connect your first WABA number');
    expect(out).toContain('Add WABA account');
    expect(out).not.toContain('Could not load your WhatsApp numbers.');
  });

  it('shows a spinner while loading, not the empty state', () => {
    state.numbers = q({ isPending: true });
    const out = html(<NumbersScreen />);
    expect(out).toContain('Loading WhatsApp numbers');
    expect(out).not.toContain('Connect your first WABA number');
  });

  it('shows the profile load state while loading and a message when it fails to load', () => {
    state.profile = q({ isPending: true });
    expect(html(<BusinessProfileCard id="n1" />)).toContain('Loading the profile');
    state.profile = q({ isError: true, error: new Error('boom') });
    const out = html(<BusinessProfileCard id="n1" />);
    expect(out).toContain('Something went wrong. Try again.');
    expect(out).not.toContain('boom');
  });

  // Connect, register and profile saves fire from a click, which string rendering cannot press;
  // this covers the text those failures show, shared by every modal and card.
  it('shows the translated message when the connect save fails with a known code', () => {
    const e = new ApiError(409, 'WABA_NUMBER_IN_USE', 'raw server words');
    const out = html(<Probe error={e} />);
    expect(out).toContain(
      (en['whatsapp-cloud-api-waba'] as { errors: Record<string, string> }).errors
        .WABA_NUMBER_IN_USE,
    );
    expect(out).not.toContain('raw server words');
  });

  it('shows the server reason, or the generic one, when the update fails with an unknown error', () => {
    expect(html(<Probe error={new ApiError(400, 'META_REJECTED', 'Meta says no')} />)).toContain(
      'Meta says no',
    );
    expect(html(<Probe error={new Error('network')} />)).toContain('Something went wrong.');
  });
});
