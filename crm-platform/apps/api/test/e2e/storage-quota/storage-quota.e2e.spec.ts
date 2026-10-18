import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { storageFleetResponseSchema, storageWorkspaceDetailResponseSchema } from '@crm/contracts';
import { base32Decode, hotp, totpStep } from '../../../src/modules/auth/support/totp';
import {
  OPERATOR_EMAIL,
  OPERATOR_PASSWORD,
  startHarness,
  type Harness,
} from '../auth-registration-security/harness';
import { Api, type Tenant } from '../contacts-attributes-tags/support';
import { ChatMediaStore } from '../../../src/infra/providers/chat-conversations/media';
import { StorageQuotaPublisher } from '../../../src/modules/storage-quota/storage-quota.publisher';
import { StorageQuotaScheduler } from '../../../src/modules/storage-quota/storage-quota.scheduler';

/**
 * Storage quota, observe mode, through HTTP on the real application (the whole module graph, so a binding of `STORAGE_METER` that does
 * not resolve fails here): an upload is measured and registered; a metering fault does not fail the upload; a platform operator reads the
 * fleet. Nothing in this file may ever see a refusal.
 */
let h: Harness;
let api: Api;
let operatorToken = '';
const http = () => request(h.app.getHttpServer());
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(2048, 1),
]);

beforeAll(async () => {
  h = await startHarness({
    // The worker side of the meter (backfill, counter check, reaper) runs in this process, on the real queue and Redis.
    loadModules: async () => [
      (await import('../../../src/modules/storage-quota/storage-quota-worker.module'))
        .StorageQuotaWorkerModule,
    ],
  });
  api = new Api(h);
  const first = await http()
    .post('/v2/platform/auth/login')
    .send({ email: OPERATOR_EMAIL, password: OPERATOR_PASSWORD });
  const token = first.body.tokens.accessToken as string;
  const setup = await http().post('/v2/platform/auth/mfa/setup').set(bearer(token));
  await http()
    .post('/v2/platform/auth/mfa/enable')
    .set(bearer(token))
    .send({ code: hotp(base32Decode(setup.body.secret), totpStep(Date.now())) });
  operatorToken = token;
}, 900_000);

afterAll(async () => {
  await h?.stop();
});

describe('a team chat attachment is measured, and metering can never fail the upload', () => {
  let t: Tenant;
  let channel: string;

  const upload = (name: string) =>
    api
      .as(t.admin)
      .post(`/v2/team-chat/channels/${channel}/messages`)
      .field('body', 'see attached')
      .attach('attachment', PNG, name);
  const state = async () =>
    (
      await h.owner.query(
        `SELECT hot_bytes::int AS hot, reserved_bytes::int AS reserved FROM storage_org_state WHERE org_id = $1`,
        [t.orgId],
      )
    ).rows[0] as { hot: number; reserved: number } | undefined;

  beforeAll(async () => {
    t = await api.signup('stq');
    const list = await api.as(t.admin).get('/v2/team-chat/channels');
    channel = (list.body.data as Array<{ slug: string; id: string }>).find(
      (c) => c.slug === 'general',
    )!.id;
  });

  it('registers the blob under its pseudo key and counts its bytes, with nothing left reserved', async () => {
    const res = await upload('one.png');
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const msg = await h.owner.query(
      `SELECT id FROM team_chat_messages WHERE org_id = $1 ORDER BY id DESC LIMIT 1`,
      [t.orgId],
    );
    const key = `pg:team_chat_attachment_blobs:${msg.rows[0].id}`;
    const obj = await h.owner.query(
      `SELECT category, bytes::int AS bytes, state, owner_table FROM storage_objects WHERE org_id = $1 AND key = $2`,
      [t.orgId, key],
    );
    expect(obj.rows).toEqual([
      {
        category: 'team_chat_attachment',
        bytes: PNG.length,
        state: 'live',
        owner_table: 'team_chat_messages',
      },
    ]);
    expect(await state()).toEqual({ hot: PNG.length, reserved: 0 });
  });

  it('a post without a file touches no storage table', async () => {
    const before = await state();
    const res = await api
      .as(t.admin)
      .post(`/v2/team-chat/channels/${channel}/messages`)
      .send({ body: 'hello' });
    expect(res.status).toBe(201);
    expect(await state()).toEqual(before);
  });

  it('a broken metering table does not fail the upload: 201, the attachment is stored and downloads, and the next upload is metered again', async () => {
    await h.owner.query(`ALTER TABLE storage_reservations RENAME TO storage_reservations_off`);
    let res;
    try {
      res = await upload('during-outage.png');
    } finally {
      await h.owner.query(`ALTER TABLE storage_reservations_off RENAME TO storage_reservations`);
    }
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const download = await api.as(t.admin).get(`/v2/team-chat/messages/${res.body.id}/attachment`);
    expect(download.status).toBe(200);
    expect(Buffer.from(download.body).length).toBe(PNG.length);

    const before = (await state())!.hot;
    expect((await upload('after.png')).status).toBe(201);
    expect((await state())!.hot).toBe(before + PNG.length);
  });
});

