import { describe, expect, it, vi } from 'vitest';
import { renderIntl } from '../test-utils/intl';
import { BuilderTabs, tabFromParam, tabsOf, whatsappDefaultsFrom } from './web-bot-tabs';

// The panels pull in the widget screens; the tab bar alone is under test.
vi.mock('@/features/chatbot-widget/components/flow-widget-customize', () => ({
  FlowWidgetCustomize: () => null,
}));
vi.mock('@/features/chatbot-widget/components/flow-widget-deploy', () => ({
  FlowWidgetDeploy: () => null,
}));

const render = (over: Partial<Parameters<typeof BuilderTabs>[0]> = {}) =>
  renderIntl(
    <BuilderTabs
      tab="build"
      onTab={() => undefined}
      saved
      needsCustomizing={false}
      web
      {...over}
    />,
  );

describe('Build · Customize · Deploy tabs', () => {
  it('shows all three for a website bot, in order, with the current one selected', () => {
    const out = render({ tab: 'customize' });
    const names = [...out.matchAll(/role="tab"[^>]*id="web-bot-tab-(\w+)"/g)].map((m) => m[1]);
    expect(names).toEqual(['build', 'customize', 'deploy']);
    expect(out).not.toMatch(/>FAQs</);
    expect(out).toMatch(/id="web-bot-tab-customize"[^>]*aria-selected="true"/);
  });

  it('shows no bar at all when Build is the only page (Advanced builder, other flows)', () => {
    expect(render({ web: false })).toBe('');
  });

  it('keeps the amber dot on Customize until the widget has been saved', () => {
    expect(render({ needsCustomizing: true })).toContain('data-testid="needs-customizing"');
    expect(render({ needsCustomizing: false })).not.toContain('needs-customizing');
  });

  it('locks Customize and Deploy until the flow has been saved once, with a "save first" title', () => {
    const out = render({ saved: false });
    for (const k of ['customize', 'deploy'])
      expect(out).toMatch(new RegExp(`id="web-bot-tab-${k}"[^>]*disabled=""`));
    expect(out).toContain('title="Save the flow first."');
    expect(out).not.toMatch(/id="web-bot-tab-build"[^>]*disabled=""/);
  });
});

describe('which tabs a builder offers', () => {
  it('lists them in order', () => {
    expect(tabsOf({ web: true })).toEqual(['build', 'customize', 'deploy']);
    expect(tabsOf({ web: false })).toEqual(['build']);
  });
});

describe('the tab a link asks for', () => {
  it('opens Customize or Deploy when asked, and Build otherwise (an old ?tab=faqs link too)', () => {
    expect(tabFromParam('customize')).toBe('customize');
    expect(tabFromParam('deploy')).toBe('deploy');
    expect(tabFromParam('install')).toBe('deploy');
    expect(tabFromParam(null)).toBe('build');
    expect(tabFromParam('settings')).toBe('build');
    expect(tabFromParam('faqs')).toBe('build');
  });

  it('ignores a tab the builder does not offer', () => {
    expect(tabFromParam('customize', { web: false })).toBe('build');
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
