import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import type { ConversationCloudGroup } from '@crm/contracts';
import type { Tx } from '@crm/db';
import {
  groupIdOf,
  isGroupPeer,
  wabaGroupsEligibleKey,
} from '../../infra/providers/whatsapp/group-peer';
import { REDIS_CLIENT } from '../../infra/redis/redis.module';
import { PlanEntitlementService } from '../plans-subscriptions-trials';
import { WalletGateService } from '../wallet-message-billing';

interface GroupRow {
  config_id: number | string | null;
  subject: string | null;
  suspended: boolean | null;
  participant_count: number | string | null;
  found: boolean;
}

/**
 * What the inbox shows about a thread of a Meta Cloud API group (`g:<group id>` on a `whatsapp_cloud` channel): whether the composer may
 * be on, how many people a message reaches, and what that costs (docs/specs/waba-groups-management.md 12, D8, D10). A cheap read of the
 * `waba_groups` mirror, the plan, the wallet and the Groups screen's eligibility cache; it never calls Meta. The caller has already checked
 * that the person may see the conversation.
 *
 * The send path (`OutboundService.assertGroupSendable`) decides again with the same rules: this only tells the composer early.
 */
@Injectable()
export class CloudGroupThreadReader {
  private readonly logger = new Logger(CloudGroupThreadReader.name);

  constructor(
    private readonly plans: PlanEntitlementService,
    private readonly wallet: WalletGateService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /** The state for the composer; null when the thread is not a Cloud API group thread. */
  async stateOf(
    tx: Tx,
    orgId: number,
    channel: { id: number; kind: string },
    peerKey: string,
  ): Promise<ConversationCloudGroup | null> {
    if (channel.kind !== 'whatsapp_cloud' || !isGroupPeer(peerKey)) return null;
    const groupId = groupIdOf(peerKey);
    const found = await tx.execute(
      sql`SELECT ch.waba_config_id AS config_id, g.subject, g.suspended, g.participant_count, (g.id IS NOT NULL) AS found
            FROM channels ch
            LEFT JOIN waba_groups g
              ON g.org_id = ch.org_id AND g.provider_config_id = ch.waba_config_id AND g.group_id = ${groupId}
           WHERE ch.org_id = ${orgId} AND ch.id = ${channel.id} LIMIT 1`,
    );
    const row = found.rows[0] as unknown as GroupRow | undefined;
    const suspended = row?.suspended === true;
    // The count is 0 until Meta's lifecycle webhook fills the row; a send is then priced for one recipient (like the send path).
    const memberCount = Math.max(0, Number(row?.participant_count ?? 0));

    const planLocked = !(await this.plans.featureEnabled(orgId, 'waba_groups'));
    const ineligible = await this.notEligible(orgId, row?.config_id ?? null);
    const block: ConversationCloudGroup['block'] = planLocked
      ? 'plan'
      : suspended
        ? 'suspended'
        : ineligible
          ? 'ineligible'
          : null;

    // No figure for a group the composer is off for.
    const quote = block
      ? null
      : await this.wallet.quote({
          orgId,
          source: 'group_message',
          recipients: Math.max(1, memberCount),
        });
    return {
      groupId,
      subject: row?.subject ?? null,
      memberCount,
      suspended,
      block,
      canSend: block === null,
      estimate:
        quote && quote.estimateMinor !== null
          ? { minor: quote.estimateMinor, currency: quote.currency }
          : null,
      walletShort: quote ? !quote.covered : false,
    };
  }

  /** True only when the Groups screen last probed the number and Meta said it may not use Groups; a cache miss or a Redis error is "unknown". */
  private async notEligible(orgId: number, configId: number | string | null): Promise<boolean> {
    if (configId === null) return false;
    try {
      return (await this.redis.get(wabaGroupsEligibleKey(orgId, Number(configId)))) === '0';
    } catch (err) {
      this.logger.warn({ err: String(err) }, 'group eligibility cache unreadable');
      return false;
    }
  }
}