describe('the operator storage view', () => {
  it('needs an operator session', async () => {
    expect((await http().get('/v2/platform/storage/fleet')).status).toBe(401);
    const t = await api.signup('stqx');
    expect((await api.as(t.admin).get('/v2/platform/storage/fleet')).status).toBeGreaterThanOrEqual(
      401,
    );
    expect((await api.as(t.admin).get('/v2/platform/storage/fleet')).status).toBeLessThan(500);
  });

  it('serves the fleet in the contract shape, in observe mode by default', async () => {
    const res = await http().get('/v2/platform/storage/fleet').set(bearer(operatorToken));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const fleet = storageFleetResponseSchema.parse(res.body);
    expect(fleet.mode).toBe('observe');
    expect(fleet.totals.hotBytes).toBeGreaterThanOrEqual(PNG.length);
    expect(
      fleet.byCategory.find((c) => c.category === 'team_chat_attachment')!.hotBytes,
    ).toBeGreaterThanOrEqual(PNG.length);
  });

  it('serves one workspace and refuses an unknown one', async () => {
    const org = await h.owner.query(
      `SELECT o.uuid FROM organizations o JOIN storage_org_state s ON s.org_id = o.id WHERE s.hot_bytes > 0 LIMIT 1`,
    );
    const uuid = org.rows[0].uuid as string;
    const res = await http()
      .get(`/v2/platform/storage/workspaces/${uuid}`)
      .set(bearer(operatorToken));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(storageWorkspaceDetailResponseSchema.parse(res.body).workspaceId).toBe(uuid);
    const audited = await h.owner.query(
      `SELECT 1 FROM security_events WHERE event = 'platform.storage.workspace_viewed'`,
    );
    expect(audited.rows.length).toBeGreaterThanOrEqual(1);

    const missing = await http()
      .get('/v2/platform/storage/workspaces/00000000-0000-4000-8000-000000000000')
      .set(bearer(operatorToken));
    expect(missing.status).toBe(404);
    expect(
      (await http().get('/v2/platform/storage/workspaces/not-a-uuid').set(bearer(operatorToken)))
        .status,
    ).toBe(422);
  });
});

