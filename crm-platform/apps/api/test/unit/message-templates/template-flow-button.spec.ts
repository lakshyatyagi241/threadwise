import { describe, expect, it } from 'vitest';
import { lintTemplate } from '../../../src/modules/message-templates/template-linter';
import { buildMetaTemplate } from '../../../src/modules/message-templates/template-payload';

/**
 * Legacy #13317: a template with a Flow ("form") button was rejected by Meta. The linter accepts a Flow named by `flow_name` or given as
 * `flow_json` (no numeric id), but the payload builder copied only `flow_id`, so Meta received a Flow button that named no Flow.
 */
const draft = (button: Record<string, unknown>) =>
  ({
    name: 'book_slot',
    templateType: 'standard',
    body: 'Book your slot',
    buttons: [{ type: 'FLOW', text: 'Book', ...button }],
  }) as never;

const flowButton = (button: Record<string, unknown>) => {
  const out = buildMetaTemplate(draft(button)) as {
    components: Array<{ type: string; buttons?: Array<Record<string, unknown>> }>;
  };
  return out.components.find((c) => c.type === 'BUTTONS')!.buttons![0]!;
};

describe('flow button payload', () => {
  it('keeps the Flow name the linter accepts in place of an id', () => {
    const b = { flow_name: 'booking', flow_action: 'navigate', navigate_screen: 'START' };
    expect(
      lintTemplate({ ...(draft(b) as object), language: 'en', category: 'MARKETING' } as never).map(
        (i) => i.code,
      ),
    ).not.toContain('flow_id');
    expect(flowButton(b)).toMatchObject({ type: 'FLOW', flow_name: 'booking' });
  });

  it('keeps an inline Flow JSON', () => {
    expect(flowButton({ flow_json: '{"version":"6.0","screens":[]}' })).toMatchObject({
      flow_json: '{"version":"6.0","screens":[]}',
    });
  });

  it('still sends the id, action and screen', () => {
    expect(
      flowButton({ flow_id: '123', flow_action: 'navigate', navigate_screen: 'A' }),
    ).toMatchObject({ flow_id: '123', flow_action: 'navigate', navigate_screen: 'A' });
  });
});
