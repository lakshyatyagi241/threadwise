import { describe, expect, it } from 'vitest';
import {
  FLB_ASK_FILE_GROUPS,
  flbAskFileAccepts,
  flbAskFileSummary,
  flbCleanAskFileExtensions,
  flbDefaultNodeData,
  flbFileExtensionOf,
  flbHandleToPort,
  flbIsMultiPort,
  flbNormalizeGraph,
  flbPaletteFor,
  flbPortsFor,
  flbPreviewLabel,
  flbToRuntimeData,
  flbValidateGraph,
  FLB_NODE_TYPES,
  FLOW_EXPORT_MARKER,
  FLOW_TYPES,
} from '@crm/contracts';
import { parseImportPayload } from '../../../src/modules/flow-builder-editor/flow-rules';

/** TW-FLB-081, 082: Ask for file / image and Ask for location (an addition beyond Reference) at the contracts level. */

const TYPES = ['ask_file', 'ask_location'] as const;

describe('the two nodes in the catalogue', () => {
  it.each(TYPES)('%s: group Listen, not terminal, not hidden', (id) => {
    const d = FLB_NODE_TYPES[id]!;
    expect(d.group).toBe('Listen');
    // A file question also runs on the website chat (its window has an attach button); a location question is WhatsApp only.
    expect(d.modes).toEqual(id === 'ask_file' ? ['chat', 'web'] : ['chat']);
    expect(d.terminal).toBeFalsy();
    expect(d.hidden).toBeFalsy();
  });

  it('the labels are the ones asked for', () => {
    expect(FLB_NODE_TYPES.ask_file!.label).toBe('Ask for file / image');
    expect(FLB_NODE_TYPES.ask_location!.label).toBe('Ask for location');
  });

  it('the WhatsApp palette lists them right after Ask question; only the file question is also on website chat', () => {
    const chat = flbPaletteFor('chat').map((d) => d.id);
    const i = chat.indexOf('ask');
    expect(chat.slice(i, i + 3)).toEqual(['ask', 'ask_file', 'ask_location']);
    for (const mode of FLOW_TYPES.filter((m) => m !== 'chat')) {
      const ids = flbPaletteFor(mode).map((d) => d.id);
      if (mode === 'web') expect(ids).toContain('ask_file');
      else expect(ids).not.toContain('ask_file');
      expect(ids).not.toContain('ask_location');
    }
  });

  it.each(TYPES)('%s: one output port, whatever the data', (id) => {
    const ports = flbPortsFor({ type: id, data: flbDefaultNodeData(id) });
    expect(ports).toHaveLength(1);
    expect(ports[0]!.kind).toBe('flow');
    expect(flbPortsFor({ type: id, data: {} })).toHaveLength(1);
    expect(flbIsMultiPort({ type: id, data: flbDefaultNodeData(id) })).toBe(false);
    expect(flbHandleToPort(id, ports[0]!.id)).toBe(1);
  });

  it('the default data has every field the inspector edits', () => {
    expect(flbDefaultNodeData('ask_file')).toMatchObject({
      prompt: expect.any(String),
      extensions: [],
      var: 'file',
      retries: 2,
      onFail: 'continue',
      saveProperty: false,
    });
    expect(flbDefaultNodeData('ask_location')).toMatchObject({
      var: 'location',
      interactive: true,
      retries: 2,
    });
  });

  it('the preview label reads the prompt (file) or says Share Location', () => {
    expect(
      flbPreviewLabel({ type: 'ask_file', data: { prompt: 'Send your ID card please now' } }),
    ).toBe('Send your ID card please now');
    expect(flbPreviewLabel({ type: 'ask_file', data: {} })).toBe('Img/File');
    expect(flbPreviewLabel({ type: 'ask_location', data: {} })).toBe('Share Location');
  });
});

describe('save-time validation', () => {
  const nodes = (type: string) => [
    { id: 't', type: 'trigger', data: { deviceId: 'd' } },
    { id: 'a', type, data: flbDefaultNodeData(type) },
  ];
  const edges = [{ source: 't', target: 'a' }];

  it.each(TYPES)('%s passes on a WhatsApp flow', (type) => {
    expect(flbValidateGraph(nodes(type), edges, { mode: 'chat', senderAvailable: true }).ok).toBe(
      true,
    );
  });

  it.each(TYPES)('%s is flagged on an Instagram flow, and when nothing leads into it', (type) => {
    const ig = flbValidateGraph(nodes(type), edges, { mode: 'instagram', senderAvailable: true });
    expect(ig.ok).toBe(false);
    expect(ig.badNodeIds).toEqual(['a']);
    const orphan = flbValidateGraph(nodes(type), [], { mode: 'chat', senderAvailable: true });
    expect(orphan.items[0]).toContain('is not connected to anything');
  });
});

