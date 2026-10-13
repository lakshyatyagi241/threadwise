import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import { ConsentSettingsService } from './consent-settings.service';

/**
 * The marketing send policy for broadcasts and campaigns (spec section 7). A withdrawn contact is ALWAYS skipped (the existing
 * `is_unsubscribed` checks stay where they are); with the workspace switch ON a contact also needs a recorded grant on WhatsApp.
 */
@Injectable()
export class ConsentPolicyService {
  constructor(private readonly settings: ConsentSettingsService) {}

  /** The workspace switch "Require recorded consent for marketing sends". Cached; no query on the usual path. */
  async requiresConsent(orgId: number): Promise<boolean> {
    return (await this.settings.effective(orgId)).requireConsentForMarketing;
  }
}

/** SQL predicate on a `contacts` alias: has a recorded marketing grant on the channel. Used only when the switch is ON. */
export function hasGrantedConsentSql(alias: string, channel = 'whatsapp'): SQL {
  const a = sql.raw(alias);
  return sql`EXISTS (
    SELECT 1 FROM contact_consent_state cs
    WHERE cs.org_id = ${a}.org_id AND cs.contact_id = ${a}.id AND cs.channel = ${channel}
      AND cs.purpose = 'marketing' AND cs.state = 'granted')`;
}
