import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  FLB_ASK_FILE_GROUPS,
  flbDefaultNodeData,
  flbPaletteFor,
  type FlowNode,
} from '@crm/contracts';
import { lookOf } from '../../lib/node-ui';
import { AskFileCardBody, AskLocationCardBody } from './cards';
import { ExtensionChecklist, ExtensionsPanel, extensionsChanged } from './extension-panel';
import { EMOJIS, FORMAT_MARKS, insertAt, wrapSelection } from './prompt-box';
import { AskFileForm, AskLocationForm } from '../inspector/forms-core/ask-media';
import { NODE_FORMS } from '../inspector/registry';
import { filterPalette } from '../palette';
import { plainFlbTranslator as tf } from '../../test-utils/plain-translator';
import { NodeCard } from '../node-card';

// Messages are not loaded here: the key is the text. A param-carrying key keeps its params so a hint can be read.
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) =>
    values ? `${key} ${JSON.stringify(values)}` : key,
}));
vi.mock('@/features/contacts-attributes-tags', () => ({
  usePickerFeed: () => ({
    data: {
      system: [{ key: 'name', name: 'Name', description: '' }],
      custom: [{ key: 'id_proof', name: 'ID proof', description: null, value: null }],
    },
  }),
}));

const node = (type: 'ask_file' | 'ask_location', data = flbDefaultNodeData(type)): FlowNode => ({
  id: 'n_7',
  type,
  x: 0,
  y: 0,
  data,
});
const noop = () => undefined;
const formProps = (n: FlowNode) => ({
  node: n,
  data: n.data,
  set: noop,
  setMany: noop,
  addOption: noop,
  removeOption: noop,
  env: {} as never,
});

describe('palette entries', () => {
  it('both nodes are in the WhatsApp palette, group Listen, next to Ask question, and nowhere else', () => {
    const listen = filterPalette('chat', '', tf).find(([g]) => g === 'Listen')![1];
    expect(listen.map((d) => d.id)).toEqual(['ask', 'ask_file', 'ask_location']);
    expect(listen.map((d) => d.label)).toEqual([
      'Ask question',
      'Ask for file / image',
      'Ask for location',
    ]);
    for (const mode of ['instagram', 'facebook', 'call', 'telegram'] as const) {
      expect(flbPaletteFor(mode).map((d) => d.id)).not.toContain('ask_file');
      expect(flbPaletteFor(mode).map((d) => d.id)).not.toContain('ask_location');
    }
  });

  it('search finds them by label and by description', () => {
    expect(
      filterPalette('chat', 'file / image', tf).flatMap(([, i]) => i.map((d) => d.id)),
    ).toEqual(['ask_file']);
    expect(filterPalette('chat', 'location', tf).flatMap(([, i]) => i.map((d) => d.id))).toContain(
      'ask_location',
    );
  });

  it('the chips: peach with a paperclip for the file node, pale green with an arrow for the location node, distinct from the Location pin', () => {
    expect(lookOf('ask_file').bg).toBe('#FFE4D6');
    expect(lookOf('ask_location').bg).toBe('var(--flb-mint)');
    expect(lookOf('ask_location').icon).not.toBe(lookOf('location').icon);
    expect(lookOf('ask_file').icon).not.toBe(lookOf('ask').icon);
  });

  it('both have an inspector form registered', () => {
    expect(NODE_FORMS.ask_file).toBe(AskFileForm);
    expect(NODE_FORMS.ask_location).toBe(AskLocationForm);
  });
});

