import { describe, expect, it } from 'vitest';
import { WaFormFlowsClient } from '../../../src/infra/providers/forms-links-groups/wa-form-flows.client';
import { statusFromMeta } from '../../../src/modules/forms-links-groups/wa-forms.service';

const conn = { wabaId: 'W1', accessToken: 'tok', provider: 'meta', registry: false } as never;

describe('Sync with Meta', () => {
  it('maps a Flow status to a form status', () => {
    expect(statusFromMeta('PUBLISHED')).toBe('published');
    expect(statusFromMeta('DRAFT')).toBe('draft');
    expect(statusFromMeta('DEPRECATED')).toBe('paused');
    expect(statusFromMeta('BLOCKED')).toBe('paused');
    expect(statusFromMeta('THROTTLED')).toBe('paused');
  });

  it("reads every page of the account's Flows", async () => {
    const calls: string[] = [];
    const http = {
      graph: async (_b: string, req: { path: string }) => {
        calls.push(req.path);
        return {
          data: [{ id: '1', name: 'A', status: 'PUBLISHED' }],
          paging: { next: 'https://graph.facebook.com/v23.0/W1/flows?after=x' },
        };
      },
      absolute: async (url: string) => {
        calls.push(url);
        return { data: [{ id: '2', name: 'B', status: 'DRAFT' }, { name: 'no id' }] };
      },
    };
    const flows = await new WaFormFlowsClient(http as never).listFlows(conn);
    expect(flows).toEqual([
      { id: '1', name: 'A', status: 'PUBLISHED' },
      { id: '2', name: 'B', status: 'DRAFT' },
    ]);
    expect(calls).toEqual(['/W1/flows', 'https://graph.facebook.com/v23.0/W1/flows?after=x']);
  });

  it('refuses a connection that is not a direct Meta one', async () => {
    await expect(
      new WaFormFlowsClient({} as never).listFlows({
        ...(conn as object),
        registry: true,
      } as never),
    ).rejects.toThrow(/Meta/);
  });
});
