import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { BroadcastCompose, ComposeSender, ComposeTemplate } from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { DatabaseService } from '../../infra/db/database.service';
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
  if (r.channel && ['baileys', 'waba', 'twilio'].includes(r.channel)) return r.channel;
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
 * The data the compose page opens with (WD-BCAST-004 to 006): approved templates and connected numbers.
 *
 * Templates follow WaDesk's `approved` scope: on a Meta (WABA) workspace only those Meta approved (a Meta id and status
 * APPROVED, not paused); on any other engine the locally approved or public ones. A template tied to a WABA number that is no
 * longer connected is hidden. Senders are the connected numbers of every engine except SMS (that channel has its own card),
 * default engine first.
 */
@Injectable()
export class BroadcastsComposeService {
  constructor(
    private readonly db: DatabaseService,
    @Inject(TEMPLATE_DIRECTORY) private readonly templates: TemplateDirectory,
    @Inject(UNOFFICIAL_WHATSAPP_GATE) private readonly unofficial: UnofficialWhatsappGate,
  ) {}

  async compose(): Promise<BroadcastCompose> {
    const { orgId } = RequestContextStore.require();
    // Personal numbers are not offered, and `baileys` is not the default engine, while the platform switch is off.
    const unofficialOn = await this.unofficial.isEnabled();
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
        twilioEnabled: twilio.rows.length > 0,
      };
    });
  }
}
