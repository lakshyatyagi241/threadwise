import { describe, expect, it } from 'vitest';
import type { WaFormDefinition } from '@crm/contracts';
import {
  buildMetaFlowJson,
  mediaPickerProblems,
} from '../../../src/infra/providers/forms-links-groups/wa-form-flow-json';
import { toWaFormSubmissionResponse } from '../../../src/modules/forms-links-groups/wa-forms.mapper';
import {
  fileAnswersOf,
  flattenAnswer,
} from '../../../src/modules/flow-runtime-engine/runtime/nodes/commerce/wa-form-records';

const def: WaFormDefinition = {
  screens: [
    {
      id: 's1',
      fields: [
        { id: 'name', kind: 'short_text', label: 'Name', required: true },
        { id: 'pic', kind: 'photo', label: 'ID photo', required: true },
      ],
    },
    {
      id: 's2',
      fields: [{ id: 'doc', kind: 'document', label: 'Proof', required: false }],
    },
  ],
};

type Json = Record<string, unknown>;
const screensOf = (d: WaFormDefinition) =>
  (buildMetaFlowJson(d, 'Send') as { screens: Json[] }).screens;
const formChildren = (screen: Json) =>
  ((screen.layout as Json).children as Json[])[0]!.children as Json[];

describe('WhatsApp Form file uploads', () => {
  it('sends Photo and Document fields as Meta pickers', () => {
    const [a, b] = screensOf(def);
    const pic = formChildren(a!).find((c) => c.name === 'pic')!;
    expect(pic).toMatchObject({ type: 'PhotoPicker', 'min-uploaded-photos': 1 });
    const doc = formChildren(b!).find((c) => c.name === 'doc')!;
    expect(doc).toMatchObject({ type: 'DocumentPicker', 'min-uploaded-documents': 0 });
  });

  it('keeps pickers out of the navigate payload and reads them on the last screen', () => {
    const [a, b] = screensOf(def);
    const next = formChildren(a!).find((c) => c.type === 'Footer')!['on-click-action'] as Json;
    expect(next.payload).toEqual({ name: '${form.name}' });
    const done = formChildren(b!).find((c) => c.type === 'Footer')!['on-click-action'] as Json;
    expect(done.payload).toEqual({
      name: '${form.name}',
      pic: '${screen.SCREEN_A.form.pic}',
      doc: '${screen.SCREEN_B.form.doc}',
    });
  });

  it('refuses two upload fields on one screen', () => {
    expect(mediaPickerProblems(def)).toEqual([]);
    const bad: WaFormDefinition = {
      screens: [
        {
          id: 's1',
          fields: [
            { id: 'a', kind: 'photo', label: 'A', required: false },
            { id: 'b', kind: 'document', label: 'B', required: false },
          ],
        },
      ],
    };
    expect(mediaPickerProblems(bad)).toHaveLength(1);
  });

  it('finds file answers in a response and shows their names', () => {
    const entry = { file_name: 'id.jpg', mime_type: 'image/jpeg', sha256: 'x', id: '123' };
    const answers = { pic: [entry], name: 'Asha' };
    expect(fileAnswersOf(answers)).toEqual({ pic: [entry] });
    expect(flattenAnswer([entry])).toBe('id.jpg');
  });

  it('gives a stored file a link and a failed one none', () => {
    const r = toWaFormSubmissionResponse(
      {
        uuid: '00000000-0000-4000-8000-000000000001',
        contact_uuid: null,
        contact_name: null,
        contact_phone: null,
        caller_phone: '1',
        answers_json: {
          pic: [
            { file_name: 'a.jpg', mime_type: 'image/jpeg', key: 'k1', size: 10 },
            { file_name: 'b.jpg', mime_type: 'image/jpeg', failed: true },
          ],
        },
        submitted_at: null,
        created_at_iso: '2026-10-30T00:00:00Z',
      },
      (key) => `/v2/media/${key}`,
    );
    expect(r.answers.pic).toBe('a.jpg, b.jpg');
    expect(r.files.pic).toEqual([
      { name: 'a.jpg', mime: 'image/jpeg', size: 10, url: '/v2/media/k1' },
      { name: 'b.jpg', mime: 'image/jpeg', size: null, url: null },
    ]);
  });
});
