import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  FLOW_ENGINE_LABELS,
  type FlbBuilderContext,
  type FlbCommerceProduct,
  type FlbCommerceProductsQuery,
  type FlowSender,
  type FlowType,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import {
  UNOFFICIAL_WHATSAPP_GATE,
  type UnofficialWhatsappGate,
} from '../auth/unofficial-whatsapp.port';
import { RequestContextStore } from '../../common/context/request-context';
import { DatabaseService } from '../../infra/db/database.service';
import { PlatformSettingsService } from '../auth';
import {
  catalogStoreName,
  emailLabel,
  flowTypeOf,
  formIsLive,
  instagramLabel,
  productOption,
  storeOption,
} from './builder-context-rules';

/** The store tables a commerce provider's `storeId` is checked against (instagram has no store, it reads the catalogue). */
const STORE_TABLES: Partial<Record<FlbCommerceProductsQuery['provider'], string>> = {
  whatsapp_shop: 'wa_catalogs',
  woocommerce: 'woocommerce_integrations',
  shopify: 'shopify_integrations',
};

/** The columns each channel table is read by for the sender pickers (never its tokens). */
const CHANNEL_LABEL_COLUMNS: Record<string, string> = {
  workspace_ig_accounts: 'uuid, id, username, name',
  facebook_pages: 'uuid, id, name, page_id',
  tiktok_accounts: 'uuid, id, display_name, username',
  telegram_bots: 'uuid, id, bot_name, bot_username',
  line_channels: 'uuid, id, display_name, basic_id',
  wechat_channels: 'uuid, id, account_name, wx_id',
  viber_channels: 'uuid, id, bot_name, bot_uri',
  workspace_email_accounts: 'uuid, id, name, email',
};

type Raw = Record<string, unknown>;
const rows = (r: { rows: unknown[] }): Raw[] => r.rows as Raw[];
const s = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

/** Fixed workspace-key models (TW-FLB-026): shown whenever the workspace saved its own key, whatever its plan. */
const BYOK_MODELS: Record<string, Array<[string, string]>> = {
  openai: [
    ['gpt-4o-mini', 'OpenAI'],
    ['gpt-4o', 'OpenAI'],
  ],
  anthropic: [
    ['claude-sonnet-4-6', 'Anthropic'],
    ['claude-haiku-4-5-20251001', 'Anthropic'],
  ],
  gemini: [
    ['gemini-2.0-flash', 'Google'],
    ['gemini-1.5-pro', 'Google'],
  ],
  mistral: [
    ['mistral-large-latest', 'Mistral'],
    ['mistral-small-latest', 'Mistral'],
  ],
};
const PROVIDER_LABEL: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Google',
  mistral: 'Mistral',
};
const providerLabel = (p: string) => PROVIDER_LABEL[p] ?? p.charAt(0).toUpperCase() + p.slice(1);

/**
 * The reference data the builder reads (TW-FLB-014, 026): one call instead of Reference's nine fetches plus the lazy ones.
 * Every list is the workspace's own (RLS), slim (ids as uuids, no graphs) and never fails the whole payload because one
 * lookup does: a channel whose table has nothing connected is an empty list.
 *
 * The AI model list reads the admin key roster (platform data, privileged read of provider / model names only, never a
 * key). That read is a shim for the AI-keys domain (AIADM); it moves behind that domain's resolver when it exists.
 */
@Injectable()
export class BuilderContextService {
  private readonly logger = new Logger(BuilderContextService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly settings: PlatformSettingsService,
    @Inject(UNOFFICIAL_WHATSAPP_GATE) private readonly unofficial: UnofficialWhatsappGate,
  ) {}

