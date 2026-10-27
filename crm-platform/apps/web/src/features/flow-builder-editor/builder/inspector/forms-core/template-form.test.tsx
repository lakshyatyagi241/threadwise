import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { FlowNode } from '@crm/contracts';
import { TemplateForm } from './send';

vi.mock('next-intl', () => ({
  useTranslations: () => {
    const t = (key: string) => key;
    t.rich = t;
    return t;
  },
}));
vi.mock('@/features/contacts-attributes-tags', () => ({
  NewPropertyDialog: () => null,
  usePickerFeed: () => ({ data: undefined }),
}));

const noop = () => undefined;
const tpl = (extra: Record<string, unknown> = {}) => ({
  id: 't1',
  name: 'order_update',
  category: 'UTILITY',
  header: null,
  body: 'Hi {{1}}, order {{2}} shipped',
  footer: null,
  attachmentType: null,
  attachmentFile: null,
  buttons: [],
  carousel: [],
  variables: [
    { section: 'body', slot: 1, field: 'name' },
    { section: 'body', slot: 2, field: 'order_id' },
  ],
  ...extra,
});

const html = (data: Record<string, unknown>, template = tpl()) => {
  const node: FlowNode = { id: 'n_1', type: 'template', x: 0, y: 0, data };
  return renderToStaticMarkup(
    <TemplateForm
      node={node}
      data={data}
      set={noop}
      setMany={noop}
      addOption={noop}
      removeOption={noop}
      env={{ ctx: { templates: [template] }, loading: false, nodes: [], flowId: null } as never}
    />,
  );
};

describe('Send template form: what fills each placeholder', () => {
  it('offers a field for every placeholder of the chosen template, with the saved fill', () => {
    const out = html({ tpl: 'order_update', tplVars: { 'body:1': 'Asha' } });
    expect(out).toContain('templateFills');
    expect(out).toContain('{{1}}');
    expect(out).toContain('{{2}}');
    expect(out).toContain('value="Asha"');
  });

  it('shows no fill fields before a template is chosen, or when it has no placeholders', () => {
    expect(html({ tpl: '' })).not.toContain('templateFills');
    expect(html({ tpl: 'order_update' }, tpl({ variables: [] }))).not.toContain('templateFills');
  });

  it('asks for the header file when the template has a picture header and no file of its own', () => {
    const out = html({ tpl: 'order_update' }, tpl({ attachmentType: 'image' }));
    expect(out).toContain('templateHeaderMedia');
    expect(out).toContain('templateHeaderMediaMissing');
    const own = html(
      { tpl: 'order_update' },
      tpl({ attachmentType: 'image', attachmentFile: 'https://cdn.test/a.jpg' }),
    );
    expect(own).not.toContain('templateHeaderMediaMissing');
  });
});
