import { describe, expect, it } from 'vitest';
import { ToastProvider } from '@crm/ui';
import type { AiCrmIndexResponse } from '@crm/contracts';
import {
  makeSession,
  renderAccount,
  type Seed,
} from '@/features/auth-registration-security/account/render-test-utils';
import { AI_CRM_KEYS } from './api/ai-crm-hooks';
import { AiCrmScreen } from './ai-crm-screen';

const index = (over: Partial<AiCrmIndexResponse> = {}): AiCrmIndexResponse => ({
  recent: [],
  waCopilotEnabled: false,
  canManageSettings: false,
  ...over,
});

const ALL = { 'aicrm.copilot.use': 'all', 'aicrm.copilot.manage': 'all' } as const;

function render(data: AiCrmIndexResponse, opts: { locale?: 'en' | 'ar' } = {}) {
  const seed: Seed = [[AI_CRM_KEYS.index(), data]];
  return renderAccount(
    <ToastProvider dismissLabel="x">
      <AiCrmScreen />
    </ToastProvider>,
    { locale: opts.locale, session: makeSession({ permissions: ALL as never }), seed },
  );
}

describe('the AI CRM Copilot screen', () => {
  for (const locale of ['en', 'ar'] as const) {
    it(`draws the chat shell and the recent-actions panel in ${locale}`, () => {
      const html = render(
        index({ recent: [{ tool: 'create_deal', summary: 'Deal "Acme" created.', createdAt: '2026-10-15T00:00:00.000Z' }] }),
        { locale },
      );
      expect(html).toContain('create_deal');
      expect(html).toContain('Acme');
    });
  }

  it('shows the empty-recent-actions state', () => {
    const html = render(index());
    expect(html).toContain('No actions yet.');
  });

  it('shows the WhatsApp staff-channel settings panel only when the caller can manage it', () => {
    const html = render(index({ canManageSettings: true }));
    expect(html).toContain('WhatsApp staff channel');
  });
});
