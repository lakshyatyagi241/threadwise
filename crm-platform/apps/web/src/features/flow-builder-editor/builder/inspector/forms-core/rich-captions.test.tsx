import { describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@crm/ui';
import { renderIntl } from '../../../test-utils/intl';
import { NotifyNumberForm } from './send';
import { SequenceForm } from './sequence';

vi.mock('@/features/chatbot-widget/api/widgets', () => ({ uploadFlowWidgetImage: vi.fn() }));

const wrap = (el: React.ReactNode) =>
  renderIntl(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>{el}</ToastProvider>
    </QueryClientProvider>,
  );
const env = { nodes: [] } as never;
const noop = () => undefined;
const props = (data: Record<string, unknown>) =>
  ({ data, set: noop, setMany: noop, env, addOption: noop, removeOption: noop }) as never;

const TOOLBAR = 'Text formatting';

describe('captions and texts that go out on WhatsApp have formatting and emoji', () => {
  it('Send sequence: a text reply and a file reply caption', () => {
    const out = wrap(
      <SequenceForm
        {...props({
          replies: [
            { type: 'text', text: 'Hi' },
            { type: 'image', url: '', filename: '', caption: 'Look' },
          ],
        })}
      />,
    );
    // One rich box per text or caption (each draws its toolbar), not a plain input.
    expect(out.split('aria-label="Emoji"').length - 1).toBe(2);
    expect(out).toContain(TOOLBAR);
  });

  it('Copy to number with your own text: the message', () => {
    const out = wrap(
      <NotifyNumberForm {...props({ source: 'custom', kind: 'text', text: 'Hi' })} />,
    );
    expect(out).toContain(TOOLBAR);
  });

  it('Copy to number with your own file: the caption', () => {
    const out = wrap(
      <NotifyNumberForm
        {...props({ source: 'custom', kind: 'image', url: 'https://x.test/a.jpg', caption: 'Hi' })}
      />,
    );
    expect(out).toContain(TOOLBAR);
  });
});
