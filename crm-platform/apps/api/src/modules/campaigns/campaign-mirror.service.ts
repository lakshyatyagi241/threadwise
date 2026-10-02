import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { RequestContextStore } from '../../common/context/request-context';
import { DatabaseService } from '../../infra/db/database.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { CONVERSATIONS_FACADE, type ConversationsFacade } from '../chat-conversations';
import { MergeTagService, resolveToken } from '../crm';
import {
  TEMPLATE_DIRECTORY,
  readableTemplateBody,
  resolveBodyTokens,
  type TemplateDirectory,
} from '../broadcasts';

const MIRROR_STATUSES: ReadonlySet<string> = new Set(['sent', 'delivered', 'read']);
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
    @Inject(CONVERSATIONS_FACADE) private readonly conversations: ConversationsFacade,
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
            SELECT uuid, template_id, custom_message FROM wpcampaigns
            WHERE org_id = ${orgId} AND id = ${campaignId}`)
        ).rows[0] as
          | {
              uuid: string;
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

        // The recipient's existing thread, on whichever channel it lives (a cold recipient gets none). The thread is keyed by the peer
        // on its channel, so the contact link or the phone digits find it.
        const conv = (
          await tx.execute(sql`
            SELECT c.id, c.peer_key, ch.uuid AS channel_uuid FROM conversations c
            JOIN channels ch ON ch.org_id = c.org_id AND ch.id = c.channel_id
            WHERE c.org_id = ${orgId} AND (c.contact_id = ${contactId} OR c.peer_key = ${digits})
            ORDER BY c.id LIMIT 1`)
        ).rows[0] as { id: number | string; peer_key: string; channel_uuid: string } | undefined;
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

        // One bubble per (campaign, contact): the ledger makes the second report with the same id a no-op, so a lost `sent` heals
        // from `delivered` and two reports at once cannot both insert.
        const key = `campaign:${campaignId}:contact:${contactId}`;
        return await RequestContextStore.run(
          { requestId: randomUUID(), orgId, actorType: 'system', actorId: null, userId: null },
          async () => {
            const done = await this.conversations.recordOutbound({
              channelId: conv.channel_uuid,
              peerKey: conv.peer_key,
              source: 'campaign',
              body,
              providerMessageId: providerMessageId ?? key,
            });
            return Boolean(done.messageId);
          },
        );
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
