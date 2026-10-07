import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPipeline, type Pipeline } from './pipeline-support';
import { connectNumber, linkChannel } from './whatsapp-support';
import { WabaChannelLinkService } from '../../../src/modules/chat-conversations/waba-channel-link.service';

/**
 * A WhatsApp number belongs to one workspace's inbox at a time. Meta's shared test number is connected, disconnected and connected
 * again in several workspaces, so a workspace that let a number go must not keep holding it on a dead channel (the symptom was a
 * connected number with an empty inbox and no explanation). Real Postgres, the real link service.
 */
let p: Pipeline;

beforeAll(async () => {
  p = await startPipeline();
}, 300_000);

afterAll(async () => {
  await p?.stop();
});

const links = () => p.h.app.get(WabaChannelLinkService, { strict: false });
const holder = async (phoneNumberId: string) =>
  (
    await p.h.owner.query(
      `SELECT org_id, status, waba_config_id FROM channels WHERE kind = 'whatsapp_cloud' AND external_id = $1`,
      [phoneNumberId],
    )
  ).rows as Array<{ org_id: string; status: string; waba_config_id: string | null }>;

describe('a disconnected WhatsApp number is let go', () => {
  it('the next workspace to connect the same number gets its channel; the first keeps its history, unlinked', async () => {
    const a = await p.api.signup('wnr-a');
    const b = await p.api.signup('wnr-b');
    const phone = '+15550137150';
    const ids = { phoneNumberId: '108911612034746', phone };

    const numA = await connectNumber(p.h, a.orgId, ids);
    const chA = await linkChannel(p.h, a.orgId, numA);
    expect(chA.status).toBe('connected');
    expect((await holder(ids.phoneNumberId)).map((r) => Number(r.org_id))).toEqual([a.orgId]);

    // The first workspace disconnects the number: its connection is gone and the channel lets go of the number.
    await p.h.owner.query(`UPDATE wa_provider_configs SET status = 'disconnected' WHERE id = $1`, [
      numA.configId,
    ]);
    const disconnected = await links().ensure(a.orgId, numA.configId, { create: false });
    expect(disconnected?.status).toBe('disconnected');
    expect(disconnected?.externalId).toBeNull();
    expect(await holder(ids.phoneNumberId)).toEqual([]);

    // The second workspace connects the same number and gets its channel (this is the case that used to fail silently).
    const numB = await connectNumber(p.h, b.orgId, ids);
    const chB = await linkChannel(p.h, b.orgId, numB);
    expect(chB.status).toBe('connected');
    expect(chB.externalId).toBe(ids.phoneNumberId);
    expect((await holder(ids.phoneNumberId)).map((r) => Number(r.org_id))).toEqual([b.orgId]);

    // The first workspace's channel is still there (history), disconnected.
    const stillA = (
      await p.h.owner.query(
        `SELECT status, external_id FROM channels WHERE org_id = $1 AND id = $2`,
        [a.orgId, chA.id],
      )
    ).rows[0];
    expect(stillA).toMatchObject({ status: 'disconnected', external_id: null });
  });

  it("a number still held by another workspace's channel gives the new connection no channel, and nothing is stolen; once the holder lets go it does", async () => {
    const a = await p.api.signup('wnr-c');
    const b = await p.api.signup('wnr-d');
    const ids = { phoneNumberId: '108911612034799', phone: '+15550137199' };
    const numA = await connectNumber(p.h, a.orgId, ids);
    await linkChannel(p.h, a.orgId, numA);
    // The holder's connection is deleted but its channel has not let go yet (the release runs on the removal event).
    await p.h.owner.query(`DELETE FROM wa_provider_configs WHERE id = $1`, [numA.configId]);
    const numB = await connectNumber(p.h, b.orgId, ids);
    expect(await links().ensure(b.orgId, numB.configId, { create: true, revive: true })).toBeNull();
    expect((await holder(ids.phoneNumberId)).map((r) => Number(r.org_id))).toEqual([a.orgId]);

    await links().connectionRemoved(a.orgId);
    const got = await links().ensure(b.orgId, numB.configId, { create: true, revive: true });
    expect(got).toMatchObject({ status: 'connected', externalId: ids.phoneNumberId });
    expect((await holder(ids.phoneNumberId)).map((r) => Number(r.org_id))).toEqual([b.orgId]);
  });

  it('reconnecting the same number in the same workspace brings the old channel back instead of making a second one', async () => {
    const a = await p.api.signup('wnr-e');
    const ids = { phoneNumberId: '108911612034722', phone: '+15550137122' };
    const num = await connectNumber(p.h, a.orgId, ids);
    const first = await linkChannel(p.h, a.orgId, num);
    // Disconnected and the connection removed (the channel is detached and lets go of the number).
    await p.h.owner.query(`DELETE FROM wa_provider_configs WHERE id = $1`, [num.configId]);
    await links().connectionRemoved(a.orgId);
    const released = (
      await p.h.owner.query(
        `SELECT status, external_id, waba_config_id FROM channels WHERE org_id = $1 AND id = $2`,
        [a.orgId, first.id],
      )
    ).rows[0];
    expect(released).toMatchObject({
      status: 'disconnected',
      external_id: null,
      waba_config_id: null,
    });

    // The number is connected again (a new connection row) and finds its old channel by the number as people write it.
    const again = await connectNumber(p.h, a.orgId, ids);
    const back = await linkChannel(p.h, a.orgId, again);
    expect(back.id).toBe(first.id);
    expect(back).toMatchObject({ status: 'connected', externalId: ids.phoneNumberId });
    const count = (
      await p.h.owner.query(
        `SELECT count(*)::int AS n FROM channels WHERE org_id = $1 AND kind = 'whatsapp_cloud'`,
        [a.orgId],
      )
    ).rows[0].n;
    expect(count).toBe(1);
  });

  it('a connection that is reconnected takes its number back', async () => {
    const a = await p.api.signup('wnr-f');
    const ids = { phoneNumberId: '108911612034733', phone: '+15550137133' };
    const num = await connectNumber(p.h, a.orgId, ids);
    await linkChannel(p.h, a.orgId, num);
    await p.h.owner.query(`UPDATE wa_provider_configs SET status = 'disconnected' WHERE id = $1`, [
      num.configId,
    ]);
    await links().ensure(a.orgId, num.configId, { create: false });
    expect(await holder(ids.phoneNumberId)).toEqual([]);
    await p.h.owner.query(`UPDATE wa_provider_configs SET status = 'connected' WHERE id = $1`, [
      num.configId,
    ]);
    const back = await links().ensure(a.orgId, num.configId, { create: true, revive: true });
    expect(back).toMatchObject({ status: 'connected', externalId: ids.phoneNumberId });
    expect((await holder(ids.phoneNumberId)).map((r) => Number(r.org_id))).toEqual([a.orgId]);
  });
});
