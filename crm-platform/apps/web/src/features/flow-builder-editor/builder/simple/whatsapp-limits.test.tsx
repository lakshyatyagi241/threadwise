import { describe, expect, it, vi } from 'vitest';
import { renderIntl } from '../../test-utils/intl';
import { FlowEditorContext } from '../../lib/flow-editor-context';
import { OptionRow } from '../inspector/forms-core/parts';
import { LIMITS } from '../../lib/simple-model';
import { FLB_WA_LIMITS } from '@crm/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StepEditor } from './step-editors';

vi.mock('@/features/chatbot-widget/api/widgets', () => ({ uploadFlowWidgetImage: vi.fn() }));

const list = {
  id: 's1',
  type: 'list' as const,
  links: [null],
  data: { prompt: 'p', button: 'Open', options: [{ title: 'A', description: 'd', section: '' }] },
};
const doc = {
  trigger: { id: 't', type: 'trigger', x: 0, y: 0, data: {} },
  journeys: [{ name: 'Main', steps: [list] }],
  vars: [],
};

const editor = (whatsapp: boolean) =>
  renderIntl(
    <QueryClientProvider client={new QueryClient()}>
      <FlowEditorContext.Provider value={{ flowId: 'f1', web: !whatsapp, whatsapp }}>
        <StepEditor
          step={list}
          doc={doc as never}
          ctx={{} as never}
          flowId="f1"
          set={() => undefined}
          link={() => undefined}
        />
      </FlowEditorContext.Provider>
    </QueryClientProvider>,
  );

describe('WhatsApp limits stop typing, website bots keep the warning', () => {
  it('the Simple limits are Meta limits', () => {
    expect(LIMITS.buttonLabel).toBe(FLB_WA_LIMITS.buttonTitle);
    expect(LIMITS.rowTitle).toBe(FLB_WA_LIMITS.rowTitle);
    expect(LIMITS.rowDescription).toBe(FLB_WA_LIMITS.rowDescription);
    expect(LIMITS.listButton).toBe(FLB_WA_LIMITS.listButton);
    expect(LIMITS.body).toBe(FLB_WA_LIMITS.body);
    expect(LIMITS.buttons).toBe(FLB_WA_LIMITS.replyButtons);
    expect(LIMITS.rows).toBe(FLB_WA_LIMITS.listRows);
  });

  it('a WhatsApp list caps button text, row title and description', () => {
    const html = editor(true);
    expect(html).toContain('maxLength="20"');
    expect(html).toContain('maxLength="24"');
    expect(html).toContain('maxLength="72"');
  });

  it('a website list does not cap them', () => {
    const html = editor(false);
    expect(html).not.toContain('maxLength="24"');
    expect(html).not.toContain('maxLength="72"');
  });

  it('an Advanced button row stops at its limit and shows the count', () => {
    const html = renderIntl(
      <OptionRow
        index={0}
        value="Yes"
        maxLength={20}
        onChange={() => undefined}
        onRemove={() => undefined}
      />,
    );
    expect(html).toContain('maxLength="20"');
    expect(html).toContain('3/20');
  });
});
