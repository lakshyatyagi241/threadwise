import { Injectable } from '@nestjs/common';
import type { ContactGroupResponse, V1ContactGroup, V1CreateContactGroup } from '@crm/contracts';
import { AppError } from '../../../../../common/errors/app-error';
import { ContactGroupsService } from '../../../../crm';
import { uuidOrNotFound } from '../v1-ids';

/** Groups are stored as hex colours (a database check); WaDesk took any 32 characters and the dashboard only ever sent hex. */
const HEX = /^#[0-9a-fA-F]{6}$/;
const PAGE = 200;
/** A workspace with more groups than this has outgrown the "whole list" WaDesk answered; the cap only guards against an endless loop. */
const MAX_PAGES = 50;

export function toV1Group(g: ContactGroupResponse): V1ContactGroup {
  return {
    id: g.id,
    name: g.name,
    note: g.note,
    color: g.color,
    contacts_count: g.memberCount,
    created_at: g.createdAt,
  };
}

/** The contact groups of the customer API (WD-API-027 to 029), delegated to the service the dashboard uses. */
@Injectable()
export class V1ContactGroupsService {
  constructor(private readonly groups: ContactGroupsService) {}

  /** The whole list, newest first: WaDesk did not page it. */
  async list(): Promise<V1ContactGroup[]> {
    const out: V1ContactGroup[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < MAX_PAGES; i += 1) {
      const page = await this.groups.list({ limit: PAGE, order: 'desc', cursor });
      out.push(...page.data.map(toV1Group));
      if (!page.page.hasMore || !page.page.nextCursor) break;
      cursor = page.page.nextCursor;
    }
    return out;
  }

  async create(body: V1CreateContactGroup): Promise<{ group: V1ContactGroup; created: boolean }> {
    if (body.color && !HEX.test(body.color)) {
      throw AppError.validation('The given data was invalid.', [
        { path: 'color', message: 'The color must be a hex value like #7C3AED.' },
      ]);
    }
    const res = await this.groups.create({
      name: body.name,
      note: body.note ?? null,
      color: body.color ?? null,
    });
    return { group: toV1Group(res), created: !res.existing };
  }

  async remove(id: string): Promise<{ id: string; deleted: true }> {
    const uuid = uuidOrNotFound(id, 'Contact group');
    await this.groups.remove(uuid);
    return { id: uuid, deleted: true };
  }
}
