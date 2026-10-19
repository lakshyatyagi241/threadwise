import { describe, expect, it } from 'vitest';
import type { FlbBuilderContext } from '@crm/contracts';
import { renderIntl } from '../test-utils/intl';
import { FlowEditorContext } from '../lib/flow-editor-context';
import type { ButtonAction } from '../lib/button-actions';
import { ButtonActionPicker } from './button-action-picker';

const ctx = {
  flows: [
    { id: 'f-self', name: 'This flow', flowType: 'chat', isPublished: false },
    { id: 'f-live', name: 'Support menu', flowType: 'chat', isPublished: true },
    { id: 'f-web', name: 'Website helper', flowType: 'web', isPublished: true },
  ],
  teams: [{ id: 't1', name: 'Sales', members: [{}, {}] }],
} as unknown as FlbBuilderContext;

const show = (value: ButtonAction) =>
  renderIntl(
    <ButtonActionPicker value={value} onChange={() => undefined} ctx={ctx} flowId="f-self" />,
  );

describe('ButtonActionPicker: what a button does when it is pressed', () => {
  it('offers the four actions beside "go to the next step"', () => {
    const html = show({ kind: 'none' });
    expect(html).toContain('Button pressed action');
    for (const l of ['Go to the next step', 'Connect flow', 'Live agent', 'Opt in', 'Opt out'])
      expect(html).toContain(l);
    expect(html).not.toContain('Pick a flow');
  });

  it('Connect flow lists the other flows (never the one being edited) and keeps a saved pick that is gone', () => {
    const html = show({ kind: 'flow', flow: '' });
    expect(html).toContain('Pick a flow');
    expect(html).toContain('Support menu');
    expect(html).not.toContain('This flow');
    expect(show({ kind: 'flow', flow: 'deadbeef-0000' })).toContain('not found');
  });

  it('Live agent asks for the team and a note; Opt in and Opt out say what they change', () => {
    const agent = show({ kind: 'live_agent', team: '', message: '' });
    expect(agent).toContain('Sales');
    expect(agent).toContain('Nothing is connected after this button.');
    expect(show({ kind: 'opt_in' })).toContain('subscribed to marketing messages');
    expect(show({ kind: 'opt_out' })).toContain('unsubscribed from marketing messages');
  });

  it('a website chat bot has no marketing consent to change, so Opt in and Opt out are not offered', () => {
    const html = renderIntl(
      <FlowEditorContext.Provider value={{ flowId: 'f1', web: true }}>
        <ButtonActionPicker
          value={{ kind: 'none' }}
          onChange={() => undefined}
          ctx={ctx}
          flowId="f1"
        />
      </FlowEditorContext.Provider>,
    );
    expect(html).toContain('Live agent');
    expect(html).not.toContain('Opt in');
    expect(html).not.toContain('Opt out');
  });

  it('lists only bots of the same channel: a WhatsApp bot never sees a website chat bot, and the other way round', () => {
    const asChannel = (channel: string) =>
      renderIntl(
        <FlowEditorContext.Provider value={{ flowId: 'f-self', web: channel === 'web', channel }}>
          <ButtonActionPicker
            value={{ kind: 'flow', flow: '' }}
            onChange={() => undefined}
            ctx={ctx}
            flowId="f-self"
          />
        </FlowEditorContext.Provider>,
      );
    const whatsapp = asChannel('chat');
    expect(whatsapp).toContain('Support menu');
    expect(whatsapp).not.toContain('Website helper');
    const web = asChannel('web');
    expect(web).toContain('Website helper');
    expect(web).not.toContain('Support menu');
  });
});
