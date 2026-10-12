import { describe, expect, it, vi } from 'vitest';
import { renderIntl } from '../test-utils/intl';
import { WebBotTabs, tabFromParam } from './web-bot-tabs';

// The panels pull in the widget screens; the tab bar alone is under test.
vi.mock('@/features/chatbot-widget/components/flow-widget-customize', () => ({
  FlowWidgetCustomize: () => null,
}));
vi.mock('@/features/chatbot-widget/components/flow-widget-install', () => ({
  FlowWidgetInstall: () => null,
}));

const render = (over: Partial<Parameters<typeof WebBotTabs>[0]> = {}) =>
  renderIntl(
    <WebBotTabs tab="build" onTab={() => undefined} saved needsCustomizing={false} {...over} />,
  );

describe('Build · Customize · Install tabs', () => {
  it('shows the three tabs with the current one selected', () => {
    const out = render({ tab: 'customize' });
    expect(out).toMatch(/>Build</);
    expect(out).toMatch(/>Customize</);
    expect(out).toMatch(/>Install</);
    expect(out).toMatch(/id="web-bot-tab-customize"[^>]*aria-selected="true"/);
  });

  it('keeps the amber dot on Customize until the widget has been saved', () => {
    expect(render({ needsCustomizing: true })).toContain('data-testid="needs-customizing"');
    expect(render({ needsCustomizing: false })).not.toContain('needs-customizing');
  });

  it('locks Customize and Install until the bot has been saved once', () => {
    const out = render({ saved: false });
    expect(out).toMatch(/id="web-bot-tab-customize"[^>]*disabled=""/);
    expect(out).toMatch(/id="web-bot-tab-install"[^>]*disabled=""/);
    expect(out).not.toMatch(/id="web-bot-tab-build"[^>]*disabled=""/);
  });
});

describe('the tab a link asks for', () => {
  it('opens Customize or Install when asked, and Build otherwise', () => {
    expect(tabFromParam('customize')).toBe('customize');
    expect(tabFromParam('install')).toBe('install');
    expect(tabFromParam(null)).toBe('build');
    expect(tabFromParam('settings')).toBe('build');
  });
});
