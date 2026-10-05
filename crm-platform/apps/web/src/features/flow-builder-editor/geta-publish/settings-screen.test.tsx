import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ToastProvider } from '@crm/ui';
import type { GetaPublishSettings } from '@crm/contracts';
import { SettingsForm } from './settings-screen';

const messages = JSON.parse(
  readFileSync(join(process.cwd(), 'messages', 'en', 'flow-builder-editor.geta.json'), 'utf8'),
) as Record<string, unknown>;

const html = (el: ReactElement) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={messages}>
      <QueryClientProvider client={new QueryClient()}>
        <ToastProvider>{el}</ToastProvider>
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );

const settings = (over: Partial<GetaPublishSettings> = {}): GetaPublishSettings => ({
  mode: 'live',
  baseUrl: null,
  origin: null,
  authorizationSet: false,
  getaHostSet: false,
  chatbot: null,
  configured: false,
  updatedAt: null,
  ...over,
});
const FILLED = settings({
  baseUrl: 'https://api.example.test',
  origin: 'https://console.example.test',
  authorizationSet: true,
  getaHostSet: true,
  chatbot: { id: 'fakeBot1', name: 'Fake bot', botId: '00000000-0000-4000-8000-000000000001' },
  configured: true,
  updatedAt: '2026-10-05T00:00:00.000Z',
});

describe('Geta publishing settings form', () => {
  it('empty: every field is there, secrets are Not set, nothing to clear, no summary', () => {
    const out = html(<SettingsForm data={settings()} canManage />);
    for (const label of [
      'Base URL',
      'Console origin (optional)',
      'Authorization token',
      'geta-host token',
      'Geta chatbot record',
      'Paste the chatbot record (JSON)',
    ])
      expect(out, label).toContain(label);
    expect(out).toContain('placeholder="https://api-core-sandbox.geta.ai"');
    expect(out).toContain('Not complete');
    expect((out.match(/Not set/g) ?? []).length).toBe(3);
    expect(out).not.toContain('data-testid="geta-chatbot-summary"');
    expect(out).toMatch(/<button[^>]*disabled[^>]*>Clear all/);
    expect(out).toContain('>Save<');
  });

  it('filled: masked display only (flags and a summary), the secret boxes are empty', () => {
    const out = html(<SettingsForm data={FILLED} canManage />);
    expect(out).toContain('Ready');
    expect(out).toContain('value="https://api.example.test"');
    expect(out).toContain('placeholder="Saved (hidden)"');
    expect((out.match(/Saved \(hidden\)/g) ?? []).length).toBe(2);
    expect(out).toContain('Saved. Leave the box empty to keep it');
    expect(out).toContain('data-testid="geta-chatbot-summary"');
    expect(out).toContain('fakeBot1');
    expect(out).toContain('Fake bot');
    expect(out).toContain('00000000-0000-4000-8000-000000000001');
    expect(out).toContain('Replace the chatbot record (JSON)');
    expect(out).toContain('Remove the saved record');
    // the password boxes never carry a value
    expect(out).not.toMatch(/type="password"[^>]*value="[^"]+"/);
    expect(out).not.toMatch(/value="[^"]*"[^>]*type="password"/);
  });

  it('fixture mode says nothing is sent to Geta; live mode does not', () => {
    expect(html(<SettingsForm data={settings({ mode: 'fixture' })} canManage />)).toContain(
      'fixture mode',
    );
    expect(html(<SettingsForm data={settings()} canManage />)).not.toContain('fixture mode');
  });

  it('without the manage right the fields are read-only and there is no Save or Clear', () => {
    const out = html(<SettingsForm data={FILLED} canManage={false} />);
    expect(out).not.toContain('>Save<');
    expect(out).not.toContain('Clear all');
    expect(out).not.toContain('Remove the saved record');
    expect((out.match(/disabled/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it('the confirm dialog for Clear all is rendered closed until asked for', () => {
    const out = html(<SettingsForm data={FILLED} canManage />);
    expect(out).toContain('<dialog');
    expect(out).not.toMatch(/<dialog[^>]* open/);
  });
});
