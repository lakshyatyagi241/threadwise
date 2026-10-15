import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CALLING_CHECK_CODES,
  CALLING_META_REASONS,
  type CallingCheck,
  type CallingReadiness,
} from '@crm/contracts';
import { ToastProvider } from '@crm/ui';
import { loadMessages } from '@/i18n/messages';
import { LOCALES } from '@/i18n/locales';

const state = vi.hoisted(() => ({
  perms: new Set<string>(),
  rows: [] as unknown[],
  mutate: vi.fn(),
}));

vi.mock('@/features/auth-registration-security/shared/session-context', () => ({
  useCan: (p: string) => state.perms.has(p),
}));
vi.mock('../api/readiness', () => ({
  useCallingReadiness: () => ({ data: { rows: state.rows } }),
  useCheckReadiness: () => ({ mutate: state.mutate, isPending: false, isError: false }),
}));
// The test call mounts the calling provider (browser audio, polling): its own tests cover it.
vi.mock('./test-call-button', () => ({
  TestCallButton: () => <div data-testid="test-call-stub" />,
}));

import { ReadinessCard } from './readiness-card';

/** The codes that are a pass: they have a finding and no instruction. */
const PASSES =
  /(_ok|_added|_on)$|^(connected|cloud_api_only|limit_test_number|recording_off|recording_configured)$/;
const NUMBER = '4f0c1f6e-5b0b-4a52-9d0a-0c4a1d0a6b11';
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
      <ToastProvider dismissLabel="Dismiss">{el}</ToastProvider>
    </NextIntlClientProvider>,
  );

const row = (over: Partial<CallingReadiness> = {}): CallingReadiness => ({
  numberId: NUMBER,
  phoneNumber: '+919800000001',
  displayLabel: 'Support line',
  connectionStatus: 'connected',
  status: 'blocked',
  callingEnabled: false,
  metaCallingStatus: 'DISABLED',
  checkedAt: new Date().toISOString(),
  source: 'manual',
  checks: [
    { key: 'plan_feature', state: 'ok', code: 'plan_ok' },
    {
      key: 'messaging_limit',
      state: 'fail',
      code: 'limit_low',
      params: { tier: 'TIER_250', needed: 2000 },
    },
    { key: 'turn', state: 'warn', code: 'turn_missing' },
  ],
  ...over,
});

beforeEach(() => {
  state.perms = new Set(['call.calls.use', 'call.calling.manage']);
  state.rows = [row()];
  state.mutate.mockReset();
});

describe('the readiness card', () => {
  it('says where the number stands, what was found and what to do about what is not fine', () => {
    const out = html(<ReadinessCard numberId={NUMBER} />);
    expect(out).toContain('data-status="blocked"');
    expect(out).toContain('Not ready');
    expect(out).toContain('Plan includes WhatsApp calling');
    expect(out).toContain(
      'The messaging limit is TIER_250. WhatsApp needs at least 2000 customers a day',
    );
    expect(out).toContain('Send more messages with good quality');
    expect(out).toContain('No TURN relay is configured');
    // What is fine has no instruction.
    expect(out.match(/What to do:/g)).toHaveLength(2);
    expect(out).toContain('Check again');
  });

  it('is the same card read-only for someone who may not change calling', () => {
    state.perms = new Set(['call.calls.use']);
    const out = html(<ReadinessCard numberId={NUMBER} />);
    expect(out).toContain('Not ready');
    expect(out).not.toContain('Check again');
  });

  it('draws nothing for a number it knows nothing about', () => {
    expect(html(<ReadinessCard numberId="00000000-0000-4000-8000-000000000000" />)).not.toContain(
      'readiness-card',
    );
  });

  it('shows why WhatsApp turned a switch-on down, in words, from the reason', () => {
    const off: CallingCheck = {
      key: 'calling_enabled',
      state: 'fail',
      code: 'calling_off',
      params: { refused: 'prerequisites' },
    };
    state.rows = [row({ status: 'ready_to_enable', checks: [off] })];
    const out = html(<ReadinessCard numberId={NUMBER} />);
    expect(out).toContain('data-testid="readiness-refused"');
    expect(out).toContain('WhatsApp will not switch calling on yet');
  });

  it('offers the test call only when calling is on and nothing blocks the number', () => {
    state.rows = [row({ status: 'ready', callingEnabled: true, checks: [] })];
    expect(html(<ReadinessCard numberId={NUMBER} />)).toContain('test-call-stub');
    state.rows = [row({ status: 'blocked', callingEnabled: true })];
    expect(html(<ReadinessCard numberId={NUMBER} />)).not.toContain('test-call-stub');
    state.rows = [row({ status: 'ready_to_enable', callingEnabled: false })];
    expect(html(<ReadinessCard numberId={NUMBER} />)).not.toContain('test-call-stub');
  });

  it('has words for every state of every row, in every language, with no key left bare', () => {
    // A bare key path in the markup would mean a missing message (the provider throws on one, too).
    for (const locale of LOCALES) {
      for (const code of CALLING_CHECK_CODES) {
        const check: CallingCheck = {
          key: 'turn',
          state: PASSES.test(code) ? 'ok' : 'fail',
          code,
          params: {
            tier: 'TIER_1K',
            needed: 2000,
            missing: 'x',
            days: 2,
            people: 2,
            status: 'PENDING',
          },
        };
        state.rows = [row({ checks: [check] })];
        const out = html(<ReadinessCard numberId={NUMBER} />, locale);
        expect(out, `${locale} ${code}`).not.toContain('calling-voice.readiness');
      }
      for (const reason of CALLING_META_REASONS.filter((r) => r !== 'unknown')) {
        state.rows = [
          row({
            status: 'ready_to_enable',
            checks: [
              {
                key: 'calling_enabled',
                state: 'fail',
                code: 'calling_off',
                params: { refused: reason },
              },
            ],
          }),
        ];
        expect(
          html(<ReadinessCard numberId={NUMBER} />, locale),
          `${locale} ${reason}`,
        ).not.toContain('calling-voice.readiness');
      }
    }
  });
});
