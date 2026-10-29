import { describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@crm/ui';
import { renderIntl } from '../../test-utils/intl';
import { FlowEditorContext } from '../../lib/flow-editor-context';
import { StepEditor } from './step-editors';

vi.mock('@/features/chatbot-widget/api/widgets', () => ({ uploadFlowWidgetImage: vi.fn() }));

const media = (kind: string) => ({
  id: 's1',
  type: 'media' as const,
  links: [null],
  data: { kind, url: '', filename: '', caption: 'Hello' },
});
const doc = (step: ReturnType<typeof media>) => ({
  trigger: { id: 't', type: 'trigger', x: 0, y: 0, data: {} },
  journeys: [{ name: 'Main', steps: [step] }],
  vars: [],
});

const html = (kind: string) => {
  const step = media(kind);
  return renderIntl(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>
        <FlowEditorContext.Provider value={{ flowId: 'f1', web: false, whatsapp: true }}>
          <StepEditor
            step={step}
            doc={doc(step) as never}
            ctx={{} as never}
            flowId="f1"
            set={() => undefined}
            link={() => undefined}
          />
        </FlowEditorContext.Provider>
      </ToastProvider>
    </QueryClientProvider>,
  );
};

describe('the Media step caption', () => {
  it('has the formatting buttons and the emoji picker, like a message', () => {
    const out = html('image');
    expect(out).toContain('Text formatting');
    expect(out).toContain('Insert a variable');
    expect(out).toContain('Emoji');
  });

  it('an audio step has no caption (WhatsApp does not carry one)', () => {
    expect(html('audio')).not.toContain('Text formatting');
  });
});