describe('import and export', () => {
  it('a flow with both nodes survives import: type, data and the edge from the single port', () => {
    const data = { ...flbDefaultNodeData('ask_file'), extensions: ['pdf', 'png'], var: 'doc' };
    const p = parseImportPayload({
      [FLOW_EXPORT_MARKER]: 1,
      name: 'Collect',
      flow_type: 'chat',
      category: null,
      flow_data: {
        flowNodes: [
          { id: 't', type: 'trigger', x: 0, y: 0, data: flbDefaultNodeData('trigger') },
          { id: 'f', type: 'ask_file', x: 1, y: 0, data },
          { id: 'l', type: 'ask_location', x: 2, y: 0, data: flbDefaultNodeData('ask_location') },
        ],
        flowEdges: [
          { id: 'e1', source: 't', target: 'f', sourceHandle: 'out' },
          { id: 'e2', source: 'f', target: 'l', sourceHandle: 'out' },
        ],
        vars: [],
      },
    });
    expect(p.graph.flowNodes.map((n) => n.type)).toEqual(['trigger', 'ask_file', 'ask_location']);
    expect(p.graph.flowNodes[1]!.data).toMatchObject({ extensions: ['pdf', 'png'], var: 'doc' });
    expect(p.graph.flowEdges).toHaveLength(2);
    // exporting is the same graph: normalising it again changes nothing
    expect(flbNormalizeGraph(p.graph)).toEqual(p.graph);
  });
});

describe('the allow-list', () => {
  it('every extension sits in its correct group', () => {
    const by = Object.fromEntries(
      FLB_ASK_FILE_GROUPS.map((g) => [g.id, g.extensions.map((e) => e.ext)]),
    );
    expect(by.images).toEqual(['jpg', 'jpeg', 'png']);
    expect(by.video).toEqual(['mp4', 'webm']);
    expect(by.audio).toEqual(expect.arrayContaining(['mp3', 'wav']));
    expect(by.documents).toEqual(
      expect.arrayContaining(['pdf', 'docx', 'xlsx', 'csv', 'doc', 'xls', 'ppt', 'pptx', 'txt']),
    );
  });

  it('cleans what was saved: lower case, no dot, known only, once, in panel order', () => {
    expect(flbCleanAskFileExtensions(['.PNG', 'pdf', 'pdf', 'exe', ' jpg '])).toEqual([
      'jpg',
      'png',
      'pdf',
    ]);
    expect(flbCleanAskFileExtensions('png, pdf')).toEqual(['png', 'pdf']);
    expect(flbCleanAskFileExtensions(undefined)).toEqual([]);
  });

  it('reads the extension of a name', () => {
    expect(flbFileExtensionOf('Report.Final.PDF')).toBe('pdf');
    expect(flbFileExtensionOf('noext')).toBe('');
    expect(flbFileExtensionOf('.hidden')).toBe('');
    expect(flbFileExtensionOf(null)).toBe('');
  });

  it('an empty list accepts anything; a list accepts by name or by mime', () => {
    expect(flbAskFileAccepts([], { name: 'x.exe', mime: 'application/x-msdownload' })).toBe(true);
    expect(flbAskFileAccepts(['pdf'], { name: 'a.PDF' })).toBe(true);
    expect(flbAskFileAccepts(['pdf'], { name: '', mime: 'application/pdf' })).toBe(true);
    expect(flbAskFileAccepts(['png'], { mime: 'image/jpeg' })).toBe(false);
    expect(flbAskFileAccepts(['jpg'], { mime: 'image/jpeg; charset=x' })).toBe(true);
    expect(flbAskFileAccepts(['pdf'], {})).toBe(false);
    expect(flbAskFileAccepts(['docx'], { mime: 'application/pdf', name: 'a.txt' })).toBe(false);
  });

  it('summarises for the card', () => {
    expect(flbAskFileSummary([])).toBe('Any file');
    expect(flbAskFileSummary(['pdf', 'png'])).toBe('png, pdf');
  });
});

describe('the runtime shape', () => {
  const shape = (type: string, data: Record<string, unknown>) => flbToRuntimeData({ type, data });

  it('ask_file: the question, the cleaned variable, the allow-list and the wait settings', () => {
    expect(
      shape('ask_file', {
        prompt: 'Send ID',
        var: '{{doc}}',
        extensions: ['PDF', 'bad'],
        retries: '3',
        wrongReply: '',
        skipKeyword: ' skip ',
        onFail: 'end',
        timeoutMinutes: 5,
        saveProperty: true,
        propertyKey: ' id_proof ',
      }),
    ).toMatchObject({
      question: 'Send ID',
      variable: 'doc',
      extensions: ['pdf'],
      maxRetries: 3,
      skipKeyword: 'skip',
      onGiveUp: 'end',
      timeoutMinutes: 5,
      savePropertyKey: 'id_proof',
    });
  });

  it('ask_file: the property key is dropped unless the box is ticked; limits are clamped; bad modes fall back', () => {
    expect(shape('ask_file', { propertyKey: 'k' }).savePropertyKey).toBe('');
    expect(shape('ask_file', { retries: 99 }).maxRetries).toBe(10);
    expect(shape('ask_file', { retries: -4 }).maxRetries).toBe(0);
    expect(shape('ask_file', { onFail: 'explode' }).onGiveUp).toBe('continue');
    expect(shape('ask_file', {}).wrongReplyText).toMatch(/not a file/);
  });

  it('ask_location: variable, interactive flag defaulting on, wait settings', () => {
    expect(shape('ask_location', {})).toMatchObject({
      variable: 'location',
      interactive: true,
      maxRetries: 2,
    });
    expect(shape('ask_location', { interactive: false, var: 'where' })).toMatchObject({
      interactive: false,
      variable: 'where',
    });
  });

  it.each(TYPES)('%s is idempotent and never mutates its input', (type) => {
    const data = { ...flbDefaultNodeData(type) };
    const frozen = JSON.stringify(data);
    const once = shape(type, data);
    expect(JSON.stringify(data)).toBe(frozen);
    expect(flbToRuntimeData({ type, data: once })).toEqual(once);
  });
});
