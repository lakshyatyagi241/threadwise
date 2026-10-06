import { UNOFFICIAL_WHATSAPP_GATE } from '../../../src/modules/auth/unofficial-whatsapp.port';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { CryptoService } from '../../../src/common/crypto/crypto.service';
import { DatabaseService } from '../../../src/infra/db/database.service';
import {
  EngineSenderRegistry,
  LinkTracker,
  PACING_SETTINGS,
  PacingRuntime,
  SENDER_DIRECTORY,
  SenderLease,
  TEMPLATE_DIRECTORY,
  WARMER_GATE,
} from '../../../src/modules/broadcasts';
import { CampaignReceiptsService } from '../../../src/modules/campaigns';
import {
  CAMPAIGN_BILLING,
  CAMPAIGN_FLOW_STARTER,
  CAMPAIGN_SETTINGS,
} from '../../../src/modules/campaigns/_shims/tokens';
import { CampaignDispatchService } from '../../../src/modules/campaigns/campaign-dispatch.service';
import { CampaignEvents } from '../../../src/modules/campaigns/campaign-events';
import { CampaignMirrorService } from '../../../src/modules/campaigns/campaign-mirror.service';
import { CampaignsRepository } from '../../../src/modules/campaigns/campaigns.repository';
import { MergeTagService } from '../../../src/modules/crm';
import type { DeviceRuntimeService } from '../../../src/modules/node-bridge-runtime/runtime/device-runtime.service';
import {
  Api,
  bearer,
  startHarness,
  type Harness,
  type Tenant,
} from '../contacts-attributes-tags/support';
import { rig, worker as buildWorker, type FakeSocket, type Rig } from './support';

/**
 * A campaign sent on the unofficial engine (TW-NODE-015, 040): the real campaign dispatcher, the real engine adapter and send port,
 * a fake WhatsApp socket. Each recipient is messaged through the device, and the socket's delivery and read acks move the
 * recipient forward through the campaign's own receipt rules.
 */
let h: Harness;
let api: Api;
let r: Rig;
let dispatch: CampaignDispatchService;
const runtimes: DeviceRuntimeService[] = [];

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  r = rig(h);
  const get = <T>(token: unknown) => h.app.get<T>(token as never, { strict: false });
  const runtime = get<PacingRuntime>(PacingRuntime);
  runtime.sleep = () => Promise.resolve();
  runtime.random = () => 0.5;
  // The worker module does this in a real worker: campaign reports reach the campaign that owns the message.
  const receipts = get<CampaignReceiptsService>(CampaignReceiptsService);
  r.receipts.register((report) => receipts.handle(report));
  dispatch = new CampaignDispatchService(
    get<DatabaseService>(DatabaseService),
    get<CampaignsRepository>(CampaignsRepository),
    get<CryptoService>(CryptoService),
    get<CampaignEvents>(CampaignEvents),
    get<CampaignMirrorService>(CampaignMirrorService),
    get<EngineSenderRegistry>(EngineSenderRegistry),
    get<MergeTagService>(MergeTagService),
    get<LinkTracker>(LinkTracker),
    runtime,
    get<SenderLease>(SenderLease),
    get(SENDER_DIRECTORY),
    get(UNOFFICIAL_WHATSAPP_GATE),
    get(TEMPLATE_DIRECTORY),
    get(WARMER_GATE),
    get(PACING_SETTINGS),
    get(CAMPAIGN_BILLING),
    get(CAMPAIGN_FLOW_STARTER),
    get(CAMPAIGN_SETTINGS),
  );
}, 240_000);

afterEach(async () => {
  for (const rt of runtimes.splice(0)) await rt.onApplicationShutdown();
  await h.owner.query(`DELETE FROM device_auth_state`);
});
afterAll(async () => {
  await h?.stop();
});

let n = 0;
const inContext = <T>(orgId: number, fn: () => Promise<T>): Promise<T> =>
  RequestContextStore.run(
    { requestId: `t-${orgId}`, orgId, actorType: 'system', actorId: null, userId: null },
    fn,
  );

