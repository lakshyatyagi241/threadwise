import { Injectable } from '@nestjs/common';
import type { Tx } from '@crm/db';
import { hasPreviousSends, type PreviousSendsAudience } from '@crm/contracts';
import {
  cleanNumbers,
  parseCsv,
  parseEmailCsv,
  parseManualEmails,
  parseManualNumbers,
} from './campaign-rules';
import { ContactsService, SegmentsService } from '../crm';
import { CampaignsRepository } from './campaigns.repository';

export interface AudienceInput {
  contactIds?: readonly string[];
  groupIds?: readonly string[];
  tagIds?: readonly string[];
  segmentIds?: readonly string[];
  /** `any`: a contact in at least one picked group, tag or segment (the default). `all`: in one picked item of each kind that has picks. */
  audienceMatch?: 'any' | 'all';
  manualNumbers?: string;
  csvText?: string;
  /** Who earlier broadcasts and campaigns went to (optionally only those who read, replied...). */
  previousSends?: PreviousSendsAudience | null;
  /** An email campaign: the typed text and the file hold email addresses, not phone numbers. */
  email?: boolean;
}

/** Whether the form carried any audience at all (an edit that sent none leaves the recipients alone). */
export const hasAudience = (a: AudienceInput): boolean =>
  (a.contactIds?.length ?? 0) +
    (a.groupIds?.length ?? 0) +
    (a.tagIds?.length ?? 0) +
    (a.segmentIds?.length ?? 0) +
    (a.manualNumbers?.trim().length ?? 0) +
    (a.csvText?.trim().length ?? 0) +
    (hasPreviousSends(a.previousSends) ? 1 : 0) >
  0;

/**
 * Builds a campaign's audience (TW-CAMP-004): the contacts picked, the members of the groups, tags and segments picked, and the typed or
 * uploaded numbers, each of which becomes a contact (found by its phone, else created). The result is the unique union in that
 * order. Contacts of another organization are dropped; archived ones too. Opted-out contacts stay on the list on purpose: Reference
 * stamps them `unsubscribed` when the run starts, which is what shows them on the opt-outs tab and lets the campaign finish.
 */
@Injectable()
export class CampaignAudienceService {
  constructor(
    private readonly repo: CampaignsRepository,
    private readonly segments: SegmentsService,
    private readonly contacts: ContactsService,
  ) {}

  async resolve(
    tx: Tx,
    orgId: number,
    _userId: number | null,
    input: AudienceInput,
  ): Promise<number[]> {
    // Groups, tags and segments: the members of each kind are one set. `any` takes the union of the kinds; `all` keeps only the
    // contacts that are in every kind picked (a kind with no picks does not narrow the audience).
    const kinds: number[][] = [];
    if ((input.groupIds ?? []).length > 0)
      kinds.push(await this.repo.groupMemberIds(tx, orgId, input.groupIds ?? []));
    if ((input.tagIds ?? []).length > 0)
      kinds.push(await this.repo.tagMemberIds(tx, orgId, input.tagIds ?? []));
    if ((input.segmentIds ?? []).length > 0)
      kinds.push(await this.segments.memberIdsIn(tx, orgId, input.segmentIds ?? []));
    const picked =
      input.audienceMatch === 'all' && kinds.length > 0
        ? kinds.reduce((acc, ids) => {
            const inKind = new Set(ids);
            return acc.filter((id) => inKind.has(id));
          }, kinds[0]!)
        : kinds.flat();

    const merged: number[] = [
      ...(await this.repo.contactIdsByUuid(tx, orgId, input.contactIds ?? [])),
      ...picked,
      ...(await this.repo.previousSendContactIds(tx, orgId, input.previousSends)),
    ];

    if (input.email) {
      // An email campaign: a typed or uploaded address is found as a contact (by its address), else created, the way a number is.
      // No consent is granted by being on the list; opted-out contacts are skipped when the run starts.
      const file = parseEmailCsv(input.csvText ?? '');
      const addresses = [
        ...new Set([...parseManualEmails(input.manualNumbers ?? ''), ...file.emails]),
      ];
      const emailRows = addresses.map((address) => {
        const attrs = { ...(file.attrsByEmail.get(address) ?? {}) };
        const csvName = attrs.name ?? '';
        delete attrs.name;
        return {
          attrs,
          input: {
            kind: 'email' as const,
            value: address,
            name: csvName !== '' ? csvName : null,
            createdName: address.split('@')[0] ?? address,
            quiet: true,
          },
        };
      });
      const resolvedEmails = await this.contacts.resolveManyByIdentity(
        tx,
        orgId,
        emailRows.map((r) => r.input),
      );
      for (const [i, resolved] of resolvedEmails.entries()) {
        if (resolved.outcome !== 'found' && resolved.outcome !== 'created') continue;
        await this.repo.mergeAttributes(tx, orgId, resolved.contactId, emailRows[i]!.attrs);
        merged.push(resolved.contactId);
      }
      const uniqueEmail = [...new Set(merged)];
      if (uniqueEmail.length === 0) return [];
      const liveEmail = await this.repo.liveIds(tx, orgId, uniqueEmail);
      return uniqueEmail.filter((id) => liveEmail.has(id));
    }

    const csv = parseCsv(input.csvText ?? '');
    const numbers = cleanNumbers([
      ...parseManualNumbers(input.manualNumbers ?? ''),
      ...csv.numbers,
    ]);
    // A typed or uploaded number becomes a contact through the contacts service (identity lookup, the plan's contact cap, default stage
    // and status, audit). Quiet: a recipient list is not live engagement, so no `contact.created` flows start. It grants NO consent: the
    // person has not agreed to anything by being on a list. The numbers that are already contacts are answered in two queries for the whole
    // list; only the new ones go through the full create path.
    const rows = numbers.map((digits) => {
      const attrs = { ...(csv.attrsByPhone.get(digits) ?? {}) };
      const csvName = attrs.name ?? '';
      delete attrs.name;
      return {
        attrs,
        input: {
          kind: 'phone' as const,
          value: `+${digits}`,
          name: csvName !== '' ? csvName : null,
          createdName: `Recipient · ${digits.slice(-4)}`,
          quiet: true,
        },
      };
    });
    const resolvedAll = await this.contacts.resolveManyByIdentity(
      tx,
      orgId,
      rows.map((r) => r.input),
    );
    for (const [i, resolved] of resolvedAll.entries()) {
      // Over the contact cap (or not a usable number) the number is left out; the audience step cannot send to a non-contact anyway.
      if (resolved.outcome !== 'found' && resolved.outcome !== 'created') continue;
      await this.repo.mergeAttributes(tx, orgId, resolved.contactId, rows[i]!.attrs);
      merged.push(resolved.contactId);
    }

    const unique = [...new Set(merged)];
    if (unique.length === 0) return [];
    const live = await this.repo.liveIds(tx, orgId, unique);
    return unique.filter((id) => live.has(id));
  }
}
