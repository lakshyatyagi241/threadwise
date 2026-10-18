import { describe, expect, it, vi } from 'vitest';
import { renderIntl } from '@/features/flow-builder-editor/test-utils/intl';
import { FlowWidgetDeploy } from './flow-widget-deploy';

type Widget = {
  embedUrl: string;
  previewUrl: string;
  targetWhatsappCc: string | null;
  targetWhatsappNumber: string | null;
  prefilledMessage: string | null;
};
const state = vi.hoisted(() => ({
  value: { isPending: false, data: { widget: null } } as {
    isPending: boolean;
    data?: { widget: Widget | null };
  },
}));

vi.mock('../api/widgets', () => ({ useFlowWidget: () => state.value }));
vi.mock('@crm/ui', async (orig) => ({
  ...(await orig<typeof import('@crm/ui')>()),
  useToast: () => ({ toast: () => 0 }),
}));

const widget: Widget = {
  embedUrl: 'https://api.example.com/widget/tok123/embed',
  previewUrl: 'https://api.example.com/widget/tok123/chat',
  targetWhatsappCc: '+91',
  targetWhatsappNumber: '9876543210',
  prefilledMessage: 'hello',
};

describe('Deploy tab', () => {
  it('asks for Customize first while the bot has no widget, in the words of its channel', () => {
    state.value = { isPending: false, data: { widget: null } };
    expect(renderIntl(<FlowWidgetDeploy flowId="f1" channel="web" published />)).toContain(
      'Your embed code appears here',
    );
    expect(renderIntl(<FlowWidgetDeploy flowId="f1" channel="chat" published />)).toContain(
      'Your website button and WhatsApp link appear here',
    );
  });

  it('gives a website chat bot its embed code and the chat page, and no WhatsApp link', () => {
    state.value = { isPending: false, data: { widget } };
    const out = renderIntl(<FlowWidgetDeploy flowId="f1" channel="web" published />);
    expect(out).toContain(
      '&lt;script defer src=&quot;https://api.example.com/widget/tok123/embed&quot;',
    );
    expect(out).toContain('href="https://api.example.com/widget/tok123/chat"');
    expect(out).not.toContain('Direct WhatsApp link');
    expect(out).not.toContain('Download QR code');
  });

  it('gives a WhatsApp bot the embed code, a preview and the direct link with its message', () => {
    state.value = { isPending: false, data: { widget } };
    const out = renderIntl(<FlowWidgetDeploy flowId="f1" channel="chat" published />);
    expect(out).toContain('Direct WhatsApp link');
    expect(out).toContain('https://wa.me/919876543210?text=hello');
    expect(out).toContain('Copy link');
    expect(out).toContain('Preview');
    // The QR code opens the same chat, and can be downloaded.
    expect(out).toContain('data-testid="deploy-qr"');
    expect(out).toContain('Download QR code');
    expect(out).not.toContain('not published yet');
  });

  it('warns that an unpublished bot does not answer', () => {
    state.value = { isPending: false, data: { widget } };
    expect(renderIntl(<FlowWidgetDeploy flowId="f1" channel="chat" published={false} />)).toContain(
      'will not answer on WhatsApp',
    );
    expect(renderIntl(<FlowWidgetDeploy flowId="f1" channel="web" published={false} />)).toContain(
      'visitors will not get answers',
    );
  });

  it('does not offer a Preview link to an unpublished bot, whose chat page would answer "Page not found"', () => {
    state.value = { isPending: false, data: { widget } };
    const draft = renderIntl(<FlowWidgetDeploy flowId="f1" channel="web" published={false} />);
    expect(draft).toContain('deploy-preview-disabled');
    expect(draft).not.toContain(widget.previewUrl);
    const live = renderIntl(<FlowWidgetDeploy flowId="f1" channel="web" published />);
    expect(live).toContain(widget.previewUrl);
  });
});

describe('isLocalAddress', () => {
  it('flags addresses that only work on this computer', async () => {
    const { isLocalAddress } = await import('./flow-widget-deploy');
    expect(isLocalAddress('http://localhost:3300/widget/x/embed')).toBe(true);
    expect(isLocalAddress('http://127.0.0.1:3300/x')).toBe(true);
    expect(isLocalAddress('https://api.example.com/widget/x/embed')).toBe(false);
    expect(isLocalAddress('not a url')).toBe(false);
  });
});
