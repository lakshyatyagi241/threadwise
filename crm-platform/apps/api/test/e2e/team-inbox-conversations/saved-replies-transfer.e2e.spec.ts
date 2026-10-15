import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AGENT, Api, startHarness, type Harness, type Tenant } from './support';

/**
 * Saved replies, BL-105 to BL-107: CSV export and import (dry run, per-row errors, duplicate policy, plan limit, permissions,
 * isolation) and the AI agent prompt section, against real Postgres through the restricted application role.
 */
process.env.CHANNEL_SIMULATOR_ENABLED = 'true';

let h: Harness;
let api: Api;
let t: Tenant;
let manager: { token: string; userId: number };
let agent: { token: string; userId: number };

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  t = await api.signup('srx');
  manager = await api.member(t, 'srxmanager', [
    ['inbox.savedreply.manage', 'all'],
    ['inbox.conversation.reply', 'all'],
  ]);
  agent = await api.member(t, 'srxagent', AGENT);
}, 560_000);
afterAll(async () => {
  await h?.stop();
});

const create = (token: string, body: Record<string, unknown>) =>
  api.as(token).post('/v2/inbox/saved-replies').set('idempotency-key', randomUUID()).send(body);
const upload = (token: string, csv: string, options: Record<string, unknown>, name = 'r.csv') =>
  api
    .as(token)
    .post('/v2/inbox/saved-replies/import')
    .attach('file', Buffer.from(csv), name)
    .field('options', JSON.stringify(options));
const dbReplies = async (orgId: number) =>
  (
    await h.owner.query(
      `SELECT shortcut, title, body, category, language, channel_kinds, user_id, used_count
       FROM saved_replies WHERE org_id = $1 ORDER BY shortcut`,
      [orgId],
    )
  ).rows as Array<Record<string, unknown>>;

