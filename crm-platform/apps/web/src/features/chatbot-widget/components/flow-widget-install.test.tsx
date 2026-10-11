import { describe, expect, it, vi } from 'vitest';
import { renderIntl } from '@/features/flow-builder-editor/test-utils/intl';
import { FlowWidgetInstall } from './flow-widget-install';

const state = vi.hoisted(() => ({
  value: { isPending: false, data: { widget: null } } as {
    isPending: boolean;
    data?: { widget: { embedUrl: string; previewUrl: string } | null };
  },
}));

vi.mock('../api/widgets', () => ({ useFlowWidget: () => state.value }));
vi.mock('@crm/ui', async (orig) => ({
  ...(await orig<typeof import('@crm/ui')>()),
  useToast: () => ({ toast: () => 0 }),
}));

const widget = {
  embedUrl: 'https://api.example.com/widget/tok123/embed',
  previewUrl: 'https://api.example.com/widget/tok123/chat',
};

describe('Install tab of a website chat bot', () => {
  it('asks for Customize first while the bot has no widget', () => {
    state.value = { isPending: false, data: { widget: null } };
    const out = renderIntl(<FlowWidgetInstall flowId="f1" published />);
    expect(out).toContain('Save the Customize tab first');
    expect(out).not.toContain('install-snippet');
  });

  it('shows the script to paste and the chat link once the widget exists', () => {
    state.value = { isPending: false, data: { widget } };
    const out = renderIntl(<FlowWidgetInstall flowId="f1" published />);
    expect(out).toContain(
      '&lt;script defer src=&quot;https://api.example.com/widget/tok123/embed&quot;',
    );
    expect(out).toContain('href="https://api.example.com/widget/tok123/chat"');
    expect(out).not.toContain('not published yet');
  });

  it('says visitors get no answers until the bot is published', () => {
    state.value = { isPending: false, data: { widget } };
    const out = renderIntl(<FlowWidgetInstall flowId="f1" published={false} />);
    expect(out).toContain('not published yet');
  });
});
