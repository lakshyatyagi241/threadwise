import { describe, expect, it, vi } from 'vitest';
import {
  FLB_NODE_TYPES,
  flbDefaultNodeData,
  flbHandleToPort,
  flbPaletteFor,
  flbPortsFor,
  flbToRuntimeData,
  flbValidateGraph,
} from '@crm/contracts';
import { compileGraph } from '../../../src/modules/flow-runtime-engine/graph/compile-graph';
import {
  runApiLibrary,
  type ApiLibraryNodeDeps,
} from '../../../src/modules/flow-runtime-engine/runtime/nodes/integrations/api-library-node';
import type { NodeContext, RunState } from '../../../src/modules/flow-runtime-engine/runtime/types';
import { interpolate } from '../../../src/modules/flow-runtime-engine/runtime/variables';
import type { RunOutcome } from '../../../src/modules/api-library/api-library-runner.service';
import type { FlowApiResult } from '../../../src/modules/api-library';

const API_ID = '9b6c7a52-0d6e-4c7d-9a65-3c1d6b1f0a11';

function setup(opts: {
  data?: Record<string, unknown>;
  vars?: Record<string, unknown>;
  contactId?: number | null;
  result?: FlowApiResult | Error;
  contactFields?: Record<string, string>;
  writable?: string[];
}) {
  const notes: string[] = [];
  const vars: Record<string, unknown> = { ...(opts.vars ?? {}) };
  const run = {
    id: 5,
    uuid: 'run-uuid',
    orgId: 7,
    flowId: 3,
    contactId: opts.contactId === undefined ? 11 : opts.contactId,
    contactUuid: 'contact-uuid',
    vars,
  } as unknown as RunState;
  const ctx: NodeContext = {
    run,
    stepKey: 'k',
    node: {
      id: 'n1',
      type: 'ApiLibrary',
      props: {
        data: {
          apiId: API_ID,
          apiName: 'Orders',
          inputs: [],
          variable: 'api_response',
          ...opts.data,
        },
      },
    },
    send: async () => ({ ok: true }),
    render: (t) => interpolate(t, vars),
    note: (t) => void notes.push(t),
    now: () => new Date(),
  };
  const runFn = vi.fn(async (_input: unknown) => {
    if (opts.result instanceof Error) throw opts.result;
    return opts.result ?? ({ found: false } as FlowApiResult);
  });
  const written: Array<[string, string]> = [];
  const deps: ApiLibraryNodeDeps = {
    run: runFn as unknown as ApiLibraryNodeDeps['run'],
    recordMissing: vi.fn(async () => undefined),
    readContactField: vi.fn(async (_o, _c, key) => opts.contactFields?.[key] ?? null),
    writeContactField: vi.fn(async (_o, _c, key, value) => {
      if (opts.writable && !opts.writable.includes(key)) return null;
      written.push([key, value]);
      return { stored: value };
    }),
  };
  return { ctx, deps, notes, vars, runFn, written };
}

const okOutcome = (json: unknown, over: Partial<RunOutcome> = {}): RunOutcome => ({
  ok: true,
  status: 200,
  durationMs: 12,
  errorKind: null,
  error: null,
  request: null,
  response: {
    headers: {},
    contentType: 'application/json',
    bodyText: JSON.stringify(json),
    bodyJson: json,
    truncated: false,
    sizeBytes: 10,
  },
  processedPayload: null,
  ...over,
});

const found = (
  outcome: RunOutcome,
  api: Partial<Extract<FlowApiResult, { found: true }>['api']> = {},
): FlowApiResult => ({
  found: true,
  api: { id: API_ID, name: 'Orders', mapping: [], responseVariables: [], variables: [], ...api },
  outcome,
});

