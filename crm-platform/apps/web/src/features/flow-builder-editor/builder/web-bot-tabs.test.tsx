import { describe, expect, it, vi } from 'vitest';
import { renderIntl } from '../test-utils/intl';
import { WebBotTabs, tabFromParam, whatsappDefaultsFrom } from './web-bot-tabs';

// The panels pull in the widget screens; the tab bar alone is under test.
vi.mock('@/features/chatbot-widget/components/flow-widget-customize', () => ({
  FlowWidgetCustomize: () => null,
}));
vi.mock('@/features/chatbot-widget/components/flow-widget-deploy', () => ({
  FlowWidgetDeploy: () => null,
}));

const render = (over: Partial<Parameters<typeof WebBotTabs>[0]> = {}) =>
  renderIntl(
    <WebBotTabs tab="build" onTab={() => undefined} saved needsCustomizing={false} {...over} />,
  );

describe('Build · Customize · Deploy tabs', () => {
  it('shows the three tabs with the current one selected', () => {
    const out = render({ tab: 'customize' });
    expect(out).toMatch(/>Build</);
    expect(out).toMatch(/>Customize</);
    expect(out).toMatch(/>Deploy</);
    expect(out).toMatch(/id="web-bot-tab-customize"[^>]*aria-selected="true"/);
  });

  it('keeps the amber dot on Customize until the widget has been saved', () => {
    expect(render({ needsCustomizing: true })).toContain('data-testid="needs-customizing"');
    expect(render({ needsCustomizing: false })).not.toContain('needs-customizing');
  });

  it('locks Customize and Deploy until the bot has been saved once', () => {
    const out = render({ saved: false });
    expect(out).toMatch(/id="web-bot-tab-customize"[^>]*disabled=""/);
    expect(out).toMatch(/id="web-bot-tab-deploy"[^>]*disabled=""/);
    expect(out).not.toMatch(/id="web-bot-tab-build"[^>]*disabled=""/);
  });
});

describe('the tab a link asks for', () => {
  it('opens Customize or Deploy when asked, and Build otherwise', () => {
    expect(tabFromParam('customize')).toBe('customize');
    expect(tabFromParam('deploy')).toBe('deploy');
    // The old name of Deploy still works in an old link.
    expect(tabFromParam('install')).toBe('deploy');
    expect(tabFromParam(null)).toBe('build');
    expect(tabFromParam('settings')).toBe('build');
  });
});

describe("what a WhatsApp bot's button is made from, read off the Trigger", () => {
  const senders = [
    { key: 'waba:aaa', label: 'Support line', phone: '919876543210' },
    { key: 'baileys:bbb', label: 'Old phone', phone: null },
  ];

  it('takes the chosen number, its name and the first keyword', () => {
    const trigger = {
      data: { deviceId: 'waba:aaa', keywordMode: 'keywords', keywords: ' hi , hello ' },
    };
    expect(whatsappDefaultsFrom(trigger, senders)).toEqual({
      phone: '919876543210',
      numberLabel: 'Support line',
      keyword: 'hi',
    });
  });

  it('has no keyword when the bot starts on any message', () => {
    const trigger = { data: { deviceId: 'waba:aaa', keywordMode: 'any', keywords: 'hi' } };
    expect(whatsappDefaultsFrom(trigger, senders).keyword).toBe('');
  });

  it('has no number when none is chosen, or the chosen one has none', () => {
    expect(whatsappDefaultsFrom({ data: { deviceId: '' } }, senders).phone).toBeNull();
    expect(whatsappDefaultsFrom({ data: { deviceId: 'baileys:bbb' } }, senders).phone).toBeNull();
    expect(whatsappDefaultsFrom(undefined, senders)).toEqual({
      phone: null,
      numberLabel: '',
      keyword: '',
    });
  });

  it('runs on the only connected number when the Trigger has not chosen one', () => {
    const one = [{ key: 'waba:only', label: 'Only line', phone: '919000000001' }];
    expect(whatsappDefaultsFrom({ data: { deviceId: '' } }, one)).toMatchObject({
      phone: '919000000001',
      numberLabel: 'Only line',
    });
  });

  it('does not guess when several are connected and none is chosen', () => {
    const two = [
      { key: 'waba:a', label: 'A', phone: '911' },
      { key: 'waba:b', label: 'B', phone: '912' },
    ];
    expect(whatsappDefaultsFrom({ data: {} }, two).phone).toBeNull();
  });
});
