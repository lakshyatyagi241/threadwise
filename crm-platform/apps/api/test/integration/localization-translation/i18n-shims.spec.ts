import { Logger } from '@nestjs/common';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDbClient, runMigrations, withPrivileged, withTenant, type DbClient } from '@crm/db';
import type { DatabaseService } from '../../../src/infra/db/database.service';
import type { PlatformStore } from '../../../src/modules/auth';
import { PgConversationMessageStore } from '../../../src/modules/localization-translation/conversation-message-store';
import { PgKeywordRuleStore } from '../../../src/modules/localization-translation/keyword-rule-store';

/**
 * The two shims this domain keeps over tables the auto-reply and inbox domains own, against a real Postgres as the
 * restricted application role (forced RLS applies): they read and write only their own workspace, write only the
 * translation columns, and pin a conversation language once.
 */
describe('keyword rule and conversation message stores (TW-I18N-032, 033, 036, 037)', () => {
  const MIGRATIONS = resolve(__dirname, '../../../../../packages/db/migrations');
  let container: StartedPostgreSqlContainer;
  let owner: Client;
  let dbClient: DbClient;
  let rules: PgKeywordRuleStore;
  let messages: PgConversationMessageStore;
  let orgA: number;
  let orgB: number;
  let ruleA: string;
  let ruleB: string;
  let contentA: string;

  const org = async (slug: string) =>
    Number(
      (
        await owner.query(`INSERT INTO organizations (slug, name) VALUES ($1, $1) RETURNING id`, [
          slug,
        ])
      ).rows[0].id,
    );

  beforeAll(async () => {
    Logger.overrideLogger(false);
    container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
      .withDatabase('crm')
      .withUsername('crm')
      .withPassword('crm')
      .start();
    owner = new Client({ connectionString: container.getConnectionUri() });
    await owner.connect();
    await owner.query(
      `CREATE ROLE crm_app_user LOGIN PASSWORD 'test' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`,
    );
    await runMigrations(container.getConnectionUri(), { dir: MIGRATIONS, log: () => undefined });

    orgA = await org('shim-a');
    orgB = await org('shim-b');
    await owner.query(
      `INSERT INTO workspace_settings (org_id, default_language, auto_translate_languages) VALUES ($1, 'fr', '["es","hi"]'), ($2, NULL, NULL)`,
      [orgA, orgB],
    );
    const rule = async (orgId: number, keyword: string) =>
      (
        await owner.query(
          `INSERT INTO keyword_replies (org_id, keyword, reply_type) VALUES ($1, $2, 'text') RETURNING uuid`,
          [orgId, keyword],
        )
      ).rows[0].uuid as string;
    ruleA = await rule(orgA, 'hello');
    ruleB = await rule(orgB, 'price');
    const ruleAId = (await owner.query(`SELECT id FROM keyword_replies WHERE uuid = $1`, [ruleA]))
      .rows[0].id;
    contentA = (
      await owner.query(
        `INSERT INTO keyword_reply_contents (org_id, keyword_reply_id, content_type, content) VALUES ($1, $2, 'text', 'Welcome!') RETURNING uuid`,
        [orgA, ruleAId],
      )
    ).rows[0].uuid;
    await owner.query(
      `INSERT INTO keyword_reply_contents (org_id, keyword_reply_id, content_type, content, is_selected) VALUES ($1, $2, 'text', 'Not chosen', false)`,
      [orgA, ruleAId],
    );

    dbClient = createDbClient({
      url: `postgres://crm_app_user:test@${container.getHost()}:${container.getPort()}/crm`,
      poolMax: 4,
    });
    const db = {
      primary: dbClient.db,
      txAs: (
        tenant: Parameters<DatabaseService['txAs']>[0],
        fn: Parameters<DatabaseService['txAs']>[1],
      ) => withTenant(dbClient.db, tenant, fn),
    } as unknown as DatabaseService;
    const store = {
      tx: (fn: Parameters<PlatformStore['tx']>[0]) => withPrivileged(dbClient.db, fn),
    } as unknown as PlatformStore;
    rules = new PgKeywordRuleStore(db, store);
    messages = new PgConversationMessageStore(db);
  }, 180_000);

  afterAll(async () => {
    await dbClient?.close();
    await owner?.end();
    await container?.stop();
  });

  describe('keyword rules', () => {
    it('lists the workspaces that have rules, and each workspace languages', async () => {
      expect(await rules.workspaces()).toEqual([orgA, orgB]);
      expect(await rules.workspaceLanguages(orgA)).toEqual({
        defaultLanguage: 'fr',
        autoTranslateLanguages: '["es","hi"]',
      });
      expect(await rules.workspaceLanguages(orgB)).toEqual({
        defaultLanguage: null,
        autoTranslateLanguages: null,
      });
    });

    it('scans one workspace only, with its selected variants', async () => {
      const page = await rules.scan({
        orgId: orgA,
        includeTranslated: false,
        after: null,
        limit: 10,
      });
      expect(page.map((r) => r.id)).toEqual([ruleA]);
      expect(page[0]!.contents.map((c) => c.content)).toEqual(['Welcome!']); // the unselected variant is left out
      expect(page[0]!.keywordTranslations).toBeNull();
    });

    it('saves only the translation columns, then skips the rule unless forced', async () => {
      const [rule] = await rules.scan({
        orgId: orgA,
        includeTranslated: false,
        after: null,
        limit: 10,
      });
      await rules.save(rule!, {
        canonicalLanguage: 'fr',
        keywordTranslations: { fr: 'hello', es: 'hola' },
        contentTranslations: { [contentA]: { fr: 'Welcome!', es: 'Bienvenido!' } },
      });
      const row = (
        await owner.query(
          `SELECT keyword, reply_type, keyword_translations, canonical_language FROM keyword_replies WHERE uuid = $1`,
          [ruleA],
        )
      ).rows[0];
      expect(row).toMatchObject({ keyword: 'hello', reply_type: 'text', canonical_language: 'fr' });
      expect(row.keyword_translations).toEqual({ fr: 'hello', es: 'hola' });
      const c = (
        await owner.query(
          `SELECT content, content_translations FROM keyword_reply_contents WHERE uuid = $1`,
          [contentA],
        )
      ).rows[0];
      expect(c.content).toBe('Welcome!');
      expect(c.content_translations.es).toBe('Bienvenido!');

      expect(
        await rules.scan({ orgId: orgA, includeTranslated: false, after: null, limit: 10 }),
      ).toHaveLength(0);
      const forced = await rules.scan({
        orgId: orgA,
        includeTranslated: true,
        after: null,
        limit: 10,
      });
      expect(forced[0]!.keywordTranslations).toEqual({ fr: 'hello', es: 'hola' });
    });

    it('does not let one workspace write another workspace rule', async () => {
      const [other] = await rules.scan({
        orgId: orgB,
        includeTranslated: false,
        after: null,
        limit: 10,
      });
      expect(other!.id).toBe(ruleB);
      // Saved as workspace A, the update matches nothing: forced RLS hides workspace B rows.
      await rules.save(
        { ...other!, orgId: orgA },
        { canonicalLanguage: 'en', keywordTranslations: { en: 'x' }, contentTranslations: {} },
      );
      expect(
        (
          await owner.query(`SELECT keyword_translations FROM keyword_replies WHERE uuid = $1`, [
            ruleB,
          ])
        ).rows[0].keyword_translations,
      ).toBeNull();
    });

    it('pages with a cursor', async () => {
      const first = await rules.scan({
        orgId: orgA,
        includeTranslated: true,
        after: null,
        limit: 1,
      });
      expect(
        await rules.scan({ orgId: orgA, includeTranslated: true, after: first[0]!.id, limit: 1 }),
      ).toHaveLength(0);
    });
  });

  describe('conversation messages', () => {
    let conv: number;
    let inbound: number;
    let outbound: number;
    let template: number;

    beforeAll(async () => {
      // A thread now belongs to a channel (`channel_id`, `peer_key` are required) and a message to a thread (`seq`).
      const channel = Number(
        (
          await owner.query(
            `INSERT INTO channels (org_id, kind, name) VALUES ($1, 'simulator', 'sim') RETURNING id`,
            [orgA],
          )
        ).rows[0].id,
      );
      conv = Number(
        (
          await owner.query(
            `INSERT INTO conversations (org_id, channel_id, peer_key, title) VALUES ($1, $2, '15550001', 'c') RETURNING id`,
            [orgA, channel],
          )
        ).rows[0].id,
      );
      let seq = 0;
      const msg = async (direction: string, body: string, meta: string | null = null) =>
        Number(
          (
            await owner.query(
              `INSERT INTO messages (org_id, conversation_id, seq, direction, sender_kind, status, body, meta)
               VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8::jsonb, '{}'::jsonb)) RETURNING id`,
              [
                orgA,
                conv,
                ++seq,
                direction,
                direction === 'in' ? 'customer' : 'agent',
                direction === 'in' ? 'received' : 'sent',
                body,
                meta,
              ],
            )
          ).rows[0].id,
        );
      inbound = await msg('in', 'Dónde está mi pedido');
      outbound = await msg('out', 'Your order ships tomorrow');
      template = await msg('out', 'Template body', '{"template_name":"promo"}');
    });

    it('loads a message with its conversation language and send kind', async () => {
      expect(await messages.load(orgA, inbound)).toMatchObject({
        direction: 'in',
        customerLanguage: null,
        isTemplate: false,
        isForwarded: false,
        conversationId: conv,
      });
      expect((await messages.load(orgA, template))?.isTemplate).toBe(true);
      expect(await messages.load(orgA, 999_999)).toBeNull();
    });

    it('finds a message id from its public uuid, in its own workspace only', async () => {
      const uuid = (await owner.query(`SELECT uuid FROM messages WHERE id = $1`, [inbound])).rows[0]
        .uuid as string;
      expect(await messages.idOfUuid(orgA, uuid)).toBe(inbound);
      expect(await messages.idOfUuid(orgB, uuid)).toBeNull();
      expect(await messages.idOfUuid(orgA, '00000000-0000-4000-8000-000000000000')).toBeNull();
    });

    it('does not see another workspace message', async () => {
      expect(await messages.load(orgB, inbound)).toBeNull();
    });

    it('stores the reading and pins the language once', async () => {
      const m = (await messages.load(orgA, inbound))!;
      await messages.saveInbound(orgA, m, {
        detectedLanguage: 'es',
        translatedBody: 'Where is my order?',
        isTranslated: true,
        pinLanguage: 'es',
      });
      const row = (
        await owner.query(
          `SELECT detected_language, translated_body, is_translated, body FROM messages WHERE id = $1`,
          [inbound],
        )
      ).rows[0];
      expect(row).toEqual({
        detected_language: 'es',
        translated_body: 'Where is my order?',
        is_translated: true,
        body: 'Dónde está mi pedido',
      });
      expect(
        (await owner.query(`SELECT customer_language FROM conversations WHERE id = $1`, [conv]))
          .rows[0].customer_language,
      ).toBe('es');

      // A later message in French never moves the pinned language.
      await messages.saveInbound(orgA, m, {
        detectedLanguage: 'fr',
        translatedBody: 'x',
        isTranslated: true,
        pinLanguage: 'fr',
      });
      expect(
        (await owner.query(`SELECT customer_language FROM conversations WHERE id = $1`, [conv]))
          .rows[0].customer_language,
      ).toBe('es');
      expect((await messages.load(orgA, outbound))?.customerLanguage).toBe('es');
    });

    it('stores the agent original beside a translated reply and leaves the body alone', async () => {
      const m = (await messages.load(orgA, outbound))!;
      await messages.saveOutbound(orgA, m, {
        body: 'Su pedido se envía mañana',
        original: 'Your order ships tomorrow',
        language: 'es',
        isTranslated: true,
      });
      const row = (
        await owner.query(
          `SELECT translated_body, detected_language, is_translated, body FROM messages WHERE id = $1`,
          [outbound],
        )
      ).rows[0];
      expect(row).toEqual({
        translated_body: 'Your order ships tomorrow',
        detected_language: 'es',
        is_translated: true,
        body: 'Your order ships tomorrow',
      });
    });
  });
});
