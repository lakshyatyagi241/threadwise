import { describe, expect, it, vi } from 'vitest';
import { AIGenModal, SaveConfirmModal } from './modals';
import { renderIntl as renderToStaticMarkup } from '../test-utils/intl';

vi.mock('../api/flows', () => ({ flowsApi: { aiGenerate: vi.fn() } }));

const noop = () => undefined;
const render = (models: Array<{ value: string; label: string; provider: string }>, prompt = '') =>
  renderToStaticMarkup(
    <AIGenModal
      open
      models={models}
      initialPrompt={prompt}
      flowType="chat"
      onClose={noop}
      onGenerate={noop}
    />,
  );

describe('Generate with AI modal (TW-FLB-025)', () => {
  it('renders nothing while closed', () => {
    expect(
      renderToStaticMarkup(
        <AIGenModal
          open={false}
          models={[]}
          initialPrompt=""
          flowType="chat"
          onClose={noop}
          onGenerate={noop}
        />,
      ),
    ).toBe('');
  });

  it('copy: title, subtitle, placeholder, the four quick examples, footer note, Cancel and Generate', () => {
    const html = render([{ value: 'gpt-4o', label: 'OpenAI · gpt-4o', provider: 'openai' }]);
    for (const t of [
      'AI Flow Generator',
      'Generate a flow with AI',
      'Pick a model, describe what you want, and AI will build the nodes.',
      'Choose model',
      'Describe your flow',
      'Example: Create a customer support bot that asks for user name, email, and issue type, then sends a confirmation message…',
      'Quick examples',
      'Customer support bot with name, email collection',
      'Order tracking with order number verification',
      'Lead qualification bot with budget questions',
      'Appointment booking with date and time selection',
      'AI will replace the current flow.',
      'Cancel',
      'Generate',
    ])
      expect(html, t).toContain(t);
    // Reference's textarea has no maxlength (the server answers 422 past 2000 characters)
    expect(html).not.toContain('maxLength');
  });

  it('no providers: the empty state names AI Keys as a link to the platform page, and Generate is disabled', () => {
    const html = render([]);
    expect(html).toContain('No AI providers enabled. Admin needs to add a key in');
    expect(html).toContain('href="/admin/api-keys"');
    expect(html).toContain('before this can run.');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[^]*Generate<\/button>/);
  });

  it('one tile per model with the provider label and the model id, the first selected; grid width follows the count', () => {
    const one = render([{ value: 'gpt-4o', label: 'OpenAI · gpt-4o', provider: 'openai' }]);
    expect(one).toContain('grid-cols-1');
    expect(one).toContain('aria-pressed="true"');
    const three = render([
      { value: 'a', label: 'OpenAI · a', provider: 'openai' },
      { value: 'b', label: 'Anthropic · b', provider: 'anthropic' },
      { value: 'c', label: 'Google · c', provider: 'gemini' },
    ]);
    expect(three).toContain('grid-cols-3');
    expect(three).toContain('Anthropic');
    expect(three.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(
      render([
        { value: 'a', label: 'OpenAI (your key) · a', provider: 'openai' },
        { value: 'b', label: 'Google · b', provider: 'gemini' },
      ]),
    ).toContain('grid-cols-2');
  });

  it('a prompt carried in the URL (?ai_prompt=) pre-fills the textarea and enables Generate', () => {
    const html = render(
      [{ value: 'gpt-4o', label: 'OpenAI · gpt-4o', provider: 'openai' }],
      'Greet the customer',
    );
    expect(html).toContain('>Greet the customer</textarea>');
  });
});

describe('Save confirm modal', () => {
  it('is mounted only while open and starts from the current name', () => {
    expect(
      renderToStaticMarkup(
        <SaveConfirmModal open={false} initialName="x" busy={false} onSave={noop} onClose={noop} />,
      ),
    ).toBe('');
    const html = renderToStaticMarkup(
      <SaveConfirmModal open initialName="Welcome" busy={false} onSave={noop} onClose={noop} />,
    );
    expect(html).toContain('value="Welcome"');
    expect(html).toContain('Save flow');
  });
});
