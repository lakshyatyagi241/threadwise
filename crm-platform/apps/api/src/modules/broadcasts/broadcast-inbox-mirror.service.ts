import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../../infra/db/database.service';
import { MergeTagService, resolveToken } from '../crm';
import { TEMPLATE_DIRECTORY, type TemplateDirectory } from './_shims/tokens';
import {
  digitsOf,
  MIRROR_STATUSES,
  PREVIEW_LENGTH,
  readableTemplateBody,
  resolveBodyTokens,
  srcKey,
} from './inbox-mirror-rules';

/**
 * Shows a broadcast message in the team-inbox thread of a recipient who already has one (WD-BCAST-028). A cold recipient gets no
 * new thread: a campaign must not fill the inbox with a conversation per contact, and a template send does not open a reply
 * window anyway.
 *
 * Called after a recipient is reported `sent`, `delivered` or `read`, in its own transaction and never throwing: a mirror problem
 * must not fail the send or the receipt. Any of the three statuses may create the bubble, so a lost `sent` heals. One bubble per
 * (broadcast, contact): found by the provider's message id or by `src_key`, serialised so two reports at once cannot both insert.
 * Outbound messages are not unread: `unread_count` is never touched.
 *
 * Stand-in for the team-inbox domain's own mirror; it writes `messages` and `conversations` directly until that domain exports one.
 */
@Injectable()
export class BroadcastInboxMirrorService {
  private readonly logger = new Logger(BroadcastInboxMirrorService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly merge: MergeTagService,
    @Inject(TEMPLATE_DIRECTORY) private readonly templates: TemplateDirectory,
  ) {}

  /** True when a bubble was written. */
  async mirror(
    orgId: number,
    broadcastId: number,
    contactId: number,
    status: string,
    providerMessageId: string | null,
  ): Promise<boolean> {
    if (!MIRROR_STATUSES.has(status)) return false;
    try {
      return await this.db.txAs({ orgId }, async (tx) => {
        const b = (
          await tx.execute(sql`
            SELECT uuid, provider, device_id, template_id, temp_caption FROM broadcasts
            WHERE org_id = ${orgId} AND id = ${broadcastId}`)
        ).rows[0] as
          | {
              uuid: string;
              provider: string | null;
              device_id: number | string | null;
              template_id: number | string | null;
              temp_caption: string | null;
            }
          | undefined;
        const c = (
          await tx.execute(
            sql`SELECT phone FROM contacts WHERE org_id = ${orgId} AND id = ${contactId}`,
          )
        ).rows[0] as { phone: string | null } | undefined;
        const digits = digitsOf(c?.phone);
        if (!b || digits === '') return false;

        // In a multi-number workspace the send lands in the sending number's thread, never another's.
        const bound = b.provider === 'baileys' && b.device_id !== null ? Number(b.device_id) : null;
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
          b.template_id === null
            ? undefined
            : await this.templates.findById(tx, orgId, Number(b.template_id));
        let body = tpl ? readableTemplateBody(tpl) : (b.temp_caption ?? '');
        if (tpl && body.includes('{{')) {
          const base = await this.merge.baseContext(tx, orgId);
          const contact = await this.merge.contactFor(tx, orgId, contactId);
          if (contact) {
            const ctx = { ...base, contact };
            body = resolveBodyTokens(body, tpl.variableMap, (k) => resolveToken(k, ctx).value);
          }
        }
        if (body.trim() === '') return false; // a contentless bubble helps nobody

        const key = srcKey(broadcastId, contactId);
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${`bcast-mirror:${orgId}:${key}`}, 0))`,
        );
        const seen = await tx.execute(sql`
          SELECT 1 FROM messages
          WHERE org_id = ${orgId} AND conversation_id = ${Number(conv.id)}
            AND (meta ->> 'src_key' = ${key} OR (${providerMessageId}::text IS NOT NULL AND meta ->> 'wa_message_id' = ${providerMessageId}))
          LIMIT 1`);
        if (seen.rows.length > 0) return false;

        const buttons = Array.isArray(tpl?.buttons) && tpl.buttons.length > 0 ? tpl.buttons : null;
        const meta = {
          source: 'broadcast',
          type: tpl ? 'template' : 'text',
          ...(tpl ? { template_name: tpl.templateName } : {}),
          ...(buttons ? { buttons } : {}),
          broadcast_id: b.uuid,
          ...(providerMessageId ? { wa_message_id: providerMessageId } : {}),
          src_key: key,
        };
        await tx.execute(sql`
          INSERT INTO messages (org_id, conversation_id, contact_id, template_id, direction, to_number, body, status,
                                provider, meta, sent_at, delivered_at, read_at)
          VALUES (${orgId}, ${Number(conv.id)}, ${contactId}, ${b.template_id === null ? null : Number(b.template_id)},
                  'out', ${digits}, ${body}, ${status}, ${b.provider ?? conv.provider}, ${JSON.stringify(meta)}::jsonb, now(),
                  ${status === 'sent' ? null : sql`now()`}, ${status === 'read' ? sql`now()` : null})`);
        await tx.execute(sql`
          UPDATE conversations SET last_message_at = now(), last_outbound_at = now(),
                                   preview = left(${body}, ${PREVIEW_LENGTH})
          WHERE org_id = ${orgId} AND id = ${Number(conv.id)}`);
        return true;
      });
    } catch (err) {
      this.logger.warn({ err, orgId, broadcastId, contactId }, '[BCAST] inbox mirror failed');
      return false;
    }
  }
}
