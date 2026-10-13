import { describe, expect, it, vi } from 'vitest';
import { renderIntl } from '../test-utils/intl';
import { FlowEditorContext } from '../lib/flow-editor-context';
import { ButtonIcon } from './button-icon';

vi.mock('@/features/chatbot-widget/api/widgets', () => ({ uploadFlowWidgetImage: vi.fn() }));

const show = (ctx: { flowId: string | null; web: boolean }, value = '') =>
  renderIntl(
    <FlowEditorContext.Provider value={ctx}>
      <ButtonIcon value={value} onChange={() => undefined} />
    </FlowEditorContext.Provider>,
  );

describe('ButtonIcon: an optional small picture on a button', () => {
  it('shows nothing on a bot that is not a website chat bot', () => {
    expect(show({ flowId: 'f1', web: false })).toBe('');
  });

  it('asks to save the bot first when it has no id yet, and offers no upload', () => {
    const html = show({ flowId: null, web: true });
    expect(html).toContain('Save the bot once to add an icon.');
    expect(html).not.toContain('<input');
  });

  it('offers to add a picture on a saved bot', () => {
    const html = show({ flowId: 'f1', web: true });
    expect(html).toContain('Icon (optional)');
    expect(html).toContain('Add icon');
    expect(html).toContain('type="file"');
    expect(html).not.toContain('Remove');
  });

  it('shows the picture and offers to replace or remove it once one is set', () => {
    const html = show({ flowId: 'f1', web: true }, 'https://x.test/widget-assets/f/bi00000001?v=a');
    expect(html).toContain('<img');
    expect(html).toContain('Replace');
    expect(html).toContain('Remove');
  });
});
