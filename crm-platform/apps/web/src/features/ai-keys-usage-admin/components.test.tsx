import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PlatformAiKeyItem } from '@crm/contracts';
import { ToastProvider } from '@/features/auth-registration-security/platform/ui/toast';
import { KeyCard } from './platform/key-card';
import { DailyBars, ShareBars, SourceSplit, WindowSwitch } from './shared/usage-view';

const messages = JSON.parse(
  readFileSync(join(process.cwd(), 'messages', 'en', 'ai-keys-usage-admin.json'), 'utf8'),
) as Record<string, unknown>;

const html = (el: ReactElement) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <QueryClientProvider client={new QueryClient()}>
        <ToastProvider>{el}</ToastProvider>
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );

const item = (over: Partial<PlatformAiKeyItem> = {}): PlatformAiKeyItem => ({
  id: '00000000-0000-4000-8000-000000000001',
  provider: 'openai',
  name: 'OpenAI',
  group: 'llm',
  isActive: true,
  hasKey: true,
  keyUnreadable: false,
  keyLast4: 'ABCD',
  defaultModel: 'my-custom-model',
  sortOrder: 1,
  maxTokens: 4096,
  supportsMaxTokens: true,
  keyHint: 'Find at platform.openai.com/api-keys',
  textExtra: {
    key: 'organization',
    label: 'Organization ID',
    hint: 'Optional. e.g. org-xxxxxxxxxxxx',
    value: '',
  },
  extraModels: [],
  modelChoices: ['gpt-5.4-mini', 'gpt-4o'],
  rowVersion: 3,
  updatedAt: '2026-10-02T00:00:00.000Z',
  ...over,
});

describe('provider card (WD-AIADM-001, 002, 003, 005)', () => {
  it('shows the state, never the secret, and an empty key field with a keep-the-saved-key placeholder', () => {
    const out = html(<KeyCard item={item()} />);
    expect(out).toContain('OpenAI');
    expect(out).toContain('Active');
    expect(out).toContain('Key saved, ends in ABCD');
    expect(out).toContain('(saved — leave blank to keep)');
    expect(out).toMatch(/type="password"[^>]*value=""|value=""[^>]*type="password"/);
    expect(out).toContain('Disable');
  });

  it('matches the WaDesk card: provider line, key hint, Organization ID, ceiling hint', () => {
    const out = html(<KeyCard item={item()} />);
    expect(out).toContain('provider: openai · default model: my-custom-model');
    expect(out).toContain('Find at platform.openai.com/api-keys');
    expect(out).toContain('Organization ID');
    expect(out).toContain('Optional. e.g. org-xxxxxxxxxxxx');
    expect(out).toContain('e.g. 4096');
    expect(out).toContain('Leave blank for the model default.');
  });

  it('keeps a stored model outside the catalogue selectable, tagged custom', () => {
    const out = html(<KeyCard item={item()} />);
    expect(out).toContain('my-custom-model (custom)');
    expect(out).toContain('gpt-5.4-mini');
  });

  it('offers the output ceiling only on vendors that have it', () => {
    expect(html(<KeyCard item={item()} />)).toContain('Max tokens per request');
    const plain = item({
      provider: 'deepseek',
      name: 'DeepSeek',
      supportsMaxTokens: false,
      maxTokens: null,
    });
    expect(html(<KeyCard item={plain} />)).not.toContain('Max tokens per request');
  });

  it('says no key, offers Activate, and has no remove button when nothing is saved', () => {
    const out = html(<KeyCard item={item({ isActive: false, hasKey: false, keyLast4: null })} />);
    expect(out).toContain('No key');
    expect(out).toContain('Activate');
    // the closed confirm dialog always carries one "Remove key" button; the card's own trigger would be a second
    expect(out.match(/Remove key/g)).toHaveLength(1);
    expect(html(<KeyCard item={item()} />).match(/Remove key/g)).toHaveLength(2);
  });

  it('tells the admin to paste a key again when the saved one cannot be read', () => {
    const out = html(
      <KeyCard item={item({ hasKey: false, keyUnreadable: true, keyLast4: null })} />,
    );
    expect(out).toContain('Saved key cannot be read, paste it again');
  });
});

describe('usage charts', () => {
  const daily = [
    { date: '2026-10-01', tokens: 0 },
    { date: '2026-10-02', tokens: 1500 },
  ];

  it('draws a column per day with a table for screen readers', () => {
    const out = html(<DailyBars data={daily} caption="Daily tokens" />);
    expect(out).toContain('Daily tokens');
    expect(out.match(/title="/g)).toHaveLength(2);
    expect(out).toContain('<th scope="row">2026-10-02</th><td>1500</td>');
  });

  it('marks the pressed window and lists the presets and the custom range', () => {
    const out = html(
      <WindowSwitch value={{ window: '90d', from: '', to: '' }} onChange={() => undefined} />,
    );
    expect(out).toContain('7 days');
    expect(out).toContain('1 year');
    expect(out).toMatch(/aria-pressed="true"[^>]*>90 days/);
  });

  it('shows the two date pickers only on the custom range', () => {
    const preset = html(
      <WindowSwitch value={{ window: '30d', from: '', to: '' }} onChange={() => undefined} />,
    );
    expect(preset).not.toContain('type="date"');
    const custom = html(
      <WindowSwitch
        value={{ window: 'custom', from: '2026-09-01', to: '2026-09-10' }}
        onChange={() => undefined}
      />,
    );
    expect(custom.match(/type="date"/g)).toHaveLength(2);
    expect(custom).toContain('2026-09-01');
  });

  it('says so when there is nothing to chart, and ranks rows otherwise', () => {
    expect(html(<ShareBars rows={[]} caption="By provider" empty="Nothing yet" />)).toContain(
      'Nothing yet',
    );
    const out = html(
      <ShareBars
        caption="By provider"
        empty="x"
        rows={[
          { key: 'a', label: 'openai', value: 2_000_000, note: '3 calls' },
          { key: 'b', label: 'gemini', value: 1000 },
        ]}
      />,
    );
    expect(out).toContain('openai');
    expect(out).toContain('2M · 3 calls');
    expect(out).toContain('width:100%');
  });

  it('splits the two payers and copes with no usage at all', () => {
    const out = html(
      <SourceSplit
        caption="Who paid"
        platformLabel="Platform"
        ownLabel="Own"
        platform={750}
        own={250}
      />,
    );
    expect(out).toContain('width:75%');
    expect(out).toContain('width:25%');
    const none = html(
      <SourceSplit
        caption="Who paid"
        platformLabel="Platform"
        ownLabel="Own"
        platform={0}
        own={0}
      />,
    );
    expect(none).toContain('width:0%');
  });
});
