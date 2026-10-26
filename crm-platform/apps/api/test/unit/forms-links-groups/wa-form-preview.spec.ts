import { describe, expect, it, vi } from 'vitest';
import { WFL_ERROR_CODES } from '@crm/contracts';
import { WaFormFlowsClient } from '../../../src/infra/providers/forms-links-groups/wa-form-flows.client';
import { WaFormsService } from '../../../src/modules/forms-links-groups/wa-forms.service';
import { RequestContextStore } from '../../../src/common/context/request-context';

const conn = { wabaId: 'W1', accessToken: 'tok', provider: 'meta', registry: false } as never;

describe('the preview address of a Flow', () => {
  it('asks Meta for the preview of the flow and returns its address', async () => {
    const seen: Array<{ path: string; query?: unknown }> = [];
    const http = {
      graph: async (_b: string, req: { path: string; query?: unknown }) => {
        seen.push(req);
        return {
          preview: { preview_url: 'https://business.facebook.com/wa/manage/flows/F1/preview' },
        };
      },
    };
    const url = await new WaFormFlowsClient(http as never).previewUrl(conn, 'F1');
    expect(url).toBe('https://business.facebook.com/wa/manage/flows/F1/preview');
    expect(seen[0]).toMatchObject({ path: '/F1', query: { fields: 'preview.invalidate(false)' } });
  });
  it('is null when Meta gives no preview', async () => {
    const http = { graph: async () => ({}) };
    expect(await new WaFormFlowsClient(http as never).previewUrl(conn, 'F1')).toBeNull();
  });
});

function harness(over: { flowId?: string; preview?: string | null; errors?: unknown[] } = {}) {
  const form = {
    id: 7,
    uuid: 'u1',
    title: 'Enquiry',
    audience_type: 'lead_capture',
    send_button_label: 'Send',
    meta_flow_id: null as string | null,
    provider_config_id: null,
    definition_json: {
      screens: [
        {
          id: 'A',
          title: 'A',
          fields: [{ id: 'f1', kind: 'text', label: 'Name', required: false }],
        },
      ],
    },
  };
  const saved: string[] = [];
  const flows = {
    ensureFlow: vi.fn(async () => ({ flowId: over.flowId ?? 'F9' })),
    uploadFlowJson: vi.fn(async () => ({ validationErrors: over.errors ?? [] })),
    previewUrl: vi.fn(async () => (over.preview === undefined ? 'https://p/x' : over.preview)),
    publish: vi.fn(),
  };
  const db = { tx: async (fn: (tx: unknown) => unknown) => fn({}) };
  const repo = {
    findByUuid: async () => form,
    wabaProviderConfigIds: async () => [3],
    saveFlowId: async (_tx: unknown, _o: number, _id: number, flowId: string) => {
      saved.push(flowId);
    },
  };
  const connections = {
    resolveConnection: async () => ({
      conn: { wabaId: 'W1', accessToken: 't', provider: 'meta', registry: false },
    }),
  };
  const service = new WaFormsService(
    db as never,
    repo as never,
    {} as never,
    {} as never,
    connections as never,
    flows as never,
  );
  const run = <T>(fn: () => Promise<T>) =>
    RequestContextStore.run({ orgId: 1, userId: 2 } as never, fn);
  return { service, flows, saved, run };
}

describe('Test form before publishing', () => {
  it('sends the draft to Meta, remembers the Flow id and returns the preview, publishing nothing', async () => {
    const h = harness();
    const out = await h.run(() => h.service.preview('u1'));
    expect(out).toEqual({ url: 'https://p/x', flowId: 'F9' });
    expect(h.saved).toEqual(['F9']);
    expect(h.flows.uploadFlowJson).toHaveBeenCalledTimes(1);
    expect(h.flows.publish).not.toHaveBeenCalled();
  });
  it('says why when Meta refuses the definition', async () => {
    const h = harness({ errors: [{ error: 'X', message: 'Bad component', line: 4 }] });
    await expect(h.run(() => h.service.preview('u1'))).rejects.toMatchObject({
      code: WFL_ERROR_CODES.WFL_FORM_META_VALIDATION_FAILED,
    });
  });
  it('says so when Meta gives no preview', async () => {
    const h = harness({ preview: null });
    await expect(h.run(() => h.service.preview('u1'))).rejects.toMatchObject({
      code: WFL_ERROR_CODES.WFL_FORM_PREVIEW_FAILED,
    });
  });
});