describe('export', () => {
  it('writes the shared replies only, formula-safe, in the documented columns', async () => {
    expect(
      (
        await create(manager.token, {
          shortcut: 'hello',
          title: '=SUM(1,2)',
          body: '- first\n- second, "quoted"',
          category: 'Sales',
          language: 'en',
          channelKinds: ['whatsapp_cloud', 'email'],
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await create(manager.token, {
          shortcut: 'mine',
          title: 'Mine',
          body: 'private',
          scope: 'mine',
        })
      ).status,
    ).toBe(201);
    const res = await api.as(manager.token).get('/v2/inbox/saved-replies/export');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    const text = String(res.text).replace(/^FEFF/, '');
    expect(text.startsWith('title,shortcut,body,category,language,channel\r\n')).toBe(true);
    expect(text).toContain("'=SUM(1,2)");
    expect(text).toContain('whatsapp_cloud|email');
    expect(text).not.toContain('private');
  });

  it('needs the manage right', async () => {
    expect((await api.as(agent.token).get('/v2/inbox/saved-replies/export')).status).toBe(403);
    expect((await upload(agent.token, 'title,shortcut,body\na,b,c', {})).status).toBe(403);
  });
});

describe('import', () => {
  it('a round trip: the export re-imports as skipped duplicates, or as replaced ones with overwrite', async () => {
    const csv = String((await api.as(manager.token).get('/v2/inbox/saved-replies/export')).text);
    const skip = await upload(manager.token, csv, { duplicatePolicy: 'skip' });
    expect(skip.status, JSON.stringify(skip.body)).toBe(200);
    expect(skip.body.totals).toMatchObject({ create: 0, skip: 1, invalid: 0 });
    const over = await upload(manager.token, csv, { duplicatePolicy: 'overwrite' });
    expect(over.body.totals).toMatchObject({ update: 1, create: 0 });
    // The apostrophe guard was undone and the dash-led body is intact.
    const hello = (await dbReplies(t.orgId)).find((r) => r.shortcut === 'hello')!;
    expect(hello.title).toBe('=SUM(1,2)');
    expect(hello.body).toBe('- first\n- second, "quoted"');
  });

  it('a dry run reports everything and writes nothing; a real run writes only the good rows', async () => {
    const csv = [
      'Title,Shortcut,Body,Category,Language,Channel',
      'New one,Fresh Start,Welcome aboard,Onboarding,en,email',
      'No body,nobody,,,,',
      'Dup in file,fresh_start,again,,,',
      'Bad channel,badchan,x,,,fax',
      'Existing,HELLO,replaced text,Sales,en,',
    ].join('\n');
    const before = (await dbReplies(t.orgId)).length;
    const dry = await upload(manager.token, csv, { duplicatePolicy: 'skip', dryRun: true });
    expect(dry.status, JSON.stringify(dry.body)).toBe(200);
    expect(dry.body.dryRun).toBe(true);
    expect(dry.body.totals).toEqual({ rows: 5, create: 1, update: 0, skip: 1, invalid: 3 });
    const issues = Object.fromEntries(
      (dry.body.rows as Array<{ line: number; issue: string }>).map((r) => [r.line, r.issue]),
    );
    expect(issues).toMatchObject({
      3: 'missing_body',
      4: 'duplicate_in_file',
      5: 'channel_unknown',
      6: 'duplicate',
    });
    expect((await dbReplies(t.orgId)).length).toBe(before);

    const real = await upload(manager.token, csv, { duplicatePolicy: 'skip' });
    expect(real.status).toBe(200);
    const after = await dbReplies(t.orgId);
    expect(after.length).toBe(before + 1);
    const fresh = after.find((r) => r.shortcut === 'fresh_start')!;
    expect(fresh).toMatchObject({
      title: 'New one',
      category: 'Onboarding',
      language: 'en',
      channel_kinds: ['email'],
      user_id: null,
    });
    // audited and announced like a single create
    expect(await api.auditCount(t.orgId, 'saved_replies', 'insert')).toBeGreaterThan(0);
    const events = await api.events(t.orgId, 'inbox.saved_reply.created');
    expect(events.some((e) => e.shortcut === 'fresh_start')).toBe(true);
  });

  it('respects the plan limit: rows past it are reported, the rest are saved', async () => {
    const t2 = await api.signup('srxplan');
    const m = await api.member(t2, 'srxplanm', [
      ['inbox.savedreply.manage', 'all'],
      ['inbox.conversation.reply', 'all'],
    ]);
    await h.owner.query(
      `INSERT INTO org_plan_state (org_id, overrides) VALUES ($1, $2::jsonb)
       ON CONFLICT (org_id) DO UPDATE SET overrides = $2::jsonb`,
      [t2.orgId, JSON.stringify({ limits: { saved_replies: 3 } })],
    );
    expect((await create(m.token, { shortcut: 'seed', title: 's', body: 'b' })).status).toBe(201);
    const csv = ['title,shortcut,body', 'a,a,1', 'b,b,2', 'c,c,3', 'd,d,4'].join('\n');
    const res = await upload(m.token, csv, { duplicatePolicy: 'skip' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.totals).toMatchObject({ create: 2, invalid: 2 });
    expect(res.body.plan).toEqual({ limit: 3, used: 3, remaining: 0 });
    expect(
      (res.body.rows as Array<{ issue: string }>).every((r) => r.issue === 'plan_limit_reached'),
    ).toBe(true);
    expect((await dbReplies(t2.orgId)).length).toBe(3);
    // an overwrite adds nothing to the count, so it still works at the cap
    const again = await upload(m.token, 'title,shortcut,body\nsame,seed,new text', {
      duplicatePolicy: 'overwrite',
    });
    expect(again.body.totals).toMatchObject({ update: 1, invalid: 0 });
  });

  it('refuses a file that is not saved replies', async () => {
    const noCols = await upload(manager.token, 'a,b\n1,2', {});
    expect(noCols.status).toBe(422);
    expect(noCols.body.code).toBe('SAVED_REPLY_IMPORT_INVALID');
    expect((await upload(manager.token, 'title,shortcut,body\n', {})).status).toBe(422);
    expect((await upload(manager.token, 'title,shortcut,body\na,b,c', {}, 'x.pdf')).status).toBe(
      422,
    );
    const noFile = await api.as(manager.token).post('/v2/inbox/saved-replies/import');
    expect(noFile.status).toBe(422);
  });

  it("never touches another workspace's replies", async () => {
    const t3 = await api.signup('srxother');
    const m = await api.member(t3, 'srxotherm', [['inbox.savedreply.manage', 'all']]);
    const res = await upload(m.token, 'title,shortcut,body\nx,hello,theirs', {
      duplicatePolicy: 'overwrite',
    });
    expect(res.body.totals).toMatchObject({ create: 1, update: 0 });
    const mine = (await dbReplies(t.orgId)).find((r) => r.shortcut === 'hello')!;
    expect(mine.body).toBe('- first\n- second, "quoted"');
  });
});

describe('AI agent prompt section (use_saved_replies)', () => {
  it('carries the most used shared replies, never personal ones or ones with customer variables, and only with the flag', async () => {
    const t4 = await api.signup('srxai');
    const m = await api.member(t4, 'srxaim', [['inbox.savedreply.manage', 'all']]);
    const mk = async (shortcut: string, body: string, scope = 'shared') =>
      (await create(m.token, { shortcut, title: shortcut.toUpperCase(), body, scope })).body.id;
    await mk('plain', 'We open at nine.');
    await mk('hello', 'Hi {{first_name}}, how can we help?');
    await mk('secret', 'My private macro', 'mine');
    await mk('popular', 'Thanks for choosing {{workspace_name}}.');
    await h.owner.query(
      `UPDATE saved_replies SET used_count = 50 WHERE org_id = $1 AND shortcut = 'popular'`,
      [t4.orgId],
    );
    await h.owner.query(
      `INSERT INTO ai_agents (org_id, name, use_saved_replies) VALUES ($1, 'On', true), ($1, 'Off', false)`,
      [t4.orgId],
    );
    const ids = (
      await h.owner.query(`SELECT id, name FROM ai_agents WHERE org_id = $1`, [t4.orgId])
    ).rows as Array<{ id: string; name: string }>;
    const { AgentSavedRepliesService } =
      await import('../../../src/modules/ai-agents-training/agent-saved-replies.service');
    const svc = h.app.get(AgentSavedRepliesService, { strict: false });
    const on = await svc.promptSection(t4.orgId, {
      id: Number(ids.find((i) => i.name === 'On')!.id),
    });
    expect(on).toContain('- POPULAR: Thanks for choosing');
    expect(on).toContain('- PLAIN: We open at nine.');
    expect(on.indexOf('POPULAR')).toBeLessThan(on.indexOf('PLAIN'));
    expect(on).not.toContain('My private macro');
    expect(on).not.toContain('{{');
    expect(on).not.toContain('HELLO');
    const off = await svc.promptSection(t4.orgId, {
      id: Number(ids.find((i) => i.name === 'Off')!.id),
    });
    expect(off).toBe('');
    // another workspace's agent id is an unknown agent here
    expect(await svc.promptSection(t.orgId, { id: Number(ids[0]!.id) })).toBe('');
  });
});
