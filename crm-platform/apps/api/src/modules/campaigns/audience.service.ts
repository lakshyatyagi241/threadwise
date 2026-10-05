import { Injectable } from '@nestjs/common';
import type { Tx } from '@crm/db';
import { cleanNumbers, parseCsv, parseManualNumbers } from './campaign-rules';
import { CampaignsRepository } from './campaigns.repository';

export interface AudienceInput {
  contactIds?: readonly string[];
  groupIds?: readonly string[];
  tagIds?: readonly string[];
  manualNumbers?: string;
  csvText?: string;
}

/** Whether the form carried any audience at all (an edit that sent none leaves the recipients alone). */
export const hasAudience = (a: AudienceInput): boolean =>
  (a.contactIds?.length ?? 0) +
    (a.groupIds?.length ?? 0) +
    (a.tagIds?.length ?? 0) +
    (a.manualNumbers?.trim().length ?? 0) +
    (a.csvText?.trim().length ?? 0) >
  0;

/**
 * Builds a campaign's audience (WD-CAMP-004): the contacts picked, the members of the groups and tags picked, and the typed or
 * uploaded numbers, each of which becomes a contact (found by its phone, else created). The result is the unique union in that
 * order. Contacts of another organization are dropped; archived ones too. Opted-out contacts stay on the list on purpose: WaDesk
 * stamps them `unsubscribed` when the run starts, which is what shows them on the opt-outs tab and lets the campaign finish.
 */
@Injectable()
export class CampaignAudienceService {
  constructor(private readonly repo: CampaignsRepository) {}

  async resolve(
    tx: Tx,
    orgId: number,
    userId: number | null,
    input: AudienceInput,
  ): Promise<number[]> {
    const merged: number[] = [
      ...(await this.repo.contactIdsByUuid(tx, orgId, input.contactIds ?? [])),
      ...(await this.repo.groupMemberIds(tx, orgId, input.groupIds ?? [])),
      ...(await this.repo.tagMemberIds(tx, orgId, input.tagIds ?? [])),
    ];

    const csv = parseCsv(input.csvText ?? '');
    const numbers = cleanNumbers([
      ...parseManualNumbers(input.manualNumbers ?? ''),
      ...csv.numbers,
    ]);
    for (const digits of numbers) {
      const attrs = { ...(csv.attrsByPhone.get(digits) ?? {}) };
      const csvName = attrs.name ?? '';
      delete attrs.name;
      merged.push(
        await this.repo.rememberPhone(
          tx,
          orgId,
          userId,
          digits,
          csvName !== '' ? csvName : `Recipient · ${digits.slice(-4)}`,
          attrs,
        ),
      );
    }

    const unique = [...new Set(merged)];
    if (unique.length === 0) return [];
    const live = await this.repo.liveIds(tx, orgId, unique);
    return unique.filter((id) => live.has(id));
  }
}
