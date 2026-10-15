import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CallRecordingLifecycle, CallRecordingSettings } from '@crm/contracts';
import { ToastProvider } from '@crm/ui';
import { loadMessages } from '@/i18n/messages';
import { LOCALES } from '@/i18n/locales';

const state = vi.hoisted(() => ({
  perms: new Set<string>(),
  rules: {} as Record<string, unknown>,
}));

vi.mock('@/features/auth-registration-security/shared/session-context', () => ({
  useCan: (p: string) => state.perms.has(p),
}));
vi.mock('../api/recording', () => ({
  useRecordingSettings: () => state.rules,
  useSaveRecordingSettings: () => ({ mutate: () => undefined, isPending: false }),
  useDeleteRecording: () => ({ mutate: () => undefined, isPending: false }),
  useSetRecordingHold: () => ({ mutate: () => undefined, isPending: false }),
}));

import { RecordingLifecycleCard } from './recording-lifecycle-card';
import { RecordingSettingsPanel } from './recording-settings-panel';

const html = (el: ReactElement, locale = 'en') =>
  renderToStaticMarkup(
    <NextIntlClientProvider
      locale={locale}
      messages={loadMessages(locale)}
      timeZone="UTC"
      onError={(e) => {
        throw e;
      }}
    >
      <QueryClientProvider client={new QueryClient()}>
        <ToastProvider dismissLabel="Dismiss">{el}</ToastProvider>
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );

const RULES_OFF: CallRecordingSettings = {
  enabled: false,
  consentMode: 'confirmed',
  retentionDays: 90,
  noticeText: null,
  noticeVersion: 0,
  rowVersion: null,
  updatedAt: null,
};
const RULES_ON: CallRecordingSettings = {
  enabled: true,
  consentMode: 'announcement',
  retentionDays: 30,
  noticeText: 'This call may be recorded for quality.',
  noticeVersion: 3,
  rowVersion: 4,
  updatedAt: '2026-10-13T09:00:00.000Z',
};
const ok = (data: unknown) => ({ isPending: false, isError: false, isSuccess: true, data });

const LIFE: CallRecordingLifecycle = {
  storedAt: '2026-10-13T09:02:00.000Z',
  expiresAt: '2027-01-11T09:02:00.000Z',
  legalHold: false,
  holdReason: null,
  deletedAt: null,
  deletedReason: null,
  consent: {
    status: 'granted',
    method: 'spoken_yes',
    at: '2026-10-13T09:01:30.000Z',
    noticeVersion: 3,
    noticeSha256: 'ab'.repeat(32),
  },
};

beforeEach(() => {
  state.perms = new Set();
  state.rules = ok(RULES_OFF);
});

describe('the recording rules panel', () => {
  it('shows recording as off by default and read-only without the manage right', () => {
    const out = html(<RecordingSettingsPanel />);
    expect(out).toContain('Call recording');
    expect(out).toContain('Off: no call is recorded.');
    expect(out).toContain('data-testid="recording-view-only"');
    expect(out).not.toContain('Save rules');
  });

  it('offers the form and the suggested notice to a person who can manage', () => {
    state.perms = new Set(['call.recordings.manage']);
    const out = html(<RecordingSettingsPanel />);
    expect(out).not.toContain('recording-view-only');
    expect(out).toContain('Save rules');
    expect(out).toContain('Use suggested text');
    expect(out).toContain('No notice saved yet');
  });

  it('shows the saved version and mode', () => {
    state.perms = new Set(['call.recordings.manage']);
    state.rules = ok(RULES_ON);
    const out = html(<RecordingSettingsPanel />);
    expect(out).toContain('Notice version 3');
    expect(out).toContain('This call may be recorded for quality.');
    expect(out).toContain('On: teammates can record a call after the person agrees.');
  });

  it('says so while loading and when the rules cannot be loaded', () => {
    state.rules = { isPending: true, isError: false, isSuccess: false };
    expect(html(<RecordingSettingsPanel />)).toContain('Loading the recording rules');
    state.rules = {
      isPending: false,
      isError: true,
      isSuccess: false,
      error: new Error('x'),
      refetch: () => undefined,
    };
    expect(html(<RecordingSettingsPanel />)).toContain('could not be loaded');
  });
});

describe('the recording lifecycle card', () => {
  it('prints the consent evidence, the day it is deleted, and no buttons without rights', () => {
    const out = html(<RecordingLifecycleCard callId="c1" hasRecording lifecycle={LIFE} />);
    expect(out).toContain('Agreed to be recorded');
    expect(out).toContain('Said yes');
    expect(out).toContain('Notice version 3');
    expect(out).toContain('abababababab');
    expect(out).toContain('Deleted automatically on');
    expect(out).not.toMatch(/<button[^>]*>Delete recording/);
    expect(out).not.toMatch(/<button[^>]*>Place legal hold/);
  });

  it('offers delete and hold by right, and a hold blocks the delete button', () => {
    state.perms = new Set(['call.recordings.manage', 'privacy.requests.manage']);
    let out = html(<RecordingLifecycleCard callId="c1" hasRecording lifecycle={LIFE} />);
    expect(out).toMatch(/<button[^>]*>Delete recording/);
    expect(out).toMatch(/<button[^>]*>Place legal hold/);
    out = html(
      <RecordingLifecycleCard
        callId="c1"
        hasRecording
        lifecycle={{ ...LIFE, legalHold: true, holdReason: 'Dispute 4411' }}
      />,
    );
    expect(out).toContain('Lift legal hold');
    expect(out).toContain('Dispute 4411');
    expect(out).toContain('Not deleted: legal hold');
    expect(out).toMatch(/<button[^>]*disabled[^>]*>Delete recording/);
  });

  it('says when and why a recording was removed, and shows a declined answer', () => {
    const out = html(
      <RecordingLifecycleCard
        callId="c1"
        hasRecording={false}
        lifecycle={{
          ...LIFE,
          expiresAt: null,
          deletedAt: '2027-01-11T03:23:00.000Z',
          deletedReason: 'retention',
          consent: { ...LIFE.consent, status: 'declined' },
        }}
      />,
    );
    expect(out).toContain('Recording deleted');
    expect(out).toContain('retention period ended');
    expect(out).toContain('Declined to be recorded');
  });
});

describe.each(LOCALES)('every language (%s)', (locale) => {
  it('draws both panels with no missing message', () => {
    state.perms = new Set(['call.recordings.manage', 'privacy.requests.manage']);
    state.rules = ok(RULES_ON);
    expect(() => html(<RecordingSettingsPanel />, locale)).not.toThrow();
    expect(() =>
      html(<RecordingLifecycleCard callId="c1" hasRecording lifecycle={LIFE} />, locale),
    ).not.toThrow();
  });
});