  async context(): Promise<FlbBuilderContext> {
    const ctx = RequestContextStore.require();
    const [fbOn, ttOn, emailOn] = await Promise.all([
      this.flag('facebook_enabled', true),
      this.flag('tiktok_enabled'),
      this.flag('email_enabled'),
    ]);
    const adminModels = await this.adminModels();
    return this.db.tx(async (tx) => {
      const o = ctx.orgId;
      const senders = {
        chat: await this.chatSenders(tx, o),
        instagram: await this.simple(
          tx,
          o,
          'workspace_ig_accounts',
          "status IS DISTINCT FROM 'disconnected'",
          instagramLabel,
          'instagram',
          'username',
        ),
        facebook: fbOn
          ? await this.simple(
              tx,
              o,
              'facebook_pages',
              "status = 'connected'",
              (r) => s(r.name) || `Page ${s(r.page_id)}`,
              'facebook',
              'name',
            )
          : [],
        tiktok: ttOn
          ? await this.simple(
              tx,
              o,
              'tiktok_accounts',
              "status = 'connected'",
              (r) => s(r.display_name) || (r.username ? `@${s(r.username)}` : `Account ${s(r.id)}`),
              'tiktok',
              'display_name',
            )
          : [],
        telegram: await this.simple(
          tx,
          o,
          'telegram_bots',
          'active',
          (r) => s(r.bot_name) || (r.bot_username ? `@${s(r.bot_username)}` : `Bot ${s(r.id)}`),
          'telegram',
          'bot_name',
        ),
        line: await this.simple(
          tx,
          o,
          'line_channels',
          'active',
          (r) => s(r.display_name) || s(r.basic_id) || `LINE ${s(r.id)}`,
          'line',
          'display_name',
        ),
        wechat: await this.simple(
          tx,
          o,
          'wechat_channels',
          'active',
          (r) => s(r.account_name) || s(r.wx_id) || `WeChat ${s(r.id)}`,
          'wechat',
          'account_name',
        ),
        viber: await this.simple(
          tx,
          o,
          'viber_channels',
          'active',
          (r) => s(r.bot_name) || s(r.bot_uri) || `Viber ${s(r.id)}`,
          'viber',
          'bot_name',
        ),
        email: emailOn
          ? await this.simple(
              tx,
              o,
              'workspace_email_accounts',
              "status = 'connected'",
              emailLabel,
              'email',
              'email',
            )
          : [],
      };
      const channels: FlowType[] = ['chat'];
      if (senders.instagram.length) channels.push('instagram');
      if (senders.facebook.length) channels.push('facebook');
      if (senders.tiktok.length) channels.push('tiktok');
      if (senders.telegram.length) channels.push('telegram');
      if (senders.line.length) channels.push('line');
      if (senders.wechat.length) channels.push('wechat');
      if (senders.viber.length) channels.push('viber');
      if (senders.email.length) channels.push('email');

      const [
        tags,
        groups,
        segments,
        keywordRules,
        teams,
        agents,
        stages,
        templates,
        flows,
        byok,
        assistants,
        callAssistants,
        bookingTypes,
        forms,
        stores,
      ] = await Promise.all([
        tx.execute(
          sql`SELECT uuid, name, color FROM tags WHERE org_id = ${o} ORDER BY lower(name), id`,
        ),
        tx.execute(
          sql`SELECT uuid, name FROM contact_groups WHERE org_id = ${o} ORDER BY lower(name), id`,
        ),
        tx.execute(
          sql`SELECT uuid, name FROM segments WHERE org_id = ${o} ORDER BY lower(name), id`,
        ),
        tx.execute(
          sql`SELECT uuid, keyword, status FROM keyword_replies WHERE org_id = ${o} AND provider = 'instagram' AND ig_trigger = 'comment_to_dm' ORDER BY keyword, id`,
        ),
        tx.execute(sql`
            SELECT t.uuid AS team_uuid, t.name AS team_name, u.uuid AS user_uuid, u.full_name
            FROM teams t
            LEFT JOIN team_members tm ON tm.org_id = t.org_id AND tm.team_id = t.id
            LEFT JOIN users u ON u.org_id = tm.org_id AND u.id = tm.user_id
            WHERE t.org_id = ${o} ORDER BY t.sort, lower(t.name), t.id, lower(u.full_name)`),
        tx.execute(
          sql`SELECT uuid, name, provider, model FROM ai_agents WHERE org_id = ${o} ORDER BY id`,
        ),
        tx.execute(sql`
            SELECT st.uuid, st.name, p.name AS pipeline
            FROM pipeline_stages st JOIN pipelines p ON p.org_id = st.org_id AND p.id = st.pipeline_id
            WHERE st.org_id = ${o} ORDER BY p.sort_order, p.id, st.sort_order, st.id`),
        tx.execute(sql`
            SELECT uuid, template_name, category, header, template_body, footer, attachment_type, attachment_file, buttons, carousel_data, variable_map
            FROM wa_templates WHERE org_id = ${o} AND lower(status) = 'approved' ORDER BY template_name, id`),
        tx.execute(
          sql`SELECT uuid, flow_name, flow_type, is_published FROM flows WHERE org_id = ${o} ORDER BY updated_at DESC, id DESC`,
        ),
        tx.execute(sql`SELECT provider FROM ai_provider_keys WHERE org_id = ${o} AND is_active`),
        tx.execute(sql`
            SELECT a.uuid, a.name, a.status, a.ai_model,
              (SELECT count(*) FROM ai_training_sources src WHERE src.org_id = a.org_id AND lower(src.status) = 'ready'
                 AND (src.assistant_id IS NULL OR src.assistant_id = a.id)) AS sources
            FROM ai_chat_assistants a WHERE a.org_id = ${o} ORDER BY a.name`),
        tx.execute(
          sql`SELECT uuid, name FROM ai_call_assistants WHERE org_id = ${o} ORDER BY name`,
        ),
        tx.execute(
          sql`SELECT uuid, name, duration_minutes, is_active FROM booking_types WHERE org_id = ${o} ORDER BY sort_order, name`,
        ),
        tx.execute(
          sql`SELECT uuid, title, status, meta_flow_id FROM wa_forms WHERE org_id = ${o} ORDER BY id DESC`,
        ),
        Promise.all([
          tx.execute(
            sql`SELECT uuid, catalog_name, catalog_id FROM wa_catalogs WHERE org_id = ${o} ORDER BY id`,
          ),
          tx.execute(
            sql`SELECT uuid, store_name, store_url, store_currency AS currency FROM woocommerce_integrations WHERE org_id = ${o} AND status = 'active' ORDER BY connected_at DESC NULLS LAST, id DESC`,
          ),
          tx.execute(
            sql`SELECT uuid, store_name, store_url, shop_currency AS currency FROM shopify_integrations WHERE org_id = ${o} AND status = 'active' ORDER BY connected_at DESC NULLS LAST, id DESC`,
          ),
        ]),
      ]);

      const teamMap = new Map<
        string,
        { id: string; name: string; members: Array<{ id: string; name: string }> }
      >();
      for (const r of rows(teams)) {
        const t = teamMap.get(s(r.team_uuid)) ?? {
          id: s(r.team_uuid),
          name: s(r.team_name),
          members: [],
        };
        if (r.user_uuid) t.members.push({ id: s(r.user_uuid), name: s(r.full_name) });
        teamMap.set(t.id, t);
      }
      const byokProviders = new Set(rows(byok).map((r) => s(r.provider)));
      const aiModels = [
        ...adminModels.filter((m) => !byokProviders.has(m.provider)),
        ...[...byokProviders].flatMap((p) =>
          (BYOK_MODELS[p] ?? []).map(([value]) => ({
            value,
            label: `${providerLabel(p)} (your key) · ${value}`,
            provider: p,
          })),
        ),
      ];

      return {
        channels,
        senders,
        tags: rows(tags).map((r) => ({
          id: s(r.uuid),
          name: s(r.name),
          color: (r.color as string | null) ?? null,
        })),
        groups: rows(groups).map((r) => ({ id: s(r.uuid), name: s(r.name) })),
        segments: rows(segments).map((r) => ({ id: s(r.uuid), name: s(r.name) })),
        keywordRules: rows(keywordRules).map((r) => ({
          id: s(r.uuid),
          keyword: s(r.keyword),
          active: s(r.status) === 'active',
        })),
        teams: [...teamMap.values()],
        agents: rows(agents).map((r) => ({
          id: s(r.uuid),
          name: s(r.name),
          provider: (r.provider as string | null) || null,
          model: (r.model as string | null) || null,
        })),
        stages: rows(stages).map((r) => ({
          id: s(r.uuid),
          name: s(r.name),
          pipeline: (r.pipeline as string | null) ?? null,
        })),
        templates: rows(templates).map((r) => ({
          id: s(r.uuid),
          name: s(r.template_name),
          category: (r.category as string | null) ?? null,
          header: (r.header as string | null) ?? null,
          body: (r.template_body as string | null) ?? null,
          footer: (r.footer as string | null) ?? null,
          attachmentType: (r.attachment_type as string | null) ?? null,
          attachmentFile: (r.attachment_file as string | null) ?? null,
          buttons: asArray(r.buttons),
          carousel: asArray(r.carousel_data),
          variables: templateVariables(r.variable_map),
        })),
        flows: rows(flows).map((r) => ({
          id: s(r.uuid),
          name: s(r.flow_name),
          flowType: flowTypeOf(r.flow_type),
          isPublished: r.is_published === true,
        })),
        aiModels,
        assistants: rows(assistants).map((r) => ({
          id: s(r.uuid),
          name: s(r.name),
          status: (r.status as string | null) ?? null,
          model: (r.ai_model as string | null) ?? null,
          sources: Number(r.sources),
        })),
        callAssistants: rows(callAssistants).map((r) => ({ id: s(r.uuid), name: s(r.name) })),
        bookingTypes: rows(bookingTypes).map((r) => ({
          id: s(r.uuid),
          name: s(r.name),
          duration:
            r.duration_minutes === null || r.duration_minutes === undefined
              ? null
              : Number(r.duration_minutes),
          active: r.is_active === true,
        })),
        forms: rows(forms).map((r) => ({
          id: s(r.uuid),
          title: s(r.title),
          isPublished: formIsLive(r.status, r.meta_flow_id),
        })),
        stores: {
          whatsapp_shop: rows(stores[0]).map((r) => ({
            id: s(r.uuid),
            name: catalogStoreName(r.catalog_name, r.catalog_id),
            currency: null,
          })),
          woocommerce: rows(stores[1]).map(storeOption),
          shopify: rows(stores[2]).map(storeOption),
        },
      };
    });
  }

