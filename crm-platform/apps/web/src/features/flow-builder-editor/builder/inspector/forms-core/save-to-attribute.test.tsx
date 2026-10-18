import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { flbDefaultNodeData, type FlowNode } from '@crm/contracts';
import { AskForm, ButtonsForm, ListForm } from './options';

// Messages are not loaded here: the key is the text; a key with params keeps them so the `{{choice}}` hint can be read.
vi.mock('next-intl', () => ({
  useTranslations: () => {
    const t = (key: string, values?: Record<string, unknown>) =>
      values ? `${key} ${JSON.stringify(values)}` : key;
    t.rich = t;
    return t;
  },
}));
// The inline new-property form toasts; there is no ToastProvider in a static render.
vi.mock('@crm/ui', async (orig) => ({
  ...(await orig<typeof import('@crm/ui')>()),
  useToast: () => () => undefined,
}));
vi.mock('@/lib/use-unofficial-whatsapp', () => ({ useUnofficialWhatsapp: () => false }));
vi.mock('@/features/contacts-attributes-tags', () => ({
  usePickerFeed: () => ({
    data: {
      system: [{ key: 'name', name: 'Name', description: '' }],
      custom: [{ key: 'plan', name: 'Plan', description: null, value: null }],
    },
  }),
}));

const noop = () => undefined;
const html = (
  Form: typeof ListForm,
  type: 'list' | 'buttons' | 'ask',
  patch: Record<string, unknown> = {},
) => {
  const data = { ...flbDefaultNodeData(type), ...patch };
  const node: FlowNode = { id: 'n_1', type, x: 0, y: 0, data };
  return renderToStaticMarkup(
    <Form
      node={node}
      data={data}
      set={noop}
      setMany={noop}
      addOption={noop}
      removeOption={noop}
      env={{ ctx: { flows: [], teams: [] }, loading: false, flowId: null } as never}
    />,
  );
};

describe('save the choice to a variable and a contact attribute', () => {
  it.each([
    ['List message', ListForm, 'list'],
    ['Quick replies', ButtonsForm, 'buttons'],
  ] as const)(
    '%s shows the variable field with its {{choice}} hint, and the checkbox',
    (_n, Form, type) => {
      const out = html(Form, type);
      expect(out).toContain('variableLabel');
      expect(out).toContain('{{choice}}');
      expect(out).toContain('saveToAttribute');
      // Off: no property select yet, no error.
      expect(out).not.toContain('Contact property');
      expect(out).not.toContain('propertyRequired');
    },
  );

  it('shows the variable name the author gave it', () => {
    expect(html(ListForm, 'list', { var: 'size' })).toContain('{{size}}');
  });

  it.each([
    ['list', ListForm],
    ['buttons', ButtonsForm],
  ] as const)(
    '%s: turning it on lists the custom contact properties and flags no choice',
    (type, Form) => {
      const out = html(Form, type, { saveProperty: true, propertyKey: '' });
      expect(out).toContain('propertyLabel');
      expect(out).toContain('>Plan<');
      expect(out).not.toContain('>Name<');
      expect(out).toContain('propertyRequired');
      expect(out).toContain('choicePropertyHint');
    },
  );

  it('a chosen property clears the inline error', () => {
    const out = html(ListForm, 'list', { saveProperty: true, propertyKey: 'plan' });
    expect(out).not.toContain('propertyRequired');
    expect(out).toContain('selected');
  });

  it('Ask question has it for free text too, not only for a checked answer', () => {
    const off = html(AskForm, 'ask');
    expect(off).toContain('saveToAttribute');
    const on = html(AskForm, 'ask', { saveProperty: true, propertyKey: '' });
    expect(on).toContain('answerPropertyHint');
    expect(on).toContain('propertyRequired');
  });
});
