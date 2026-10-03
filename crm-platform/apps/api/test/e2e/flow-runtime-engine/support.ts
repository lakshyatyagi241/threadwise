import { randomUUID } from 'node:crypto';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { Api, startHarness, type Harness, type Tenant } from '../contacts-attributes-tags/support';
import { simChannel, until, type SimChannel } from '../chat-conversations/pipeline-support';

export { Api, until, type Tenant, type SimChannel };

/**
 * The flow runtime end to end: the real API, the inbox's worker side (ingest, dispatch) and the flow runtime's worker side (the step
 * processor, the sweeper, the inbound listener, the event consumer) in the same process, over real Postgres (restricted role), real
 * Redis and real BullMQ. A flow is arranged straight in the `flows` table (the editor is another domain), then driven by what a customer
 * does: a message on a simulator channel.
 */
export interface FlowPipeline {
  h: Harness;
  api: Api;
  stop(): Promise<void>;
}

export async function startFlowPipeline(): Promise<FlowPipeline> {
  process.env.CHANNEL_SIMULATOR_ENABLED = 'true';
  const h = await startHarness({
    loadModules: async () => [
      (await import('../../../src/modules/chat-conversations/chat-conversations-worker.module'))
        .ChatConversationsWorkerModule,
      (await import('../../../src/modules/flow-runtime-engine')).FlowRuntimeEngineWorkerModule,
    ],
  });
  await h.app.listen(0, '127.0.0.1');
  return { h, api: new Api(h), stop: () => h.stop() };
}

// --- arranging a flow --------------------------------------------------------------------------------------------------------

export const node = (
  id: string,
  type: string,
  data: Record<string, unknown> = {},
  extra: object = {},
) => ({
  id,
  type,
  data,
  ...extra,
});
export const edge = (source: string, target: string, sourceHandle = 'out') => ({
  source,
  sourceHandle,
  target,
});
export const graph = (nodes: unknown[], edges: unknown[]) => ({
  flowNodes: nodes,
  flowEdges: edges,
  vars: {},
});

export interface FlowSpec {
  name?: string;
  graph: unknown;
  trigger?: {
    kind: string;
    value?: number | null;
    keywords?: string | null;
    channelId?: number | null;
  };
  published?: boolean;
  active?: boolean;
  provider?: string;
}

export async function addFlow(
  p: FlowPipeline,
  t: Tenant,
  spec: FlowSpec,
): Promise<{ id: number; uuid: string }> {
  const trig = spec.trigger ?? { kind: 'keyword', keywords: 'hello' };
  const res = await p.h.owner.query(
    `INSERT INTO flows (org_id, flow_name, flow_data, trigger_kind, trigger_value, trigger_keywords, trigger_channel_id, is_published,
                        is_active, provider, flow_type)
     VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9, $10, 'chat') RETURNING id, uuid`,
    [
      t.orgId,
      spec.name ?? `Flow ${randomUUID().slice(0, 6)}`,
      JSON.stringify(spec.graph),
      trig.kind,
      trig.value ?? null,
      trig.keywords ?? null,
      trig.channelId ?? null,
      spec.published ?? true,
      spec.active ?? true,
      spec.provider ?? 'simulator',
    ],
  );
  return { id: Number(res.rows[0].id), uuid: String(res.rows[0].uuid) };
}

export const system = <T>(orgId: number, fn: () => Promise<T>) =>
  RequestContextStore.run(
    { requestId: 'spec-system', orgId, actorType: 'system', actorId: null, userId: null },
    fn,
  );

// --- looking ----------------------------------------------------------------------------------------------------------------

export interface RunRow {
  id: number;
  uuid: string;
  status: string;
  end_reason: string | null;
  failure_reason: string | null;
  source: string;
  wait: { nodeId: string } | null;
  vars: Record<string, unknown>;
  current_node_id: string | null;
  step_seq: number;
  peer_key: string;
  subscriber_id: number | null;
}

export async function runsOf(p: FlowPipeline, t: Tenant, flowId: number): Promise<RunRow[]> {
  const r = await p.h.owner.query(
    `SELECT * FROM flow_runs WHERE org_id = $1 AND flow_id = $2 ORDER BY id`,
    [t.orgId, flowId],
  );
  return r.rows as RunRow[];
}

export async function untilRun(
  p: FlowPipeline,
  t: Tenant,
  flowId: number,
  label: string,
  ok: (r: RunRow) => boolean,
  ms = 20_000,
): Promise<RunRow> {
  return until(label, async () => (await runsOf(p, t, flowId)).slice(-1).find(ok), ms);
}

/** What the customer received on the channel, in order, as the thread shows it. */
export async function sentTo(
  p: FlowPipeline,
  t: Tenant,
  ch: SimChannel,
  peer: string,
): Promise<string[]> {
  const r = await p.h.owner.query(
    `SELECT m.body FROM messages m JOIN conversations c ON c.org_id = m.org_id AND c.id = m.conversation_id
     WHERE c.org_id = $1 AND c.channel_id = $2 AND c.peer_key = $3 AND m.direction = 'out' ORDER BY m.seq`,
    [t.orgId, ch.internalId, peer],
  );
  return r.rows.map((x) => String(x.body));
}

export async function untilSent(
  p: FlowPipeline,
  t: Tenant,
  ch: SimChannel,
  peer: string,
  count: number,
  ms = 20_000,
): Promise<string[]> {
  return until(
    `${count} messages sent to ${peer}`,
    async () => {
      const got = await sentTo(p, t, ch, peer);
      return got.length >= count ? got : undefined;
    },
    ms,
  );
}

export { simChannel };

// --- the services under test, loaded late ------------------------------------------------------------------------------------
// The module graph has an import cycle, and which file is read first decides whether Nest can build it. The app module must be the
// first thing loaded (the harness does that), so a spec reaches the services through these, never through a top-level import.

export const ingestService = async (p: FlowPipeline) =>
  p.h.app.get(
    (await import('../../../src/modules/chat-conversations/inbound-ingest.service'))
      .InboundIngestService,
  );
export const sweeper = async (p: FlowPipeline) =>
  p.h.app.get(
    (await import('../../../src/modules/flow-runtime-engine/runtime/flow-sweeper.service'))
      .FlowSweeperService,
  );
export const engineOf = async (p: FlowPipeline) =>
  p.h.app.get(
    (await import('../../../src/modules/flow-runtime-engine/runtime/engine.service')).FlowEngine,
  );
export const eventsConsumer = async (p: FlowPipeline) =>
  p.h.app.get(
    (await import('../../../src/modules/flow-runtime-engine/triggers/trigger-events.consumer'))
      .FlowTriggerEventsConsumer,
  );

/**
 * A simulator channel whose 24 hour window is always open. A flow started by enrolment, an event or a campaign writes to someone who
 * has not written first, and a free-form message outside the window is refused (on the Cloud API only a template may open the
 * conversation), so these specs open the window instead of arranging a customer message.
 */
export const openChannel = (p: FlowPipeline, t: Tenant): Promise<SimChannel> =>
  simChannel(p as never, t, {
    simulator: { latencyMs: { sent: 0, delivered: 150, read: 400 }, window: 'open' },
  });