  /**
   * Products a commerce node can offer (TW-FLB-052): the workspace's own catalogue rows, active ones only (intended deviation: Reference
   * listed drafts too, but a draft is never pushed to the Meta catalogue so a flow could not send it), newest first, out-of-stock
   * ones included and flagged as Reference lists them. WooCommerce and Shopify offer the products their sync mirrored into the
   * catalogue (architecture-forced: Reference fetched them live from the shop's API). A store id that is not this workspace's is an
   * empty list, never another workspace's data.
   */
  async commerceProducts(query: FlbCommerceProductsQuery): Promise<{ data: FlbCommerceProduct[] }> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const storeTable = STORE_TABLES[query.provider];
      if (query.storeId && storeTable) {
        const owned = await tx.execute(
          sql`SELECT 1 FROM ${sql.raw(storeTable)} WHERE org_id = ${ctx.orgId} AND uuid = ${query.storeId}::uuid LIMIT 1`,
        );
        if (rows(owned).length === 0) return { data: [] };
      }
      const where = [sql`p.org_id = ${ctx.orgId}`, sql`p.status = 'active'`];
      if (query.provider === 'woocommerce') where.push(sql`p.woo_product_id IS NOT NULL`);
      if (query.provider === 'shopify') where.push(sql`p.shopify_product_id IS NOT NULL`);
      if (query.q)
        where.push(sql`p.name ILIKE ${`%${query.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`}`);
      const res = await tx.execute(sql`
        SELECT p.uuid, coalesce(nullif(p.meta_retailer_id, ''), nullif(p.sku, ''), p.uuid::text) AS retailer_id, p.name, p.sku,
               p.image_url, p.price_minor, p.currency_code, p.product_url, p.in_stock
        FROM wa_products p WHERE ${sql.join(where, sql` AND `)}
        ORDER BY p.id DESC LIMIT ${query.limit}
      `);
      return { data: rows(res).map(productOption) };
    });
  }

  // --- internals -------------------------------------------------------------------------------------------------------

  /** A platform switch. `fallback` is what an unset switch means: nothing here writes `facebook_enabled`, so unset must not hide a built channel. */
  private async flag(key: string, fallback = false): Promise<boolean> {
    try {
      const v = await this.settings.get<unknown>(key);
      if (v === undefined || v === null) return fallback;
      return v === true || v === 1 || v === '1' || v === 'true';
    } catch (err) {
      this.logger.warn(`platform setting ${key} unreadable: ${(err as Error).message}`);
      return false;
    }
  }

  private async chatSenders(tx: Tx, orgId: number): Promise<FlowSender[]> {
    // Personal-number senders are not offered while the platform switch is off (owner decision 2026-10-05).
    const unofficialOn = await this.unofficial.isEnabledFor(orgId);
    const [dev, cfg] = await Promise.all([
      tx.execute(
        sql`SELECT id, uuid, device_name, phone_number FROM devices WHERE org_id = ${orgId} AND status = 'connected' AND ${unofficialOn}::boolean ORDER BY id`,
      ),
      tx.execute(
        sql`SELECT id, uuid, provider, display_label, phone_number FROM wa_provider_configs WHERE org_id = ${orgId} AND status = 'connected' ORDER BY id`,
      ),
    ]);
    const out: FlowSender[] = [];
    for (const r of rows(dev)) {
      out.push({
        key: `baileys:${s(r.uuid)}`,
        label: s(r.device_name) || s(r.phone_number) || `BAILEYS #${s(r.id)}`,
        phone: (r.phone_number as string | null) ?? null,
        engineLabel: FLOW_ENGINE_LABELS.baileys,
      });
    }
    for (const r of rows(cfg)) {
      const engine = s(r.provider).toLowerCase();
      out.push({
        key: `${engine}:${s(r.uuid)}`,
        label: s(r.display_label) || s(r.phone_number) || `${engine.toUpperCase()} #${s(r.id)}`,
        phone: (r.phone_number as string | null) ?? null,
        engineLabel: FLOW_ENGINE_LABELS[engine] ?? engine,
      });
    }
    return out;
  }

  private async simple(
    tx: Tx,
    orgId: number,
    table: string,
    where: string,
    label: (r: Raw) => string,
    engine: string,
    orderBy: string,
  ): Promise<FlowSender[]> {
    // `table`, `where`, `orderBy` and the column list are literals from this file, never request input. Only the columns a label
    // is made of are read: these rows also hold the channel's access tokens, which must never reach this process's memory.
    const res = await tx.execute(
      sql`SELECT ${sql.raw(CHANNEL_LABEL_COLUMNS[table] ?? 'uuid, id')} FROM ${sql.raw(table)} WHERE org_id = ${orgId} AND (${sql.raw(where)}) ORDER BY ${sql.raw(orderBy)}, id`,
    );
    return rows(res).map((r) => ({ key: `${engine}:${s(r.uuid)}`, label: label(r) }));
  }

  /** Active admin keys' models, by sort order: the default model first, then `extra_config.models`. Rows without a default are skipped. */
  private async adminModels(): Promise<Array<{ value: string; label: string; provider: string }>> {
    try {
      const res = await this.db.privileged((tx) =>
        tx.execute(
          sql`SELECT provider, default_model, extra_config FROM admin_ai_keys WHERE is_active AND provider <> 'elevenlabs' ORDER BY sort_order, id`,
        ),
      );
      const out: Array<{ value: string; label: string; provider: string }> = [];
      for (const r of rows(res)) {
        const provider = s(r.provider).toLowerCase();
        const def = s(r.default_model);
        if (!def) continue;
        const extra = parseModels(r.extra_config);
        for (const m of [def, ...extra.filter((x) => x !== def)]) {
          out.push({ value: m, label: `${providerLabel(provider)} · ${m}`, provider });
        }
      }
      return out;
    } catch (err) {
      this.logger.warn(`admin AI keys unreadable: ${(err as Error).message}`);
      return [];
    }
  }
}