describe('the API (from library) node', () => {
  it('on a 2xx saves the answer, the exposed fields and the mapped contact properties, and leaves by success', async () => {
    const t = setup({
      result: found(okOutcome({ data: { id: 42, name: 'Ada', city: '' } }), {
        responseVariables: ['data.id'],
        mapping: [
          { path: 'data.name', contactProperty: 'first_name', defaultValue: '' },
          { path: 'data.city', contactProperty: 'city', defaultValue: 'Pune' },
        ],
      }),
    });
    const res = await runApiLibrary(t.ctx, t.deps);
    expect(res).toEqual({ kind: 'advance', port: 1, branch: true });
    expect(JSON.parse(t.vars.api_response as string)).toEqual({
      data: { id: 42, name: 'Ada', city: '' },
    });
    expect(t.vars['api_response.data.name']).toBe('Ada');
    expect(t.vars['api_response.status']).toBe(200);
    expect(t.vars['Orders.data.id']).toBe(42);
    expect(t.written).toEqual([
      ['first_name', 'Ada'],
      ['city', 'Pune'],
    ]);
    expect(t.vars.first_name).toBe('Ada');
  });

  it('hands the run the node inputs rendered against the run, the run variables, then the contact', async () => {
    const t = setup({
      data: {
        inputs: [
          { name: 'order_id', value: '{{id}}' },
          { name: 'skipped', value: '' },
        ],
      },
      vars: { id: '99', email: 'in-run@x.test' },
      contactFields: { phone: '+91 98' },
      result: found(okOutcome({})),
    });
    await runApiLibrary(t.ctx, t.deps);
    const call = t.runFn.mock.calls[0]![0] as unknown as Parameters<ApiLibraryNodeDeps['run']>[0];
    expect(call).toMatchObject({ orgId: 7, apiId: API_ID });
    expect(call.overrides).toEqual({ order_id: '99', skipped: '' });
    expect(call.context).toEqual({
      contactUuid: 'contact-uuid',
      flowId: 3,
      flowRunUuid: 'run-uuid',
      flowNodeId: 'n1',
    });
    expect(await call.lookup('email')).toBe('in-run@x.test');
    expect(await call.lookup('phone')).toBe('+91 98');
    expect(await call.lookup('nothing')).toBeUndefined();
  });

  it('a failed call leaves by error with the status and reason in the variables', async () => {
    const t = setup({
      vars: { api_response: 'old' },
      result: found(
        okOutcome(
          {},
          { ok: false, status: 500, errorKind: 'status', error: 'The server answered HTTP 500.' },
        ),
        { mapping: [{ path: 'a', contactProperty: 'city', defaultValue: 'x' }] },
      ),
    });
    expect(await runApiLibrary(t.ctx, t.deps)).toEqual({ kind: 'advance', port: 2, branch: true });
    expect(t.vars).toMatchObject({
      api_response: '',
      'api_response.status': 500,
      'api_response.error': 'The server answered HTTP 500.',
    });
    expect(t.written).toEqual([]);
    expect(t.notes.join('\n')).toContain('failed (status)');
  });

  it('a blocked address, an API that is gone, no API chosen, or a crash all leave by error', async () => {
    const blocked = setup({
      result: found(
        okOutcome({}, { ok: false, status: null, errorKind: 'blocked', error: 'private' }),
      ),
    });
    expect((await runApiLibrary(blocked.ctx, blocked.deps)).kind).toBe('advance');
    expect(blocked.vars['api_response.status']).toBe(0);

    const gone = setup({ result: { found: false } });
    expect(await runApiLibrary(gone.ctx, gone.deps)).toMatchObject({ port: 2 });
    expect(gone.deps.recordMissing).toHaveBeenCalledOnce();

    const none = setup({ data: { apiId: '' } });
    expect(await runApiLibrary(none.ctx, none.deps)).toMatchObject({ port: 2 });
    expect(none.runFn).not.toHaveBeenCalled();

    const crash = setup({ result: new Error('db down') });
    expect(await runApiLibrary(crash.ctx, crash.deps)).toMatchObject({ port: 2 });
    expect(crash.vars['api_response.error']).toContain('db down');
  });

  it('a run with no contact still succeeds; the mapping is skipped and says so; a refused property is skipped too', async () => {
    const mapping = [{ path: 'a', contactProperty: 'city', defaultValue: '' }];
    const noContact = setup({ contactId: null, result: found(okOutcome({ a: 'x' }), { mapping }) });
    expect(await runApiLibrary(noContact.ctx, noContact.deps)).toMatchObject({ port: 1 });
    expect(noContact.written).toEqual([]);
    expect(noContact.notes.join('\n')).toContain('no contact');

    const refused = setup({ writable: [], result: found(okOutcome({ a: 'x' }), { mapping }) });
    expect(await runApiLibrary(refused.ctx, refused.deps)).toMatchObject({ port: 1 });
    expect(refused.notes.join('\n')).toContain('could not be set');
    expect(refused.vars.city).toBeUndefined();
  });
});

