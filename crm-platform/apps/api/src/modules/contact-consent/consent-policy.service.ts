import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import { rawIdentifier } from '../../common/sql/identifier';
import { minorRuleOf, type MinorRule } from '@crm/contracts';
import { DatabaseService } from '../../infra/db/database.service';
import { ConsentSettingsService } from './consent-settings.service';
import { ContactPrivacyRepository } from './contact-privacy.repository';
import { setCapped } from '../../common/cache/capped-map';

/** How long a process keeps a workspace's minor rule. A save in the Compliance center invalidates the saving process at once. */
export const MINOR_RULE_CACHE_MS = 60_000;
/** At most this many workspaces are remembered per process; the oldest goes first. */
export const MINOR_RULE_CACHE_MAX = 2_000;

/**
 * The marketing send policy for broadcasts and campaigns (spec section 7). A withdrawn contact is ALWAYS skipped (the existing
 * `is_unsubscribed` checks stay where they are); with the workspace switch ON a contact also needs a recorded grant on WhatsApp.
 */
@Injectable()
export class ConsentPolicyService {
  private readonly minorRules = new Map<number, { at: number; v: MinorRule }>();

  constructor(
    private readonly settings: ConsentSettingsService,
    private readonly db: DatabaseService,
    private readonly privacy: ContactPrivacyRepository,
  ) {}

  /** The workspace switch "Require recorded consent for marketing sends". Cached; no query on the usual path. */
  async requiresConsent(orgId: number): Promise<boolean> {
    return (await this.settings.effective(orgId)).requireConsentForMarketing;
  }

  /**
   * What the workspace's children setting (Compliance center: "we do not knowingly process minors" / "minors may be included", and the
   * parental-consent flag) does with MARKETING to a contact flagged as a minor (BL-180). Cached; no query on the usual path. A
   * workspace that never saved the Compliance center is `off`: nothing changes for it.
   */
  async minorRule(orgId: number): Promise<MinorRule> {
    const hit = this.minorRules.get(orgId);
    if (hit && Date.now() - hit.at < MINOR_RULE_CACHE_MS) return hit.v;
    const facts = await this.db.txAs({ orgId, userId: null }, (tx) =>
      this.privacy.complianceFacts(tx, orgId),
    );
    const v = minorRuleOf(facts.childrenPolicy, facts.parentalConsentRequired);
    setCapped(this.minorRules, orgId, { at: Date.now(), v }, MINOR_RULE_CACHE_MAX);
    return v;
  }

  /** Forget the cached minor rule of a workspace (the Compliance center saved a new children setting). */
  invalidateMinorRule(orgId: number): void {
    this.minorRules.delete(orgId);
  }
}

/** SQL predicate on a `contacts` alias: has a recorded marketing grant on the channel. Used only when the switch is ON. */
export function hasGrantedConsentSql(alias: string, channel = 'whatsapp'): SQL {
  const a = rawIdentifier(alias);
  return sql`EXISTS (
    SELECT 1 FROM contact_consent_state cs
    WHERE cs.org_id = ${a}.org_id AND cs.contact_id = ${a}.id AND cs.channel = ${channel}
      AND cs.purpose = 'marketing' AND cs.state = 'granted')`;
}
