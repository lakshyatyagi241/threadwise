import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../../infra/db/database.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { MergeTagService, resolveToken } from '../crm';
import {
  TEMPLATE_DIRECTORY,
  readableTemplateBody,
  resolveBodyTokens,
  type TemplateDirectory,
} from '../broadcasts';

const MIRROR_STATUSES: ReadonlySet<string> = new Set(['sent', 'delivered', 'read']);
const PREVIEW_LENGTH = 200;
const digitsOf = (v: string | null | undefined) => (v ?? '').replace(/\D+/g, '');

/**
 * Shows a campaign message in the team-inbox thread of a recipient who already has one (TW-CAMP-023). A cold recipient gets no new
 * thread. Called after a recipient is `sent`, `delivered` or `read`, in its own transaction, and never throwing: a mirror problem
 * must not fail the send or the receipt. Any of the three may create the bubble so a lost `sent` heals; one bubble per
 * (campaign, contact), found by the provider message id or the source key, serialised so two reports at once cannot both insert.
 * Outbound messages are not unread: `unread_count` is never touched.
 */
@Injectable()
export class CampaignMirrorService {
  private readonly logger = new Logger(CampaignMirrorService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly merge: MergeTagService,
    private readonly crypto: CryptoService,
    @Inject(TEMPLATE_DIRECTORY) private readonly templates: TemplateDirectory,
  ) {}

  /** True when a bubble was written. */
  async mirror(
    orgId: number,
    campaignId: number,
    contactId: number,
    status: string,
    providerMessageId: string | null,
  ): Promise<boolean> {
    if (!MIRROR_STATUSES.has(status)) return false;
    try {
      return await this.db.txAs({ orgId }, async (tx) => {
        const c = (
          await tx.execute(sql`
            SELECT uuid, provider, device_id, template_id, custom_message FROM wpcampaigns
            WHERE org_id = ${orgId} AND id = ${campaignId}`)
        ).rows[0] as
          | {
              uuid: string;
              provider: string | null;
              device_id: number | string | null;
              template_id: number | string | null;
              custom_message: string | null;
            }
          | undefined;
        const k = (
          await tx.execute(
            sql`SELECT phone FROM contacts WHERE org_id = ${orgId} AND id = ${contactId}`,
          )
        ).rows[0] as { phone: string | null } | undefined;
        const digits = digitsOf(k?.phone);
        if (!c || digits === '') return false;

        // A multi-number workspace: the send lands in the sending number's thread, never another's.
        const bound = c.provider === 'baileys' && c.device_id !== null ? Number(c.device_id) : null;
        const conv = (
          await tx.execute(sql`
            SELECT id, provider FROM conversations
            WHERE org_id = ${orgId}
              AND (contact_id = ${contactId} OR contact_digits = ${digits} OR split_part(raw_jid, '@', 1) = ${digits})
              AND (${bound}::bigint IS NULL OR device_id IS NULL OR device_id = ${bound}::bigint)
            ORDER BY id LIMIT 1`)
        ).rows[0] as { id: number | string; provider: string | null } | undefined;
        if (!conv) return false;

        const tpl =
          c.template_id === null
            ? undefined
            : await this.templates.findById(tx, orgId, Number(c.template_id));
        let body = tpl ? readableTemplateBody(tpl) : this.plain(c.custom_message);
        if (tpl && body.includes('{{')) {
          const base = await this.merge.baseContext(tx, orgId);
          const contact = await this.merge.contactFor(tx, orgId, contactId);
          if (contact) {
            const ctx = { ...base, contact };
            body = resolveBodyTokens(body, tpl.variableMap, (key) => resolveToken(key, ctx).value);
          }
        }
        if (body.trim() === '') return false; // a contentless bubble helps nobody

        const key = `campaign:${campaignId}:contact:${contactId}`;
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${`camp-mirror:${orgId}:${key}`}, 0))`,
        );
        const seen = await tx.execute(sql`
          SELECT 1 FROM messages
          WHERE org_id = ${orgId} AND conversation_id = ${Number(conv.id)}
            AND (meta ->> 'src_key' = ${key} OR (${providerMessageId}::text IS NOT NULL AND meta ->> 'wa_message_id' = ${providerMessageId}))
          LIMIT 1`);
        if (seen.rows.length > 0) return false;

        const buttons = Array.isArray(tpl?.buttons) && tpl.buttons.length > 0 ? tpl.buttons : null;
        const meta = {
          source: 'campaign',
          type: tpl ? 'template' : 'text',
          ...(tpl ? { template_name: tpl.templateName } : {}),
          ...(buttons ? { buttons } : {}),
          campaign_id: c.uuid,
          ...(providerMessageId ? { wa_message_id: providerMessageId } : {}),
          src_key: key,
        };
        await tx.execute(sql`
          INSERT INTO messages (org_id, conversation_id, contact_id, template_id, direction, to_number, body, status,
                                provider, meta, sent_at, delivered_at, read_at)
          VALUES (${orgId}, ${Number(conv.id)}, ${contactId}, ${c.template_id === null ? null : Number(c.template_id)},
                  'out', ${digits}, ${body}, ${status}, ${c.provider ?? conv.provider}, ${JSON.stringify(meta)}::jsonb, now(),
                  ${status === 'sent' ? null : sql`now()`}, ${status === 'read' ? sql`now()` : null})`);
        await tx.execute(sql`
          UPDATE conversations SET last_message_at = now(), last_outbound_at = now(),
                                   preview = left(${body}, ${PREVIEW_LENGTH})
          WHERE org_id = ${orgId} AND id = ${Number(conv.id)}`);
        return true;
      });
    } catch (err) {
      this.logger.warn({ err, orgId, campaignId, contactId }, '[CAMP] inbox mirror failed');
      return false;
    }
  }

  private plain(v: string | null): string {
    if (!v) return '';
    try {
      return this.crypto.decrypt(v);
    } catch {
      return '';
    }
  }
}
