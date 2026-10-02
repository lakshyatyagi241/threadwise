import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import type { Env } from '../../../config/env.schema';
import type {
  ButtonVar,
  CardVars,
  SendVars,
} from '../../../infra/providers/whatsapp/meta-send-payload';
import { shouldEmitButtonParam } from '../../../infra/providers/whatsapp/meta-send-payload';
import { isTrackableUrl, linkTtlDays, makeToken, replaceUrlsInText } from './link-rules';

export interface LinkContext {
  broadcastId?: number | null;
  campaignId?: number | null;
  messageId?: number | null;
  contactId?: number | null;
  templateId?: number | null;
  /** The recipient's number, digits. */
  phone?: string | null;
}

/**
 * Replaces a link with the recipient's own short link, so a tap is attributed to them (WD-BCAST-018). Shared with
 * campaigns, which wrap links the same way.
 *
 * A link is left as it is when tracking is off, when it is not http or https, or when it already is one of ours. The same
 * link for the same recipient in the same broadcast reuses its token, so a retry never mints a new one and counters never
 * mix between broadcasts.
 */
@Injectable()
export class LinkTracker {
  private readonly enabled: boolean;
  private readonly ttlDays: number;
  private readonly base: string;

  constructor(config: ConfigService<Env, true>) {
    this.enabled = config.get('LINK_TRACKING_ENABLED', { infer: true });
    this.ttlDays = linkTtlDays(config.get('LINK_TRACKING_TTL_DAYS', { infer: true }));
    this.base = config.get('APP_URL', { infer: true }).replace(/\/+$/, '');
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  async wrap(tx: Tx, orgId: number, url: string, ctx: LinkContext): Promise<string> {
    if (!this.enabled || !isTrackableUrl(url) || url.startsWith(`${this.base}/r/`)) return url;

    const existing = await tx.execute(sql`
      SELECT token FROM wa_link_clicks
      WHERE org_id = ${orgId} AND original_url = ${url}
        AND broadcast_id IS NOT DISTINCT FROM ${ctx.broadcastId ?? null}::bigint
        AND campaign_id IS NOT DISTINCT FROM ${ctx.campaignId ?? null}::bigint
        AND message_id IS NOT DISTINCT FROM ${ctx.messageId ?? null}::bigint
        AND contact_id IS NOT DISTINCT FROM ${ctx.contactId ?? null}::bigint
        AND (expires_at IS NULL OR expires_at > now())
      ORDER BY id LIMIT 1`);
    const found = (existing.rows[0] as { token: string } | undefined)?.token;
    if (found) return `${this.base}/r/${found}`;

    // 12 characters, 4 tries; the unique index decides a collision. Then a longer one.
    for (const length of [12, 12, 12, 12, 20]) {
      const token = makeToken(length);
      const res = await tx.execute(sql`
        INSERT INTO wa_link_clicks (org_id, token, original_url, broadcast_id, campaign_id, message_id, contact_id, template_id, phone, expires_at)
        VALUES (${orgId}, ${token}, ${url}, ${ctx.broadcastId ?? null}, ${ctx.campaignId ?? null}, ${ctx.messageId ?? null},
                ${ctx.contactId ?? null}, ${ctx.templateId ?? null}, ${ctx.phone ?? null},
                now() + ${`${this.ttlDays} days`}::interval)
        ON CONFLICT (token) DO NOTHING RETURNING token`);
      if (res.rows.length > 0) return `${this.base}/r/${token}`;
    }
    return url; // cannot happen in practice; the send goes out with the original link rather than failing
  }

  /** Every http(s) link in a text, for the engines that send a text body. */
  wrapText(tx: Tx, orgId: number, text: string, ctx: LinkContext): Promise<string> {
    return replaceUrlsInText(text, (u) => this.wrap(tx, orgId, u, ctx));
  }

  /**
   * The URL buttons of a payload, and of its carousel cards, with the recipient's own links. Only a button the approved
   * template gives a parameter to is wrapped: a static URL is never sent as a parameter, so a link row for it would be waste.
   */
  async wrapVars(
    tx: Tx,
    orgId: number,
    vars: SendVars,
    ctx: LinkContext,
    template: { buttons: unknown; carouselData: unknown },
  ): Promise<SendVars> {
    if (!this.enabled) return vars;
    const list = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
    const buttons = async (items: ButtonVar[] | undefined, tplButtons: unknown[]) =>
      items
        ? Promise.all(
            items.map(async (b) =>
              b.subType === 'url' && isTrackableUrl(b.value) && shouldEmitButtonParam(b, tplButtons)
                ? { ...b, value: await this.wrap(tx, orgId, b.value, ctx) }
                : b,
            ),
          )
        : items;
    const tplCards = list(template.carouselData);
    const cards = vars.cards
      ? await Promise.all(
          vars.cards.map(async (c, i): Promise<CardVars> => {
            const card = tplCards[i] as { buttons?: unknown } | undefined;
            return { ...c, buttons: await buttons(c.buttons, list(card?.buttons)) };
          }),
        )
      : vars.cards;
    return { ...vars, buttons: await buttons(vars.buttons, list(template.buttons)), cards };
  }
}
