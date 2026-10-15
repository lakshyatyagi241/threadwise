// @vitest-environment jsdom
import type { PrivacyErasureReport, PrivacyRequest } from '@crm/contracts';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { button, click, makeRequest, mount, text, type, type Mounted } from '../testing';

const state = vi.hoisted(() => ({
  perms: new Set<string>(),
  detail: {} as Record<string, unknown>,
  erase: vi.fn(),
  verify: vi.fn(),
  download: vi.fn(),
}));
vi.mock('@/features/auth-registration-security/shared/session-context', () => ({
  useCan: (p: string) => state.perms.has(p),
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('../api/hooks', () => ({
  KEYS: { all: ['privacy-requests'] },
  usePrivacyRequest: () => state.detail,
}));
vi.mock('../api/service', () => ({
  privacyApi: {
    erase: (id: string, i: unknown) => state.erase(id, i),
    verify: (id: string, i: unknown) => state.verify(id, i),
  },
  privacyExportFileUrl: (r: string, e: string) =>
    `/api/v2/privacy/requests/${r}/exports/${e}/download`,
}));
vi.mock('../lib/model', async (orig) => ({
  ...(await orig<typeof import('../lib/model')>()),
  downloadText: (...a: unknown[]) => state.download(...a),
}));

import { RequestDetailScreen } from './request-detail-screen';

const report: PrivacyErasureReport = {
  dryRun: true,
  lines: [
    { holder: 'contacts', table: 'contacts', disposition: 'deleted', count: 1, reason: null },
    { holder: 'inbox', table: 'messages', disposition: 'deleted', count: 42, reason: null },
    {
      holder: 'billing',
      table: 'invoices',
      disposition: 'retained',
      count: 3,
      reason: 'Statutory retention',
    },
  ],
  files: 5,
  totals: { deleted: 43, anonymised: 0, retained: 3 },
  historyMode: 'delete',
  at: '2026-10-10T10:00:00.000Z',
};

const detail = (request: PrivacyRequest, exportsList: unknown[] = []) => ({
  isError: false,
  error: null,
  refetch: vi.fn(),
  data: { request, events: [], exports: exportsList },
});

let m: Mounted | null = null;
beforeEach(() => {
  state.perms = new Set([
    'privacy.requests.read',
    'privacy.requests.manage',
    'privacy.erase.execute',
  ]);
  state.erase.mockReset().mockResolvedValue(report);
  state.verify.mockReset().mockResolvedValue(makeRequest());
  state.download.mockReset();
  state.detail = detail(makeRequest());
});
afterEach(async () => {
  await m?.unmount();
  m = null;
});

describe.each(['en', 'ar'])('data request detail (%s)', (locale) => {
  it('erases only after a preview and the exact typed phrase', async () => {
    m = await mount(<RequestDetailScreen id="11111111-1111-4111-8111-111111111111" />, { locale });
    const h = m.host;
    expect(h.textContent).toContain('DSR-3F9A12BC');
    // No confirmation field and no execute button before the preview.
    expect(h.querySelector('#privacy-erase-confirm')).toBeNull();

    await click(button(h, text('detail.erase.preview', locale)));
    await act(async () => undefined);
    expect(state.erase).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111', {
      dryRun: true,
    });
    // Counts per module and table, with the files.
    expect(h.textContent).toContain('messages');
    expect(h.textContent).toContain('42');
    expect(h.textContent).toContain('Statutory retention');

    const execute = button(h, text('detail.erase.execute', locale));
    const input = h.querySelector<HTMLInputElement>('#privacy-erase-confirm')!;
    expect(execute.disabled).toBe(true);
    await type(input, 'ERASE');
    expect(execute.disabled).toBe(true);
    await type(input, 'erase DSR-3F9A12BC');
    expect(execute.disabled).toBe(true);
    await type(input, 'ERASE DSR-3F9A12BC');
    expect(execute.disabled).toBe(false);

    await click(execute);
    await act(async () => undefined);
    expect(state.erase).toHaveBeenLastCalledWith('11111111-1111-4111-8111-111111111111', {
      dryRun: false,
      confirmation: 'ERASE DSR-3F9A12BC',
    });
  });

  it('shows the proof after an erasure and downloads it as a JSON file', async () => {
    state.detail = detail(
      makeRequest({
        status: 'completed',
        daysLeft: null,
        proof: {
          requestReference: 'DSR-3F9A12BC',
          requestType: 'erasure',
          executedAt: '2026-10-11T10:00:00.000Z',
          executedBy: 'Priya',
          historyMode: 'delete',
          lines: report.lines,
          files: 5,
          registryDigest: 'digest-abc',
          notes: ['Backups are not reached'],
          sha256: 'sha-xyz',
        },
        allowed: { verify: false, export: false, erase: false, hold: false, reject: false },
      }),
    );
    m = await mount(<RequestDetailScreen id="11111111-1111-4111-8111-111111111111" />, { locale });
    const h = m.host;
    expect(h.textContent).toContain('digest-abc');
    expect(h.textContent).toContain('sha-xyz');
    expect(h.textContent).toContain('Backups are not reached');
    expect(h.querySelector('#privacy-erase-confirm')).toBeNull();
    await click(button(h, text('detail.proof.download', locale)));
    expect(state.download).toHaveBeenCalledOnce();
    const [name, json] = state.download.mock.calls[0] as [string, string];
    expect(name).toBe('DSR-3F9A12BC-erasure-proof.json');
    expect(JSON.parse(json)).toMatchObject({ sha256: 'sha-xyz', registryDigest: 'digest-abc' });
  });

  it('hides the erase section from people without the erase permission', async () => {
    state.perms = new Set(['privacy.requests.read', 'privacy.requests.manage']);
    m = await mount(<RequestDetailScreen id="11111111-1111-4111-8111-111111111111" />, { locale });
    expect(
      [...m.host.querySelectorAll('button')].some(
        (b) => b.textContent === text('detail.erase.preview', locale),
      ),
    ).toBe(false);
  });

  it('records a verification with an evidence reference id only', async () => {
    state.detail = detail(makeRequest({ verifiedAt: null, verificationEvidenceRef: null }));
    m = await mount(<RequestDetailScreen id="11111111-1111-4111-8111-111111111111" />, { locale });
    const h = m.host;
    expect(h.textContent).toContain(text('detail.verify.evidenceHint', locale));
    await type(h.querySelector<HTMLInputElement>('#pr-verify-evidence')!, 'TCK-9');
    await click(button(h, text('detail.verify.submit', locale)));
    await act(async () => undefined);
    expect(state.verify).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      expect.objectContaining({ outcome: 'verified', evidenceRef: 'TCK-9' }),
    );
  });

  it('offers the export download and the expiry and no-email notes', async () => {
    state.detail = detail(makeRequest({ requestType: 'export' }), [
      {
        id: '55555555-5555-4555-8555-555555555555',
        status: 'ready',
        fileBytes: 4096,
        sections: {},
        error: null,
        requestedAt: '2026-10-10T10:00:00.000Z',
        completedAt: '2026-10-10T10:01:00.000Z',
        expiresAt: '2026-10-17T10:01:00.000Z',
      },
    ]);
    m = await mount(<RequestDetailScreen id="11111111-1111-4111-8111-111111111111" />, { locale });
    const link = m.host.querySelector<HTMLAnchorElement>('a[download]')!;
    expect(link.getAttribute('href')).toBe(
      '/api/v2/privacy/requests/11111111-1111-4111-8111-111111111111/exports/55555555-5555-4555-8555-555555555555/download',
    );
    expect(m.host.textContent).toContain(text('detail.export.noEmail', locale));
  });
});