describe('the canvas cards', () => {
  const card = (n: FlowNode) =>
    renderToStaticMarkup(
      <NodeCard
        node={n}
        ctx={{ templates: [] } as never}
        portCtx={{}}
        selected={false}
        invalid={false}
        dragging={false}
        hoveredPort={null}
        onPointerDown={noop}
        onSelect={noop}
        onPortPointerDown={noop}
        onPortHover={noop}
      />,
    );

  it('Img/File: title, step number, prompt box with its toolbar, Allow Extensions row with the pencil, save-as-property with help', () => {
    const html = card(node('ask_file'));
    expect(html).toContain('cardTitle');
    expect(html).toContain('data-testid="ask-step-number"');
    expect(html).toContain('placeholder="promptPlaceholder"');
    expect(html).toContain('role="toolbar"');
    for (const tool of ['format', 'emoji', 'variable'])
      expect(html).toContain(`data-tool="${tool}"`);
    expect(html).toContain('allowExtensions');
    expect(html).toContain('anyFile');
    expect(html).toContain('data-testid="ask-extensions-edit"');
    expect(html).toContain('saveAsProperty');
    expect(html).toContain('data-testid="ask-help"');
    // one output dot, like Ask question without options; no input dot on a Trigger only
    expect(html.match(/data-port="out:/g)).toHaveLength(1);
    expect(html).toContain('data-port="in:n_7"');
  });

  it('Share Location: title, step number and the two dark-green buttons, not the Location send node', () => {
    const html = card(node('ask_location'));
    expect(html).toContain('cardTitle');
    expect(html).toContain('data-testid="ask-step-number"');
    expect(html).toContain('share');
    expect(html).toContain('current');
    expect(html.match(/data-location-button=/g)).toHaveLength(2);
    expect(html).toContain('bg-brand');
    expect(html.match(/data-port="out:/g)).toHaveLength(1);
  });

  it('the extension summary lists the saved extensions, or says any file', () => {
    const some = renderToStaticMarkup(
      <AskFileCardBody
        node={node('ask_file', { ...flbDefaultNodeData('ask_file'), extensions: ['pdf', 'png'] })}
      />,
    );
    expect(some).toContain('png, pdf');
    expect(renderToStaticMarkup(<AskFileCardBody node={node('ask_file')} />)).toContain('anyFile');
  });

  it('the property picker shows only once "save as property" is ticked, with the contact attributes', () => {
    const off = renderToStaticMarkup(<AskFileCardBody node={node('ask_file')} />);
    expect(off).not.toContain('data-testid="ask-property-select"');
    const on = renderToStaticMarkup(
      <AskFileCardBody
        node={node('ask_file', {
          ...flbDefaultNodeData('ask_file'),
          saveProperty: true,
          propertyKey: 'id_proof',
        })}
      />,
    );
    expect(on).toContain('data-testid="ask-property-select"');
    expect(on).toContain('ID proof');
    expect(on).toContain('checked=""');
  });

  it('the location card body stands alone too', () => {
    expect(renderToStaticMarkup(<AskLocationCardBody node={node('ask_location')} />)).toContain(
      'ask-location-card',
    );
  });
});

describe('the Allow Extensions panel', () => {
  it('lists every group with a header and a Select All box, and every extension in its group', () => {
    const html = renderToStaticMarkup(
      <ExtensionChecklist value={[]} onChange={noop} idPrefix="t" />,
    );
    for (const g of FLB_ASK_FILE_GROUPS) {
      expect(html).toContain(`data-ext-group="${g.id}"`);
      expect(html).toContain(`data-select-all="${g.id}"`);
      for (const e of g.extensions) expect(html).toContain(`data-ext="${e.ext}"`);
    }
    expect(html.match(/selectAll/g)).toHaveLength(4);
  });

  it('a group whose extensions are all selected has its Select All ticked; a partial one does not', () => {
    const all = renderToStaticMarkup(
      <ExtensionChecklist value={['jpg', 'jpeg', 'png']} onChange={noop} idPrefix="t" />,
    );
    expect(all).toMatch(/data-select-all="images"[^>]*checked/);
    expect(all).not.toMatch(/data-select-all="video"[^>]*checked/);
    const partial = renderToStaticMarkup(
      <ExtensionChecklist value={['jpg']} onChange={noop} idPrefix="t" />,
    );
    expect(partial).not.toMatch(/data-select-all="images"[^>]*checked/);
  });

  it('the panel is titled Img/File, has Cancel and Save, and Save is disabled until something changes', () => {
    const html = renderToStaticMarkup(
      <ExtensionsPanel saved={['pdf']} onSave={noop} onClose={noop} idPrefix="t" />,
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain('panelTitle');
    expect(html).toContain('data-action="cancel"');
    expect(html).toMatch(/data-action="save"[^>]*disabled/);
  });

  it('extensionsChanged ignores order, case and unknown extensions', () => {
    expect(extensionsChanged([], [])).toBe(false);
    expect(extensionsChanged(['png', 'pdf'], ['PDF', 'png', 'exe'])).toBe(false);
    expect(extensionsChanged(['png'], ['png', 'pdf'])).toBe(true);
    expect(extensionsChanged(['png'], [])).toBe(true);
  });
});

describe('the prompt box tools', () => {
  it('format wraps the selection in WhatsApp markers, or the caret when nothing is selected', () => {
    const bold = FORMAT_MARKS.find((m) => m.id === 'bold')!;
    expect(wrapSelection('hello world', 6, 11, bold.open, bold.close)).toEqual({
      text: 'hello *world*',
      start: 7,
      end: 12,
    });
    expect(wrapSelection('ab', 1, 1, '_', '_')).toEqual({ text: 'a__b', start: 2, end: 2 });
  });

  it('emoji and variable insert at the caret and replace a selection', () => {
    expect(insertAt('hi ', 3, 3, '👍')).toEqual({ text: 'hi 👍', start: 5, end: 5 });
    expect(insertAt('hi NAME', 3, 7, '{{name}}')).toEqual({
      text: 'hi {{name}}',
      start: 11,
      end: 11,
    });
    expect(EMOJIS.length).toBeGreaterThan(10);
  });
});

describe('the inspector forms', () => {
  it('Ask for file: question, extensions, variable, save as property, retries, wrong reply, skip, give up, wait limit', () => {
    const n = node('ask_file');
    const html = renderToStaticMarkup(<AskFileForm {...formProps(n)} />);
    for (const key of [
      'promptLabel',
      'allowExtensions',
      'data-testid="ask-extension-checklist"',
      'variableLabel',
      'saveAsProperty',
      'retriesLabel',
      'wrongReplyLabel',
      'skipLabel',
      'onFailLabel',
      'timeoutLabel',
    ])
      expect(html).toContain(key);
    // the variable hint names the real variables
    expect(html).toContain('{{file_status}}');
  });

  it('Ask for location: question, interactive flag, variable, wait settings', () => {
    const html = renderToStaticMarkup(<AskLocationForm {...formProps(node('ask_location'))} />);
    for (const key of [
      'promptLabel',
      'interactiveLabel',
      'variableLabel',
      'retriesLabel',
      'wrongReplyLabel',
      'skipLabel',
      'onFailLabel',
      'timeoutLabel',
    ])
      expect(html).toContain(key);
    expect(html).toContain('{{location_link}}');
    expect(html).toMatch(/type="checkbox"[^>]*checked/);
  });
});