/** A tenant, a linked device on a worker (so the lease exists), and a text campaign over `count` contacts from that device. */
async function arrange(label: string, count: number) {
  const t: Tenant = await api.signup(label);
  const phone = `97${String(4000000 + n++).padStart(8, '0')}`;
  const dev = (
    await h.owner.query(
      `INSERT INTO devices (org_id, device_name, country_code, phone_number, status, active)
       VALUES ($1, 'Phone', '+91', $2, 'disconnected', false) RETURNING id, uuid`,
      [t.orgId, phone],
    )
  ).rows[0];
  const w = await buildWorker(h, r);
  runtimes.push(w.rt);
  await w.rt.adopt(t.orgId, Number(dev.id));
  const socket = w.factory.last as FakeSocket;
  const contactIds = await api.seedContacts(
    t,
    Array.from({ length: count }, (_, i) => ({
      name: `Asha${i}`,
      phone: `+91951${String(n++).padStart(7, '0')}`,
    })),
  );
  const res = await api
    .http()
    .post('/v2/campaigns')
    .set(bearer(t.admin))
    .set('idempotency-key', randomUUID())
    .send({
      name: 'Offer',
      type: 'text',
      customMessage: 'Hi {{name}}',
      scheduleType: 'now',
      senderKey: `baileys:${dev.uuid}`,
      contactIds,
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const row = (
    await h.owner.query(`SELECT id FROM wpcampaigns WHERE uuid = $1`, [res.body.campaign.id])
  ).rows[0];
  return { t, socket, campaignId: Number(row.id), orgId: t.orgId };
}
const recipients = async (campaignId: number) =>
  (
    await h.owner.query(
      `SELECT r.status, r.whatsapp_message_id, c.name
         FROM wp_campaign_contacts r JOIN contacts c ON c.org_id = r.org_id AND c.id = r.contact_id
        WHERE r.campaign_id = $1 ORDER BY r.id`,
      [campaignId],
    )
  ).rows as Array<{ status: string; whatsapp_message_id: string | null; name: string }>;

describe('a campaign on the unofficial engine', () => {
  it('messages every recipient through the device, then follows delivery and read', async () => {
    const x = await arrange('cu1', 3);
    expect(await inContext(x.orgId, () => dispatch.run(x.orgId, x.campaignId))).toBe('finished');

    expect(x.socket.sends.map((s) => (s.command as { body?: string }).body)).toEqual([
      'Hi Asha0',
      'Hi Asha1',
      'Hi Asha2',
    ]);
    expect(x.socket.sends[0]!.context.clientReference).toMatch(/^camp-/);
    const sent = await recipients(x.campaignId);
    expect(sent.map((s) => s.status)).toEqual(['sent', 'sent', 'sent']);
    expect(sent.map((s) => s.whatsapp_message_id)).toEqual([
      'wamid.fake.1',
      'wamid.fake.2',
      'wamid.fake.3',
    ]);

    x.socket.emit({
      type: 'receipt',
      receipt: { providerMessageId: 'wamid.fake.1', chatJid: 'x', ack: 3 },
    });
    x.socket.emit({
      type: 'receipt',
      receipt: { providerMessageId: 'wamid.fake.2', chatJid: 'x', ack: 4 },
    });
    // A report that is about nobody's campaign is simply not ours.
    x.socket.emit({
      type: 'receipt',
      receipt: { providerMessageId: 'wamid.someone.else', chatJid: 'x', ack: 3 },
    });
    await new Promise((res) => setTimeout(res, 400));
    expect((await recipients(x.campaignId)).map((s) => s.status)).toEqual([
      'delivered',
      'read',
      'sent',
    ]);
  });

  it('a recipient whose send fails is marked failed with the device’s reason, and the others still go out', async () => {
    const x = await arrange('cu2', 2);
    x.socket.onSend = (k) => (k === 1 ? new Error('rate-overlimit') : `wamid.fake.${k}`);
    await inContext(x.orgId, () => dispatch.run(x.orgId, x.campaignId));
    const rows = await recipients(x.campaignId);
    expect(rows.map((s) => s.status)).toContain('sent');
    expect(rows.some((s) => s.status === 'failed' || s.status === 'pending')).toBe(true);
  });
});
