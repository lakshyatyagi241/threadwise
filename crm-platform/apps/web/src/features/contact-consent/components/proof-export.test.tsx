// @vitest-environment jsdom
import {
  CONSENT_EXPORT_SYNC_MAX,
  type ConsentExport,
  type ConsentExportList,
} from '@crm/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { button, click, mount, text, type Mounted } from '../testing';

const state = vi.hoisted(() => ({
  can: true,
  list: undefined as unknown,
  request: vi.fn(),
}));
vi.mock('@/features/auth-registration-security/shared/session-context', () => ({
  useCan: () => state.can,
}));
vi.mock('../api/hooks', () => ({
  KEYS: { exports: ['contact-consent', 'exports'] },
  useConsentExports: () => ({ data: state.list }),
}));
vi.mock('../api/service', () => ({
  consentApi: { requestExport: () => state.request() },
  consentExportUrl: () => '/api/v2/contact-consent/export',
  consentExportFileUrl: (id: string) => `/api/v2/contact-consent/exports/${id}/download`,
}));

import { ProofExportButton, ProofExports } from './proof-export';

const exp = (over: Partial<ConsentExport>): ConsentExport => ({
  id: '11111111-1111-4111-8111-111111111111',
  status: 'ready',
  rowCount: 60_001,
  fileBytes: 1000,
  error: null,
  requestedAt: '2026-10-13T08:00:00.000Z',
  completedAt: '2026-10-13T08:01:00.000Z',
  expiresAt: '2026-10-20T08:01:00.000Z',
  emailedTo: 'a@example.com',
  ...over,
});
const list = (over: Partial<ConsentExportList>): ConsentExportList => ({
  data: [],
  ledgerRows: 10,
  needsAsync: false,
  ...over,
});

let m: Mounted | undefined;
beforeEach(() => {
  state.can = true;
  state.list = list({});
  state.request = vi.fn().mockResolvedValue(exp({ status: 'queued' }));
});
afterEach(async () => {
  await m?.unmount();
  m = undefined;
});

describe('Export proof', () => {
  it('is a direct download while the ledger fits', async () => {
    m = await mount(<ProofExportButton />);
    const a = m.host.querySelector('a');
    expect(a?.getAttribute('href')).toBe('/api/v2/contact-consent/export');
    expect(a?.textContent).toBe(text('settings.exportProof'));
    expect(m.host.querySelector('button')).toBeNull();
  });

  it('becomes "prepare the full file" past the direct limit, and asks the server once', async () => {
    state.list = list({ needsAsync: true, ledgerRows: CONSENT_EXPORT_SYNC_MAX + 1 });
    m = await mount(<ProofExportButton />);
    expect(m.host.querySelector('a')).toBeNull();
    await click(button(m.host, text('proof.prepare')));
    expect(state.request).toHaveBeenCalledTimes(1);
  });

  it('is disabled and says so while a file is being built', async () => {
    state.list = list({ needsAsync: true, data: [exp({ status: 'running', rowCount: null })] });
    m = await mount(<ProofExportButton />);
    const b = button(m.host, text('proof.preparing'));
    expect(b.disabled).toBe(true);
  });

  it('shows nothing to a person without the right', async () => {
    state.can = false;
    m = await mount(<ProofExportButton />);
    expect(m.host.querySelector('a, button')).toBeNull();
  });
});

describe('Prepared proof files', () => {
  it('lists a ready file with its size, expiry and a download link', async () => {
    state.list = list({ needsAsync: true, data: [exp({})] });
    m = await mount(<ProofExports />);
    const link = m.host.querySelector('a');
    expect(link?.getAttribute('href')).toBe(
      '/api/v2/contact-consent/exports/11111111-1111-4111-8111-111111111111/download',
    );
    expect(m.host.textContent).toContain(text('proof.status.ready'));
    expect(m.host.textContent).toContain('60,001');
  });

  it('shows a failed file with a plain sentence, no download', async () => {
    state.list = list({ data: [exp({ status: 'failed', error: 'boom' })] });
    m = await mount(<ProofExports />);
    expect(m.host.textContent).toContain(text('proof.failed'));
    expect(m.host.textContent).not.toContain('boom');
    expect(m.host.querySelector('a')).toBeNull();
  });

  it('stays out of the way when there is nothing to show', async () => {
    m = await mount(<ProofExports />);
    expect(m.host.querySelector('section')).toBeNull();
  });

  it('reads in Arabic', async () => {
    state.list = list({ needsAsync: true, data: [exp({})] });
    m = await mount(<ProofExports />, { locale: 'ar' });
    expect(m.host.textContent).not.toContain(text('proof.title'));
  });
});