describe('the node in the catalogue and the graph', () => {
  it('is an Integrations node for WhatsApp flows only, with success and error ports', () => {
    expect(FLB_NODE_TYPES.api_library).toMatchObject({
      label: 'API (from library)',
      group: 'Integrations',
      modes: ['chat'],
    });
    expect(flbPaletteFor('chat').map((d) => d.id)).toContain('api_library');
    for (const m of ['instagram', 'facebook', 'telegram', 'call'] as const)
      expect(flbPaletteFor(m).map((d) => d.id)).not.toContain('api_library');
    expect(flbPortsFor({ type: 'api_library' }).map((p) => p.id)).toEqual(['success', 'error']);
    expect(flbHandleToPort('api_library', 'success')).toBe(1);
    expect(flbHandleToPort('api_library', 'error')).toBe(2);
    expect(flbDefaultNodeData('api_library')).toEqual({
      apiId: '',
      apiName: '',
      inputs: [],
      save: 'api_response',
    });
  });

  it('shapes the editor data for the runtime and compiles to the ApiLibrary node with its two ports', () => {
    expect(
      flbToRuntimeData({
        type: 'api_library',
        data: {
          apiId: API_ID,
          apiName: 'Orders',
          inputs: [{ name: ' order_id ', value: '{{id}}' }, { name: '' }],
          save: '{{res}}',
        },
      }),
    ).toMatchObject({
      apiId: API_ID,
      inputs: [{ name: 'order_id', value: '{{id}}' }],
      variable: 'res',
    });
    const g = compileGraph({
      flowNodes: [
        { id: 't', type: 'trigger', data: {} },
        { id: 'a', type: 'api_library', data: { apiId: API_ID } },
        { id: 'ok', type: 'end', data: {} },
        { id: 'bad', type: 'end', data: {} },
      ],
      flowEdges: [
        { source: 't', sourceHandle: 'out', target: 'a' },
        { source: 'a', sourceHandle: 'success', target: 'ok' },
        { source: 'a', sourceHandle: 'error', target: 'bad' },
      ],
    });
    expect(g.nodes.find((n) => n.id === 'a')?.type).toBe('ApiLibrary');
    expect(g.edges).toContainEqual({ from: 'a_1', to: 'ok' });
    expect(g.edges).toContainEqual({ from: 'a_2', to: 'bad' });
  });

  it('save-time validation flags a node that names no API, and nothing else changes', () => {
    const base = [{ id: 't', type: 'trigger', data: { deviceId: 'd' } }];
    const edges = [{ source: 't', target: 'a' }];
    const ctx = { mode: 'chat' as const, senderAvailable: true };
    const bad = flbValidateGraph(
      [...base, { id: 'a', type: 'api_library', data: { apiId: '' } }],
      edges,
      ctx,
    );
    expect(bad.ok).toBe(false);
    expect(bad.badNodeIds).toEqual(['a']);
    expect(bad.items).toEqual([
      '"API (from library)" has no API selected — pick one of your saved APIs.',
    ]);
    expect(
      flbValidateGraph(
        [...base, { id: 'a', type: 'api_library', data: { apiId: API_ID } }],
        edges,
        ctx,
      ).ok,
    ).toBe(true);
    const onInstagram = flbValidateGraph(
      [...base, { id: 'a', type: 'api_library', data: { apiId: API_ID } }],
      edges,
      {
        mode: 'instagram',
        senderAvailable: true,
      },
    );
    expect(onInstagram.items[0]).toContain('does not work on Instagram');
  });
});