describe('the worker side: a real file on disk, the real queue', () => {
  let t: Tenant;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(5000, 7),
  ]);
  const until = async <T>(read: () => Promise<T | undefined>, ms = 60_000): Promise<T> => {
    const end = Date.now() + ms;
    for (;;) {
      const v = await read();
      if (v !== undefined) return v;
      if (Date.now() > end) throw new Error('timed out waiting for the storage job');
      await new Promise((r) => setTimeout(r, 250));
    }
  };
  const objectRow = async (key: string) =>
    (
      await h.owner.query(
        `SELECT category, bytes::int AS bytes, state, owner_table FROM storage_objects WHERE org_id = $1 AND key = $2`,
        [t.orgId, key],
      )
    ).rows[0] as
      { category: string; bytes: number; state: string; owner_table: string | null } | undefined;
  const hot = async () =>
    Number(
      (await h.owner.query(`SELECT hot_bytes FROM storage_org_state WHERE org_id = $1`, [t.orgId]))
        .rows[0]?.hot_bytes ?? 0,
    );

  it('the media door registers a file, a queued counter check links it to its owner row, a queued backfill re-finds it, and a delete gives the bytes back', async () => {
    t = await api.signup('stqw');
    const media = h.app.get(ChatMediaStore, { strict: false });
    const stored = await media.store({ orgId: t.orgId, filename: 'pic.png', buffer: png });
    expect(await objectRow(stored.key)).toMatchObject({
      category: 'inbox_media',
      bytes: png.length,
      state: 'pending',
      owner_table: null,
    });
    expect(await hot()).toBe(png.length);

    // a contact file row now names the object: the nightly check (queued here) links the pending row to it
    const contact = (
      await h.owner.query(`INSERT INTO contacts (org_id) VALUES ($1) RETURNING id`, [t.orgId])
    ).rows[0].id;
    await h.owner.query(
      `INSERT INTO contact_files (org_id, contact_id, file_name, file_size_bytes, storage_key) VALUES ($1,$2,'pic.png',1,$3)`,
      [t.orgId, contact, stored.key],
    );
    const publisher = h.app.get(StorageQuotaPublisher, { strict: false });
    await publisher.enqueueReconcile(t.orgId, new Date().toISOString().slice(0, 10));
    const linked = await until(async () => {
      const r = await objectRow(stored.key);
      return r?.state === 'live' ? r : undefined;
    });
    expect(linked.owner_table).toBe('contact_files');
    expect(await hot()).toBe(png.length);

    // lose the registry row, then let the queued backfill find the file again from the contact file (measured on disk, not the claimed size of 1)
    await h.owner.query(`DELETE FROM storage_objects WHERE org_id = $1 AND key = $2`, [
      t.orgId,
      stored.key,
    ]);
    await publisher.enqueueBackfill(t.orgId);
    const refound = await until(async () => {
      const r = await objectRow(stored.key);
      return r ? r : undefined;
    });
    expect(refound).toMatchObject({ category: 'contact_file', bytes: png.length, state: 'live' });
    await until(async () => ((await hot()) === png.length ? true : undefined));
    // the job marks the workspace done after its last step: wait for it instead of racing it
    await until(async () => {
      const done = await h.owner.query(
        `SELECT backfilled_at FROM storage_org_state WHERE org_id = $1`,
        [t.orgId],
      );
      return done.rows[0]?.backfilled_at ? true : undefined;
    });

    // the delete path
    await media.remove(t.orgId, stored.key);
    expect(await objectRow(stored.key)).toBeUndefined();
    expect(await hot()).toBe(0);
  });

  it('the scheduler picks up workspaces that were never backfilled and the reaper returns an abandoned reservation', async () => {
    const scheduler = h.app.get(StorageQuotaScheduler, { strict: false });
    const fresh = await api.signup('stqx2');
    const picked = await scheduler.pickUpBackfillOnce();
    expect(picked.length).toBeGreaterThan(0);
    expect(picked.length).toBeLessThanOrEqual(3);

    await h.owner.query(
      `INSERT INTO storage_org_state (org_id, reserved_bytes) VALUES ($1, 900) ON CONFLICT (org_id) DO UPDATE SET reserved_bytes = 900`,
      [fresh.orgId],
    );
    await h.owner.query(
      `INSERT INTO storage_reservations (org_id, bytes, category, expires_at) VALUES ($1, 900, 'inbox_media', now() - interval '1 minute')`,
      [fresh.orgId],
    );
    const out = await scheduler.reapOnce();
    expect(out.reaped).toBeGreaterThanOrEqual(1);
    expect(
      Number(
        (
          await h.owner.query(`SELECT reserved_bytes FROM storage_org_state WHERE org_id = $1`, [
            fresh.orgId,
          ])
        ).rows[0].reserved_bytes,
      ),
    ).toBe(0);
  });
});
