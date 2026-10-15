// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { button, click, mount, type, type Mounted } from '../testing';

const state = vi.hoisted(() => ({
  perms: new Set<string>(),
  query: { data: undefined } as { data: unknown },
}));
vi.mock('@/features/auth-registration-security/shared/session-context', () => ({
  useCan: (p: string) => state.perms.has(p),
}));
vi.mock('../api/hooks', () => ({ useComposerConsent: () => state.query }));

import { OptOutFooterSuggestion, OptOutLine, OptOutTemplateHint } from './opt-out-line';

const config = {
  footerText: { en: 'Reply STOP to unsubscribe', ar: 'أرسل إيقاف لإلغاء الاشتراك' },
  footerDefaultOn: true,
  requireConsentForMarketing: false,
  optOutKeywords: { en: ['STOP'] },
};

function Host({ initial }: { initial: string }) {
  const [body, setBody] = useState(initial);
  return (
    <>
      <textarea aria-label="body" value={body} onChange={(e) => setBody(e.target.value)} />
      <OptOutLine body={body} onChange={setBody} />
    </>
  );
}

let m: Mounted | null = null;
beforeEach(() => {
  state.perms = new Set(['camp.campaigns.create']);
  state.query = { data: config };
});
afterEach(async () => {
  await m?.unmount();
  m = null;
});

const body = (host: HTMLElement) => host.querySelector<HTMLTextAreaElement>('textarea')!.value;

describe('opt-out line in the composer', () => {
  it('warns when a marketing text has no opt-out instruction and adds the line in one click', async () => {
    m = await mount(<Host initial="Big sale today" />);
    expect(m.host.textContent).toContain('does not tell people how to opt out');
    await click(button(m.host, 'Add the line'));
    expect(body(m.host)).toBe('Big sale today\n\nReply STOP to unsubscribe');
    expect(m.host.textContent).not.toContain('does not tell people how to opt out');
    expect((m.host.querySelector('input[type="checkbox"]') as HTMLInputElement).checked).toBe(true);
  });

  it('the tick box adds and removes the line', async () => {
    m = await mount(<Host initial="Sale" />);
    const box = m.host.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    await click(box);
    expect(body(m.host)).toBe('Sale\n\nReply STOP to unsubscribe');
    await click(m.host.querySelector<HTMLInputElement>('input[type="checkbox"]')!);
    expect(body(m.host)).toBe('Sale');
  });

  it('no warning when the text already says how to opt out, or when it is empty', async () => {
    m = await mount(<Host initial="Sale! Reply stop to opt out" />);
    expect(m.host.textContent).not.toContain('does not tell people how to opt out');
    await type(m.host.querySelector('textarea')!, '');
    expect(m.host.textContent).not.toContain('does not tell people how to opt out');
  });

  it('shows nothing while the settings are not loaded (the composer works without them)', async () => {
    state.query = { data: undefined };
    m = await mount(<Host initial="Sale" />);
    expect(m.host.querySelector('input[type="checkbox"]')).toBeNull();
  });

  it('template sends only get a hint with the line to put in the template', async () => {
    m = await mount(<OptOutTemplateHint />);
    expect(m.host.textContent).toContain('Reply STOP to unsubscribe');
    expect(m.host.textContent).toContain('Templates are fixed');
  });

  it('uses the Arabic line in an Arabic session', async () => {
    m = await mount(<Host initial={'عرض'} />, { locale: 'ar' });
    await click(m.host.querySelector<HTMLInputElement>('input[type="checkbox"]')!);
    expect(body(m.host)).toContain('أرسل إيقاف');
  });

  it('suggests the line as a template footer only while the footer is empty and the line fits', async () => {
    const onUse = vi.fn();
    m = await mount(<OptOutFooterSuggestion footer="" max={60} onUse={onUse} />);
    expect(m.host.textContent).toContain('Reply STOP to unsubscribe');
    await click(button(m.host, 'Use it as the footer'));
    expect(onUse).toHaveBeenCalledWith('Reply STOP to unsubscribe');
    await m.unmount();
    m = await mount(<OptOutFooterSuggestion footer="Already set" max={60} onUse={onUse} />);
    expect(m.host.textContent).toBe('');
    await m.unmount();
    m = await mount(<OptOutFooterSuggestion footer="" max={10} onUse={onUse} />);
    expect(m.host.textContent).toBe('');
  });
});