function asArray(v: unknown): Array<Record<string, unknown>> {
  if (typeof v === 'string') {
    try {
      return asArray(JSON.parse(v));
    } catch {
      return [];
    }
  }
  return Array.isArray(v)
    ? (v.filter((x) => x && typeof x === 'object') as Array<Record<string, unknown>>)
    : [];
}

/**
 * The `{header: [{num, key}], body: [{num, key}]}` map a template stores, as one row per placeholder: the runtime reads each `key`
 * (a contact detail or a flow variable) when the template is sent. A map in any other shape (or none) has no rows.
 */
function templateVariables(
  raw: unknown,
): Array<{ section: 'header' | 'body'; slot: string; field: string }> {
  let map: unknown = raw;
  if (typeof map === 'string') {
    try {
      map = JSON.parse(map);
    } catch {
      return [];
    }
  }
  if (!map || typeof map !== 'object' || Array.isArray(map)) return [];
  const out: Array<{ section: 'header' | 'body'; slot: string; field: string }> = [];
  for (const section of ['header', 'body'] as const) {
    const list = (map as Record<string, unknown>)[section];
    if (!Array.isArray(list)) continue;
    list.forEach((entry, i) => {
      const e = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
      const field = s(e.key).trim();
      if (field) out.push({ section, slot: s(e.num ?? i + 1), field });
    });
  }
  return out;
}

function parseModels(raw: unknown): string[] {
  try {
    const j = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const models = (j as { models?: unknown } | null)?.models;
    return Array.isArray(models) ? models.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}
