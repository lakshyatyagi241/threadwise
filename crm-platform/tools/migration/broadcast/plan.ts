import type { Source } from '../extract/source';
import { badText, docKeys, docKeysWith, sha256, str } from '../util';
import type { BroadcastSettings } from './config';
import { campaignVerdict, classifyRecipient, type CampaignEntry } from './rules';
import { emptyTemplates, type TemplateIndex } from './template-link';

/** What the recipient rows of one campaign add up to, by the app's own definition of the tiles (campaigns.repository.ts AGG). */
export interface Agg {
  /** loaded recipient rows */
  total: number;
  sent: number;
  delivered: number;
  read: number;
  responded: number;
  failed: number;
}
export const zeroAgg = (): Agg => ({
  total: 0,
  sent: 0,
  delivered: 0,
  read: 0,
  responded: 0,
  failed: 0,
});

/**
 * Pass 1 of the broadcast step: a verdict for every campaign key, and the roll-up of every campaign over the recipient rows that WILL
 * load. The campaign row is inserted with these counters already in it, so nothing ever UPDATEs a campaign (touch_row would stamp
 * updated_at = now() and bump row_version).
 */
export interface BroadcastPlan {
  settings: BroadcastSettings;
  /** every key of every campaign document (ObjectId hex, string id, broadcast_id) -> its entry; the first owner of a key wins */
  campaigns: Map<string, CampaignEntry>;
  /** by the campaign's primary key */
  agg: Map<string, Agg>;
  /** digits of contacts.normalized_phone -> how many contacts hold the number (and the lowest id) */
  contactsByDigits: Map<string, { n: number; id: number }>;
  /** by the campaign's primary key: the distinct Meta template ids its loaded recipients carry (the template link, broadcast/template-link.ts) */
  metaIds: Map<string, Set<string>>;
  /** the migrated templates (wa_templates + id_map), read from the database before the first campaign is written */
  templates: TemplateIndex;
  tally: Record<string, number>;
  fingerprint: string;
}

export const CAMPAIGN_ALIASES = ['broadcast_id'];

export async function buildBroadcastPlan(a: {
  source: Source;
  client: string;
  settings: BroadcastSettings;
  contactsByDigits: BroadcastPlan['contactsByDigits'];
  templates?: TemplateIndex;
  shas: string[];
}): Promise<BroadcastPlan> {
  const { source, client, settings } = a;
  const has = (c: string): boolean => source.collections(client).includes(c);
  const tally: Record<string, number> = {};
  const bump = (k: string): void => {
    tally[k] = (tally[k] ?? 0) + 1;
  };

  // campaigns: primary keys first, then the other keys (an alias never hides another document's primary key; the loader does the same)
  const campaigns = new Map<string, CampaignEntry>();
  const docs: Array<{ keys: string[]; entry: CampaignEntry }> = [];
  const seen = new Set<string>();
  if (has('broadcasting'))
    for await (const d of source.read(client, 'broadcasting')) {
      const keys = docKeysWith(d, CAMPAIGN_ALIASES).map((k) => k.key);
      const primary = keys[0];
      if (primary === undefined || seen.has(primary)) continue; // NO_KEY / DUPLICATE_KEY: the engine quarantines it
      seen.add(primary);
      const bad = badText(d);
      const v = bad ? { verdict: 'quarantine' as const, code: bad } : campaignVerdict(d, settings);
      const entry: CampaignEntry = { primary, ...v };
      docs.push({ keys, entry });
      campaigns.set(primary, entry);
      bump(`campaign ${v.verdict}${v.code ? ` ${v.code}` : ''}`);
    }
  for (const { keys, entry } of docs)
    for (const k of keys.slice(1)) if (!campaigns.has(k)) campaigns.set(k, entry);

  // recipients: the same decision the transform makes, per document
  const agg = new Map<string, Agg>();
  const metaIds = new Map<string, Set<string>>();
  const ids = new Set<string>();
  if (has('whatsapp_broadcasting_data'))
    for await (const d of source.read(client, 'whatsapp_broadcasting_data')) {
      const k = docKeys(d)[0]?.key;
      if (k === undefined || ids.has(k)) continue;
      ids.add(k);
      if (badText(d)) continue;
      const v = classifyRecipient(d, campaigns);
      if (v.kind !== 'load') {
        bump(`recipient ${v.kind} ${v.code}`);
        continue;
      }
      bump('recipient load');
      const g = agg.get(v.campaign.primary) ?? zeroAgg();
      agg.set(v.campaign.primary, g);
      g.total++;
      const mt = str(d.meta_template_id);
      if (mt) metaIds.set(v.campaign.primary, (metaIds.get(v.campaign.primary) ?? new Set()).add(mt));
      const s = v.st.status;
      if (s === 'failed') g.failed++;
      else g.sent++;
      if (s === 'delivered' || s === 'read' || s === 'responded') g.delivered++;
      if (s === 'read' || s === 'responded') g.read++;
      if (s === 'responded') g.responded++;
    }
  return {
    settings,
    campaigns,
    agg,
    metaIds,
    templates: a.templates ?? emptyTemplates(),
    contactsByDigits: a.contactsByDigits,
    tally,
    fingerprint: sha256(JSON.stringify({ shas: a.shas, settings })),
  };
}
