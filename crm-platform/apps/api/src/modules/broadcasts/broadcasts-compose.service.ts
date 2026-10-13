import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type {
  BroadcastCompose,
  BroadcastComposeQuery,
  ComposeSender,
  ComposeTemplate,
  SenderHidden,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { DatabaseService } from '../../infra/db/database.service';
import { PlatformSettingsService } from '../auth';
import {
  UNOFFICIAL_WHATSAPP_GATE,
  type UnofficialWhatsappGate,
} from '../auth/unofficial-whatsapp.port';
import { TEMPLATE_DIRECTORY, type TemplateDirectory } from './_shims/tokens';
import { assemblePhone } from './recipient-phone';

const ENGINE_LABEL: Record<string, string> = {
  baileys: 'Unofficial API',
  waba: 'Meta',
  twilio: 'Twilio',
  sms: 'SMS',
};
const WA_CATEGORIES = new Set(['marketing', 'utility', 'authentication']);

/** meta_category, else category when it is a WhatsApp category (a business vertical is not one), else utility. */
export function effectiveCategory(meta: string | null, local: string | null): string {
  const m = (meta ?? '').trim().toLowerCase();
  if (m) return m;
  const l = (local ?? '').trim().toLowerCase();
  return WA_CATEGORIES.has(l) ? l : 'utility';
}

/** The engine a template targets: its stored channel, else Twilio when it has a Content SID, WABA when it has a Meta id or a number, else Baileys. */
export function templateEngine(r: {
  channel: string | null;
  twilio_content_sid: string | null;
  meta_template_id: string | null;
  provider_config_id: number | string | null;
}): string {
  if (r.channel && ['baileys', 'waba', 'twilio', 'sms'].includes(r.channel)) return r.channel;
  if (r.twilio_content_sid) return 'twilio';
  if (r.meta_template_id || r.provider_config_id) return 'waba';
  return 'baileys';
}

interface TemplateRaw {
  uuid: string;
  template_name: string;
  header: string | null;
  template_body: string;
  footer: string | null;
  category: string | null;
  meta_category: string | null;
  template_type: string;
  language: string;
  buttons: unknown;
  variable_map: unknown;
  attachment_type: string | null;
  attachment_file: string | null;
  twilio_content_sid: string | null;
  meta_template_id: string | null;
  provider_config_id: number | string | null;
  channel: string | null;
  sender_label: string | null;
}

interface SenderRaw {
  uuid: string;
  engine: string;
  label: string | null;
  country_code: string | null;
  phone_number: string | null;
}

/**
 * The data the compose page opens with (TW-BCAST-004 to 006): approved templates and connected numbers.
 *
 * Templates follow Reference's `approved` scope: on a Meta (WABA) workspace only those Meta approved (a Meta id and status
 * APPROVED, not paused); on any other engine the locally approved or public ones. A template tied to a WABA number that is no
 * longer connected is hidden. Senders are the connected numbers of every engine except SMS (that channel has its own card),
 * default engine first. `channel=sms` is that card (TW-SMS-016): the SMS senders and the SMS templates only, and nothing at all
 * while the platform switch `sms_enabled` is off.
 */
@Injectable()
export class BroadcastsComposeService {
  constructor(
    private readonly db: DatabaseService,
    @Inject(TEMPLATE_DIRECTORY) private readonly templates: TemplateDirectory,
    @Inject(UNOFFICIAL_WHATSAPP_GATE) private readonly unofficial: UnofficialWhatsappGate,
    private readonly settings: PlatformSettingsService,
  ) {}

  async compose(query: BroadcastComposeQuery = {}): Promise<BroadcastCompose> {
    const { orgId } = RequestContextStore.require();
    if (query.channel === 'sms') return this.composeSms(orgId);
    // Personal numbers are not offered, and `baileys` is not the default engine, while the platform switch is off or the workspace is not allowed.
    const unofficialOn = await this.unofficial.isEnabledFor(orgId);
    return this.db.tx(async (tx) => {
      const eng = await tx.execute(
        sql`SELECT default_engine FROM workspace_settings WHERE org_id = ${orgId} LIMIT 1`,
      );
      const def = (eng.rows[0] as { default_engine: string | null } | undefined)?.default_engine;
      const defaultEngine =
        def && ENGINE_LABEL[def] && (def !== 'baileys' || unofficialOn)
          ? def
          : unofficialOn
            ? 'baileys'
            : 'waba';

      const approved =
        defaultEngine === 'waba'
          ? sql`t.meta_template_id IS NOT NULL AND t.meta_status = 'APPROVED' AND (t.paused_until IS NULL OR t.paused_until <= now())`
          : sql`t.status IN ('approved', 'public')`;
      const tpl = await tx.execute(sql`
        SELECT t.uuid, t.template_name, t.header, t.template_body, t.footer, t.category, t.meta_category, t.template_type,
               t.language, t.buttons, t.variable_map, t.attachment_type, t.attachment_file, t.twilio_content_sid, t.meta_template_id, t.provider_config_id, t.channel,
               coalesce(nullif(c.display_label, ''), c.phone_number) AS sender_label
        FROM wa_templates t
        LEFT JOIN wa_provider_configs c ON c.org_id = t.org_id AND c.id = t.provider_config_id
        WHERE t.org_id = ${orgId} AND ${approved}
          AND (t.provider_config_id IS NULL OR c.status = 'connected')
          AND coalesce(t.channel, 'waba') <> 'sms'
        ORDER BY t.id DESC`);

      const snd = await tx.execute(sql`
        SELECT * FROM (
          SELECT uuid, 'baileys' AS engine, coalesce(nullif(device_name, ''), phone_number) AS label, country_code, phone_number
          FROM devices WHERE org_id = ${orgId} AND status = 'connected' AND active AND ${unofficialOn}::boolean
          UNION ALL
          SELECT uuid, provider AS engine, coalesce(nullif(display_label, ''), phone_number) AS label, NULL, phone_number
          FROM wa_provider_configs WHERE org_id = ${orgId} AND status = 'connected' AND provider IN ('waba', 'twilio')
        ) s
        ORDER BY (engine = ${defaultEngine}) DESC, engine, label`);

      const twilio = await tx.execute(sql`
        SELECT 1 FROM wa_provider_configs WHERE org_id = ${orgId} AND provider = 'twilio' AND status = 'connected' LIMIT 1`);
      const hidden = await this.hiddenSenders(tx, orgId, unofficialOn);

      return {
        templates: (tpl.rows as unknown as TemplateRaw[]).map((r): ComposeTemplate => ({
          id: r.uuid,
          name: r.template_name,
          header: r.header,
          body: r.template_body,
          footer: r.footer,
          category: effectiveCategory(r.meta_category, r.category),
          type: r.template_type,
          engine: templateEngine(r),
          language: r.language,
          buttons: r.buttons ?? [],
          variableMap: r.variable_map ?? {},
          attachmentType: r.attachment_type,
          attachmentUrl: r.attachment_file ? this.templates.mediaUrl(r.attachment_file) : null,
          senderLabel: r.sender_label,
          twilioReady: Boolean(r.twilio_content_sid),
        })),
        senders: (snd.rows as unknown as SenderRaw[]).map((r): ComposeSender => ({
          key: `${r.engine}:${r.uuid}`,
          label: r.label ?? '',
          phone: r.phone_number ? `+${assemblePhone(r.phone_number, r.country_code)}` : '',
          engine: r.engine,
          engineLabel: ENGINE_LABEL[r.engine] ?? r.engine,
          isDefault: r.engine === defaultEngine,
        })),
        hidden,
        twilioEnabled: twilio.rows.length > 0,
      };
    });
  }

  /**
   * The numbers the workspace has that the list leaves out, counted by engine and reason (never a number, label or secret), so an
   * empty list can say why. It reads the same rows the list filters: personal devices (all of them while the unofficial engine is off for
   * the workspace, else the ones not connected or inactive) and Meta or Twilio configs that are not `connected` (pending, failed, other).
   * `providers` is the scope: the WhatsApp composer's engines, or `sms` for the SMS card.
   */
  private async hiddenSenders(
    tx: Tx,
    orgId: number,
    unofficialOn: boolean,
    scope: 'whatsapp' | 'sms' = 'whatsapp',
  ): Promise<SenderHidden[]> {
    const out: SenderHidden[] = [];
    if (scope === 'whatsapp') {
      const dev = await tx.execute(sql`
        SELECT count(*)::int AS count FROM devices
        WHERE org_id = ${orgId} AND (NOT ${unofficialOn}::boolean OR status <> 'connected' OR NOT active)`);
      const n = Number((dev.rows[0] as { count: number | string } | undefined)?.count ?? 0);
      if (n > 0)
        out.push({
          engine: 'baileys',
          reason: unofficialOn ? 'not_connected' : 'unofficial_disabled',
          count: n,
        });
    }
    const providers = scope === 'sms' ? sql`('sms')` : sql`('waba', 'twilio')`;
    const cfg = await tx.execute(sql`
      SELECT provider AS engine,
             CASE status WHEN 'pending' THEN 'pending' WHEN 'failed' THEN 'error' ELSE 'not_connected' END AS reason,
             count(*)::int AS count
      FROM wa_provider_configs
      WHERE org_id = ${orgId} AND provider IN ${providers} AND status <> 'connected'
      GROUP BY 1, 2
      ORDER BY 1, 2`);
    for (const r of cfg.rows as unknown as Array<{
      engine: string;
      reason: SenderHidden['reason'];
      count: number | string;
    }>)
      out.push({ engine: r.engine, reason: r.reason, count: Number(r.count) });
    return out;
  }

  /** The SMS card's composer: plain-text SMS templates (approved on save) and the connected SMS senders, oldest first. */
  private async composeSms(orgId: number): Promise<BroadcastCompose> {
    const on = await this.settings.get<unknown>('sms_enabled');
    if (!(on === true || on === 1 || on === '1' || on === 'true')) {
      return { templates: [], senders: [], hidden: [], twilioEnabled: false };
    }
    return this.db.tx(async (tx) => {
      const tpl = await tx.execute(sql`
        SELECT t.uuid, t.template_name, t.header, t.template_body, t.footer, t.category, t.meta_category, t.template_type,
               t.language, t.buttons, t.variable_map, t.attachment_type, t.attachment_file, t.twilio_content_sid, t.meta_template_id,
               t.provider_config_id, t.channel, NULL AS sender_label
        FROM wa_templates t
        WHERE t.org_id = ${orgId} AND t.channel = 'sms' AND t.status IN ('approved', 'public')
        ORDER BY t.id DESC`);
      const snd = await tx.execute(sql`
        SELECT uuid, provider AS engine, coalesce(nullif(display_label, ''), phone_number) AS label, NULL AS country_code, phone_number
        FROM wa_provider_configs WHERE org_id = ${orgId} AND provider = 'sms' AND status = 'connected'
        ORDER BY id`);
      const hidden = await this.hiddenSenders(tx, orgId, false, 'sms');
      return {
        hidden,
        templates: (tpl.rows as unknown as TemplateRaw[]).map((r): ComposeTemplate => ({
          id: r.uuid,
          name: r.template_name,
          header: r.header,
          body: r.template_body,
          footer: r.footer,
          category: effectiveCategory(r.meta_category, r.category),
          type: r.template_type,
          engine: 'sms',
          language: r.language,
          buttons: [],
          variableMap: r.variable_map ?? {},
          attachmentType: null,
          attachmentUrl: null,
          senderLabel: null,
          twilioReady: false,
        })),
        // The From value is shown as typed: an alphanumeric id is not a number and must not be dressed as one.
        senders: (snd.rows as unknown as SenderRaw[]).map((r): ComposeSender => ({
          key: `sms:${r.uuid}`,
          label: r.label ?? '',
          phone: r.phone_number ?? '',
          engine: 'sms',
          engineLabel: ENGINE_LABEL.sms!,
          isDefault: true,
        })),
        twilioEnabled: false,
      };
    });
  }
}
