import { describe, expect, it } from 'vitest';
import type { FlowNode } from '@crm/contracts';
import { renderIntl } from '../test-utils/intl';
import { FlowEditorContext } from '../lib/flow-editor-context';
import { INLINE_EDIT_TYPES, InlineEditBody } from './inline-edit-body';

const node = (type: string, data: Record<string, unknown>): FlowNode =>
  ({ id: 'n1', type, x: 0, y: 0, data }) as FlowNode;

const show = (n: FlowNode, whatsapp = false) =>
  renderIntl(
    <FlowEditorContext.Provider value={{ flowId: 'f1', web: false, whatsapp } as never}>
      <InlineEditBody node={n} onPatch={() => undefined} />
    </FlowEditorContext.Provider>,
  );

describe('inline edit on the card (row 288)', () => {
  it('covers the message, quick-reply and media node types, and no others', () => {
    expect([...INLINE_EDIT_TYPES].sort()).toEqual(['buttons', 'media', 'message']);
  });

  it('shows a message text as an editable text area', () => {
    const html = show(node('message', { text: 'Hi there' }));
    expect(html).toContain('<textarea');
    expect(html).toContain('Hi there');
  });

  it('shows each quick-reply label as its own field, named by its number', () => {
    const html = show(node('buttons', { options: ['Yes', 'No'] }));
    expect(html).toContain('value="Yes"');
    expect(html).toContain('value="No"');
    expect(html.match(/<input/g)).toHaveLength(2);
  });

  it('caps the labels and the text at the WhatsApp limits on a WhatsApp flow only', () => {
    const wa = show(node('buttons', { options: ['Yes'] }), true);
    expect(wa).toContain('maxLength="20"');
    const web = show(node('buttons', { options: ['Yes'] }), false);
    expect(web).not.toContain('maxLength');
  });

  it('shows a media card with a file picker for its kind above the caption field', () => {
    const html = show(node('media', { kind: 'image', caption: 'Look' }));
    expect(html).toContain('type="file"');
    expect(html).toContain('accept="image/*"');
    expect(html).toContain('Choose image');
    expect(html).toContain('>Look<');
    expect(html.indexOf('type="file"')).toBeLessThan(html.indexOf('>Look<'));
  });

  it('offers Replace file once the card has a file, and names it', () => {
    const html = show(
      node('media', { kind: 'video', url: 'https://x.test/a.mp4', filename: 'a.mp4' }),
    );
    expect(html).toContain('accept="video/*"');
    expect(html).toContain('Replace file');
    expect(html).toContain('a.mp4');
  });
});
