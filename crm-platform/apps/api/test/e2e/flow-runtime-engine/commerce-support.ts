import { randomUUID } from 'node:crypto';
import { ingestService, system, type FlowPipeline, type SimChannel, type Tenant } from './support';

/** Helpers of the commerce node group's specs (Template, Book appointment, Shop, WhatsApp Form). */

export async function addTemplate(
  p: FlowPipeline,
  t: Tenant,
  spec: {
    name: string;
    body: string;
    status?: string;
    header?: string | null;
    footer?: string | null;
    buttons?: unknown[];
    variableMap?: unknown;
    language?: string;
  },
): Promise<{ id: number; uuid: string }> {
  const r = await p.h.owner.query(
    `INSERT INTO wa_templates (org_id, template_name, template_body, header, footer, buttons, variable_map, language, status, meta_category)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, 'UTILITY') RETURNING id, uuid`,
    [
      t.orgId,
      spec.name,
      spec.body,
      spec.header ?? null,
      spec.footer ?? null,
      JSON.stringify(spec.buttons ?? []),
      JSON.stringify(spec.variableMap ?? {}),
      spec.language ?? 'en_US',
      spec.status ?? 'approved',
    ],
  );
  return { id: Number(r.rows[0].id), uuid: String(r.rows[0].uuid) };
}

/** A customer's tap (or any interactive message) straight into the inbound pipeline. */
export async function interactiveIn(
  p: FlowPipeline,
  t: Tenant,
  ch: SimChannel,
  peer: string,
  body: string,
  meta: Record<string, unknown>,
): Promise<unknown> {
  const ingest = await ingestService(p);
  return system(t.orgId, () =>
    ingest.ingest({
      orgId: t.orgId,
      channelUuid: ch.id,
      message: {
        providerMessageId: `spec.${randomUUID()}`,
        peerKey: peer,
        kind: 'interactive',
        body,
        meta,
        providerTimestamp: new Date().toISOString(),
      } as never,
    }),
  );
}

/** What the thread holds, outbound, with the message kind: a template is stored as one. */
export async function outboundKinds(
  p: FlowPipeline,
  t: Tenant,
  ch: SimChannel,
  peer: string,
): Promise<Array<{ kind: string; body: string }>> {
  const r = await p.h.owner.query(
    `SELECT m.kind, m.body FROM messages m JOIN conversations c ON c.org_id = m.org_id AND c.id = m.conversation_id
     WHERE c.org_id = $1 AND c.channel_id = $2 AND c.peer_key = $3 AND m.direction = 'out' ORDER BY m.seq`,
    [t.orgId, ch.internalId, peer],
  );
  return r.rows.map((x) => ({ kind: String(x.kind), body: String(x.body ?? '') }));
}

/** A booking type through the API (hours every day, all day, UTC). */
export async function addBookingType(
  p: FlowPipeline,
  t: Tenant,
  body: Record<string, unknown> = {},
): Promise<{ id: string; name: string; questions: Array<{ id: string; label: string }> }> {
  const res = await p.api
    .as(t.admin)
    .post('/v2/booking-types')
    .set('idempotency-key', randomUUID())
    .send({
      name: `Service ${randomUUID().slice(0, 5)}`,
      durationMinutes: 30,
      minNoticeMinutes: 0,
      maxAdvanceDays: 30,
      timezone: 'UTC',
      availability: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        weekday,
        from: '00:00',
        to: '23:59',
      })),
      ...body,
    });
  if (res.status !== 201) throw new Error(`booking type failed: ${JSON.stringify(res.body)}`);
  return res.body;
}

/** A tap on a list row or a button. */
export const tapRow = (
  p: FlowPipeline,
  t: Tenant,
  ch: SimChannel,
  peer: string,
  id: string,
  title = 'x',
) =>
  interactiveIn(p, t, ch, peer, title, {
    interactive: { type: 'list_reply', id, title, description: null },
  });
