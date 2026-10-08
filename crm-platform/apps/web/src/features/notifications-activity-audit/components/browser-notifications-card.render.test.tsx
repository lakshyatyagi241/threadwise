import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PushUiState } from '../push/support';
import type { BrowserPush } from '../push/use-browser-push';
import { BrowserNotificationsView } from './browser-notifications-card';

type Locale = 'en' | 'ar';
const load = (locale: Locale) =>
  (
    JSON.parse(
      readFileSync(
        join(process.cwd(), 'messages', locale, 'notifications-activity-audit.json'),
        'utf8',
      ),
    ) as { notifications: Record<string, unknown> }
  ).notifications;
const html = (el: ReactElement, locale: Locale = 'en') =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={{ notifications: load(locale) } as never}>
      {el}
    </NextIntlClientProvider>,
  );

const noop = async () => undefined;
const push = (state: PushUiState, over: Partial<BrowserPush> = {}): BrowserPush => ({
  state,
  devices: undefined,
  devicesFailed: false,
  thisDeviceId: null,
  busy: null,
  problem: null,
  testResult: null,
  enable: noop,
  disable: noop,
  remove: noop,
  sendTest: noop,
  dismissProblem: () => undefined,
  ...over,
});
const view = (state: PushUiState, over: Partial<BrowserPush> = {}, locale: Locale = 'en') =>
  html(<BrowserNotificationsView push={push(state, over)} />, locale);

const DEVICES = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    label: 'Chrome on Windows',
    createdAt: '2026-10-01T10:00:00.000Z',
    lastUsedAt: '2026-10-05T09:30:00.000Z',
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    label: 'Safari on iOS',
    createdAt: '2026-10-02T10:00:00.000Z',
    lastUsedAt: null,
  },
];

describe('the Browser notifications card (en)', () => {
  it('draws nothing when the deployment has no push keys', () => {
    expect(view('unconfigured')).toBe('');
  });

  it('says it is checking, without offering a button yet', () => {
    const out = view('checking');
    expect(out).toContain('Checking this browser');
    expect(out).not.toContain('Enable on this device');
  });

  it('explains an unsupported browser and offers nothing to press', () => {
    const out = view('unsupported');
    expect(out).toContain('This browser cannot show notifications while the CRM is closed.');
    expect(out).toContain('Not available');
    expect(out).not.toContain('<button');
  });

  it('is honest about iPhone and iPad needing the app on the Home Screen', () => {
    const out = view('needs_install');
    expect(out).toContain('only work for an app added to your Home Screen');
    expect(out).toContain('Add to Home Screen');
    expect(out).toContain('16.4');
    expect(out).not.toContain('Enable on this device');
  });

  it('explains a blocked site and where to undo it, with no Enable button', () => {
    const out = view('blocked');
    expect(out).toContain('Notifications are blocked for this site in your browser.');
    expect(out).toContain('site settings');
    expect(out).toContain('Blocked');
    expect(out).not.toContain('Enable on this device');
  });

  it('offers Enable when off, and states that the browser asks only when it is pressed', () => {
    const out = view('off');
    expect(out).toContain('Your browser will ask for permission when you press Enable.');
    expect(out).toMatch(/<button[^>]*>Enable on this device<\/button>/);
    expect(out).not.toContain('Send a test notification');
  });

  it('disables the button while enabling', () => {
    expect(view('off', { busy: 'enable' })).toMatch(
      /<button[^>]*disabled=""[^>]*>Enabling\.\.\.<\/button>/,
    );
  });

  it('offers the test and turning off when on, and says nothing shows while the CRM is in front', () => {
    const out = view('on');
    expect(out).toContain('On for this device');
    expect(out).toContain('Send a test notification');
    expect(out).toContain('Turn off on this device');
    expect(out).toContain('never the message text');
  });

  it('lists the devices without any secret, marks this one, and can remove each', () => {
    const out = view('on', { devices: DEVICES, thisDeviceId: DEVICES[0]!.id });
    expect(out).toContain('Your devices');
    expect(out).toContain('Chrome on Windows');
    expect(out).toContain('Safari on iOS');
    expect(out).toContain('This device');
    expect(out).toContain('not notified yet');
    expect(out).toContain('aria-label="Remove Chrome on Windows"');
    expect(out).toContain('aria-label="Remove Safari on iOS"');
    expect(out).not.toContain('endpoint');
  });

  it('words each outcome of the test and each problem', () => {
    expect(view('on', { testResult: 'sent' })).toContain('Sent. It should appear');
    expect(view('on', { testResult: 'none_reachable' })).toContain('could not be reached');
    expect(view('on', { testResult: 'no_device' })).toContain('no device to send to');
    expect(view('on', { testResult: 'wait' })).toContain('Wait a few seconds');
    for (const [problem, text] of [
      ['enable_failed', 'Could not enable notifications'],
      ['disable_failed', 'Could not turn off notifications'],
      ['remove_failed', 'Could not remove that device'],
      ['test_failed', 'Could not send the test'],
    ] as const) {
      const out = view('on', { problem });
      expect(out).toMatch(new RegExp(`role="alert"[^>]*>.*${text}`));
    }
  });

  it('still shows the devices when blocked, so a stale one can be removed, and says when they fail to load', () => {
    expect(view('blocked', { devices: DEVICES })).toContain('Chrome on Windows');
    expect(view('on', { devicesFailed: true })).toContain('Could not load your devices.');
  });

  it('does not leak a message key', () => {
    for (const state of [
      'checking',
      'unsupported',
      'needs_install',
      'blocked',
      'off',
      'on',
    ] as const) {
      expect(
        view(state, { devices: DEVICES, testResult: 'sent', problem: 'enable_failed' }),
      ).not.toContain('notifications.prefs');
    }
  });
});

describe('the Browser notifications card (ar)', () => {
  it('is worded in Arabic in every state, with logical alignment', () => {
    const states = ['checking', 'unsupported', 'needs_install', 'blocked', 'off', 'on'] as const;
    for (const state of states) {
      const out = view(state, { devices: DEVICES, testResult: 'sent' }, 'ar');
      expect(out, state).toContain('إشعارات المتصفح');
      expect(out, state).not.toContain('Browser notifications');
      expect(out, state).not.toContain('notifications.prefs');
      expect(out, state).not.toMatch(
        /class="[^"]*\b(?:ml|mr|pl|pr|left|right|text-left|text-right)-/,
      );
    }
    expect(view('off', {}, 'ar')).toContain('تفعيل على هذا الجهاز');
    expect(view('needs_install', {}, 'ar')).toContain('الشاشة الرئيسية');
  });
});
