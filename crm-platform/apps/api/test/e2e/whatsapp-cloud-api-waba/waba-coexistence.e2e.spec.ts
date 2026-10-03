import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  messagesOf,
  startPipeline,
  until,
  type Pipeline,
} from '../chat-conversations/pipeline-support';

/**
 * What the WhatsApp Business app mirrors into the workspace (coexistence) and what Meta sends beyond plain messages, through the real
 * WABA ingest and the inbox's own sink and queue: a real Postgres and Redis, real BullMQ workers.
 */
let p: Pipeline;
let seq = 0;
// Loaded after the application has started: the modules import each other and a static import here would close the cycle in the wrong order.
let ingest: { process: (changes: unknown[]) => Promise<unknown> };
let split: (payload: unknown) => unknown[];
let links: {
  ensure: (
    orgId: number,
    configId: number,
    o: { create: boolean },
  ) => Promise<{ id: number } | null>;
};

beforeAll(async () => {
  p = await startPipeline();
  const { WabaIngestService } =
    await import('../../../src/modules/whatsapp-cloud-api-waba/waba-ingest.service');
  const { splitWebhook } = await import('../../../src/modules/whatsapp-cloud-api-waba/waba-rules');
  const { WabaChannelLinkService } =
    await import('../../../src/modules/chat-conversations/waba-channel-link.service');
  ingest = p.h.app.get(WabaIngestService) as never;
  split = splitWebhook as never;
  links = p.h.app.get(WabaChannelLinkService, { strict: false }) as never;
}, 300_000);

afterAll(async () => {
  await p?.stop();
});

async function arrange(label: string) {
  const t = await p.api.signup(label);
  const n = seq++;
  const phoneNumberId = `7100${n}00`;
  const wabaId = `88${phoneNumberId}`;
  const row = await p.h.owner.query(
    `INSERT INTO wa_provider_configs (org_id, provider, status, phone_number, display_label, meta_json, connected_at)
     VALUES ($1, 'waba', 'connected', $2, 'Support line', $3::jsonb, now()) RETURNING id`,
    [
      t.orgId,
      `+9191133${String(10000 + n)}`,
      JSON.stringify({ provider: 'meta', waba_id: wabaId, phone_number_id: phoneNumberId }),
    ],
  );
  const number = { configId: Number(row.rows[0].id), phoneNumberId, wabaId };
  const channel = await links.ensure(t.orgId, number.configId, { create: true });
  if (!channel) throw new Error('no inbox channel was made for the number');
  return { t, number, channel };
}

const conversation = (x: Awaited<ReturnType<typeof arrange>>, peer: string) =>
  until(`the thread of ${peer}`, async () => {
    const r = await p.h.owner.query(
      `SELECT * FROM conversations WHERE org_id = $1 AND channel_id = $2 AND peer_key = $3`,
      [x.t.orgId, x.channel.id, peer],
    );
    return r.rows[0] as Record<string, unknown> | undefined;
  });

const feed = (
  x: Awaited<ReturnType<typeof arrange>>,
  field: string,
  value: Record<string, unknown>,
) =>
  ingest.process(
    split({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: x.number.wabaId,
          time: Math.floor(Date.now() / 1000),
          changes: [
            {
              field,
              value: {
                messaging_product: 'whatsapp',
                metadata: { phone_number_id: x.number.phoneNumberId },
                ...value,
              },
            },
          ],
        },
      ],
    }),
  );

describe('coexistence echoes (TW-WABA-044)', () => {
  const echo = (x: Awaited<ReturnType<typeof arrange>>, message: Record<string, unknown>) =>
    feed(x, 'smb_message_echoes', {
      message_echoes: [
        { from: '919112210000', timestamp: String(Math.floor(Date.now() / 1000)), ...message },
      ],
    });

  it('a message typed on the Business app is one outbound bubble with no unread, even if delivered twice', async () => {
    const x = await arrange('co1');
    const body = {
      to: '919800000030',
      id: 'wamid.echo.1',
      type: 'text',
      text: { body: 'typed on the phone' },
    };
    await echo(x, body);
    await echo(x, body);
    const conv = await conversation(x, '919800000030');
    const rows = await until('the echo', async () => {
      const m = await messagesOf(p, conv.id as number);
      return m.length ? m : undefined;
    });
    await new Promise((r) => setTimeout(r, 300));
    expect(await messagesOf(p, conv.id as number)).toHaveLength(1);
    expect(rows[0]).toMatchObject({ direction: 'out', body: 'typed on the phone' });
    expect(Number(conv.unread_count ?? 0)).toBe(0);
  });

  it('describes a file typed from the app and skips an echo with no customer number', async () => {
    const x = await arrange('co2');
    await echo(x, {
      to: '919800000031',
      id: 'wamid.echo.2',
      type: 'image',
      image: { caption: 'look' },
    });
    await echo(x, { id: 'wamid.echo.3', type: 'text', text: { body: 'nobody' } });
    const conv = await conversation(x, '919800000031');
    const rows = await until('the echo', async () => {
      const m = await messagesOf(p, conv.id as number);
      return m.length ? m : undefined;
    });
    expect(rows[0]).toMatchObject({ direction: 'out', body: '[Photo] look' });
    const all = await p.h.owner.query(`SELECT 1 FROM conversations WHERE org_id = $1`, [x.t.orgId]);
    expect(all.rows).toHaveLength(1);
  });
});
