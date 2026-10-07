import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { NodeBridgeResponse } from '@crm/contracts';
import { renderWithMessages } from '@/features/auth-registration-security/platform/render-test-utils';
import { NodeBridgePage } from './node-bridge-page';
import { NODE_BRIDGE_QUERY_KEY } from './queries';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: () => undefined, refresh: () => undefined }),
  usePathname: () => '/admin/node-bridge',
  useSearchParams: () => new URLSearchParams(),
}));

const data = (unofficialEnabled: boolean): NodeBridgeResponse =>
  ({
    serverUrl: 'http://localhost:8888',
    tokenSet: true,
    rowVersion: 3,
    pacing: {
      msgGap: 3,
      batchesGap: 20,
      bwMsgGap: 5,
      enableBatches: false,
    },
    pacingRowVersion: 2,
    unofficialEnabled,
    unofficialWorkspaceCount: 0,
  }) as unknown as NodeBridgeResponse;

const page = (unofficialEnabled: boolean, locale: 'en' | 'ar', role?: 'super_admin' | 'admin') =>
  renderWithMessages(createElement(NodeBridgePage), {
    locale,
    ...(role ? { role: role as never } : {}),
    seed: [[NODE_BRIDGE_QUERY_KEY, data(unofficialEnabled)]],
  });

/** The label on the switch button (the dialogs carry the same words in their titles, so match the button itself). */
const toggle = (html: string) => /data-testid="unofficial-toggle"[^>]*>([^<]*)</.exec(html)?.[1];

const WORDS = {
  en: {
    off: 'Disabled / Not supported',
    on: 'Enabled (unsupported)',
    title: 'Unofficial WhatsApp (personal numbers via QR)',
    explanation: 'We support the official WhatsApp Business API only.',
    enable: 'Enable unofficial WhatsApp',
    disable: 'Disable unofficial WhatsApp',
  },
  ar: {
    off: 'معطّل / غير مدعوم',
    on: 'مفعّل (غير مدعوم)',
    title: 'واتساب غير الرسمي (أرقام شخصية عبر رمز QR)',
    explanation: 'ندعم واجهة واتساب للأعمال الرسمية فقط.',
    enable: 'تفعيل واتساب غير الرسمي',
    disable: 'تعطيل واتساب غير الرسمي',
  },
} as const;

describe.each(['en', 'ar'] as const)(
  'Node bridge page: unofficial WhatsApp switch (%s)',
  (locale) => {
    const w = WORDS[locale];

    it('off: a prominent status card first, the explanation, and the control to enable it', () => {
      const html = page(false, locale);
      expect(html).toContain('data-testid="unofficial-card"');
      expect(html).toContain('data-state="disabled"');
      expect(html).toContain(w.title);
      expect(html).toContain(w.off);
      expect(html).toContain(w.explanation);
      expect(toggle(html)).toBe(w.enable);
      // the status card comes before the bridge settings
      expect(html.indexOf('unofficial-card')).toBeLessThan(html.indexOf('node-bridge-settings'));
    });

    it('off: the bridge address, token and pacing are still shown, but dimmed, with a note', () => {
      const html = page(false, locale);
      expect(html).toContain('data-testid="node-bridge-settings"');
      expect(html).toContain('data-dimmed="true"');
      expect(html).toContain('opacity-50');
      expect(html).toContain('data-testid="unofficial-off-note"');
      expect(html).toContain('http://localhost:8888');
    });

    it('on: shown as enabled but unsupported, nothing dimmed, the control disables it', () => {
      const html = page(true, locale);
      expect(html).toContain('data-state="enabled"');
      expect(html).toContain(w.on);
      expect(toggle(html)).toBe(w.disable);
      expect(html).not.toContain('data-dimmed');
      expect(html).not.toContain('unofficial-off-note');
    });

    it('shows no switch control to an operator who is not a super admin', () => {
      const html = page(false, locale, 'admin');
      expect(html).toContain(w.off);
      expect(toggle(html)).toBeUndefined();
    });
  },
);
