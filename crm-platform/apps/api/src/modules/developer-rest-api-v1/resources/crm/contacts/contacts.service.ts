import { Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  listContactsQuerySchema,
  type ConsentProof,
  type ContactGroupRef,
  type UpdateContactInput,
  type V1Contact,
  type V1CreateContact,
  type V1UpdateContact,
} from '@crm/contracts';
import { RequestContextStore } from '../../../../../common/context/request-context';
import { ContactPrivacyService } from '../../../../contact-consent';
import { AppError } from '../../../../../common/errors/app-error';
import { DatabaseService } from '../../../../../infra/db/database.service';
import { AuditService } from '../../../../../kernel/audit/audit.service';
import {
  ContactGroupsService,
  ContactsRepository,
  ContactsService,
  toContactResponse,
} from '../../../../crm';
import { has, isUuid, uuidOrNotFound } from '../v1-ids';
import { ContactExtrasRepository } from './contact-extras.repository';
import { toV1Contact } from './contacts.mapper';
import { composeV1Phone } from './phone';

/** One retry on a lost optimistic-lock race: the API has no `rowVersion`, so a concurrent edit must not surface as a 409 to the client. */
const UPDATE_ATTEMPTS = 2;

const invalid = (path: string, message: string) =>
  AppError.validation('The given data was invalid.', [{ path, message }]);

/** The consent block of a request as the service's proof (blank cells are "not given"). */
function toProof(c: V1CreateContact['consent']): ConsentProof | undefined {
  if (!c) return undefined;
  return {
    ...(c.channels ? { channels: c.channels } : {}),
    ...(c.note ? { note: c.note } : {}),
    ...(c.text ? { text: c.text } : {}),
    ...(c.version ? { version: c.version } : {}),
    ...(c.at ? { at: c.at } : {}),
  };
}

/** The key behind the call, for the consent evidence (an id, never the secret). */
function apiKeyRef(ctx: { actorType: string; actorId: number | null }): string | undefined {
  return ctx.actorType === 'api_key' && ctx.actorId !== null ? String(ctx.actorId) : undefined;
}

/** Reference's display name: the typed name, else title, first, middle and last name joined by single spaces. */
function displayName(p: {
  name?: string | null;
  title?: string | null;
  first?: string | null;
  middle?: string | null;
  last?: string | null;
}): string {
  if (p.name) return p.name;
  return [p.title, p.first, p.middle, p.last].filter((x): x is string => Boolean(x)).join(' ');
}

/**
 * The contacts of the customer API (TW-API-022 to 026). Everything that changes goes through `ContactsService`, so an API write has the
 * same identity matching, plan quota, audit and `contact.*` events as one from the dashboard. What the service has no field for is written
 * by `ContactExtrasRepository` in a second transaction of the same request (not atomic with the first: the service owns its transaction).
 */
@Injectable()
export class V1ContactsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly contacts: ContactsService,
    private readonly repo: ContactsRepository,
    private readonly groups: ContactGroupsService,
    private readonly extras: ContactExtrasRepository,
    private readonly audit: AuditService,
    private readonly privacy: ContactPrivacyService,
  ) {}

  async list(query: { limit: number; cursor?: string; search?: string }) {
    const parsed = listContactsQuerySchema.safeParse({
      limit: query.limit,
      cursor: query.cursor,
      q: query.search || undefined,
      expand: 'groups',
    });
    if (!parsed.success) throw invalid('search', 'The search is not valid.');
    // 'all': a key sees the whole workspace (TW-API-022), not just the records of the member who minted it.
    const res = await this.contacts.list(parsed.data, 'all');
    const ctx = RequestContextStore.require();
    const minors = await this.db.tx((tx) =>
      this.privacy.minorUuids(
        tx,
        ctx.orgId,
        res.data.map((c) => c.id),
      ),
    );
    return { data: res.data.map((c) => toV1Contact(c, minors.has(c.id))), page: res.page };
  }

  async show(id: string): Promise<V1Contact> {
    return this.read(uuidOrNotFound(id, 'Contact'));
  }

  async create(body: V1CreateContact): Promise<{ contact: V1Contact; created: boolean }> {
    const ctx = RequestContextStore.require();
    const phone = composeV1Phone(body.phone, body.country_code);
    if (!phone) throw invalid('phone', 'The phone is not a valid number.');
    const groupIds = await this.resolveGroupIds(body.group_ids);

    // `ContactsService.create` hands back the contact an identity already belongs to; saying so keeps a second POST from silently
    // overwriting that contact's title, address and groups with the new request's values.
    const existing = await this.db.tx(async (tx) => {
      const byPhone = await this.repo.findByIdentity(tx, ctx.orgId, 'phone', phone);
      const byEmail = body.email
        ? await this.repo.findByIdentity(tx, ctx.orgId, 'email', body.email)
        : undefined;
      const id = byEmail ?? byPhone;
      return id === undefined ? undefined : (await this.repo.findById(tx, ctx.orgId, id))?.uuid;
    });
    if (existing) {
      // Nothing of the existing contact is overwritten, but a person who agreed through this request has still agreed.
      if (body.consent) {
        await this.contacts.create(
          {
            name:
              displayName({ name: body.name, first: body.first_name, last: body.last_name }) ||
              undefined,
            email: body.email ?? undefined,
            phone,
            consent: toProof(body.consent),
            customFields: {},
          },
          { source: 'api', evidence: { apiKeyId: apiKeyRef(ctx) } },
        );
      }
      return { contact: await this.read(existing), created: false };
    }

    const made = await this.contacts.create(
      {
        name: displayName({
          name: body.name,
          title: body.title,
          first: body.first_name,
          middle: body.middle_name,
          last: body.last_name,
        }),
        firstName: body.first_name ?? undefined,
        lastName: body.last_name ?? undefined,
        email: body.email ?? undefined,
        phone,
        source: 'api',
        isUnsubscribed: body.is_unsubscribed === true,
        consent: toProof(body.consent),
        ...(body.date_of_birth ? { dateOfBirth: body.date_of_birth } : {}),
        customFields: body.attributes ?? {},
      },
      { source: 'api', evidence: { apiKeyId: apiKeyRef(ctx) } },
    );

    await this.db.tx(async (tx) => {
      const row = await this.extras.read(tx, ctx.orgId, made.id);
      if (!row) return;
      await this.extras.write(tx, ctx.orgId, row.id, {
        title: body.title ?? null,
        middleName: body.middle_name ?? null,
        language: body.language ?? null,
        address: body.address ?? null,
        countryCode: body.country_code ?? null,
        message: body.note ?? null,
      });
    });
    if (groupIds.length > 0) await this.groups.setGroupsOfContact(made.id, { groupIds });
    return { contact: await this.read(made.id), created: true };
  }

  async update(id: string, body: V1UpdateContact, raw: unknown): Promise<V1Contact> {
    const uuid = uuidOrNotFound(id, 'Contact');
    const ctx = RequestContextStore.require();
    const groupIds = has(raw, 'group_ids') ? await this.resolveGroupIds(body.group_ids) : undefined;

    for (let attempt = 1; ; attempt += 1) {
      const { row, extras } = await this.db.tx(async (tx) => {
        const row = await this.repo.findByUuid(tx, ctx.orgId, uuid);
        if (!row) throw AppError.notFound('Contact');
        return { row, extras: (await this.extras.read(tx, ctx.orgId, uuid))! };
      });

      const input: UpdateContactInput = { rowVersion: row.rowVersion };
      if (has(raw, 'email')) input.email = body.email ?? null;
      if (has(raw, 'first_name')) input.firstName = body.first_name ?? null;
      if (has(raw, 'last_name')) input.lastName = body.last_name ?? null;
      if (has(raw, 'is_unsubscribed')) input.isUnsubscribed = body.is_unsubscribed === true;
      if (has(raw, 'date_of_birth')) input.dateOfBirth = body.date_of_birth ?? null;
      if (has(raw, 'consent')) input.consent = toProof(body.consent);

      if (has(raw, 'name') || has(raw, 'first_name')) {
        const name = displayName({
          name: body.name,
          title: has(raw, 'title') ? body.title : extras.title,
          first: has(raw, 'first_name') ? body.first_name : row.firstName,
          middle: has(raw, 'middle_name') ? body.middle_name : extras.middleName,
          last: has(raw, 'last_name') ? body.last_name : row.lastName,
        });
        // An empty result keeps the old name (Reference): the service would otherwise blank it.
        if (name !== '') input.name = name;
      }

      if (has(raw, 'phone')) {
        if (body.phone == null) {
          input.phone = null;
        } else {
          const cc = has(raw, 'country_code') ? body.country_code : extras.countryCode;
          const e164 = composeV1Phone(body.phone, cc);
          if (!e164) throw invalid('phone', 'The phone is not a valid number.');
          input.phone = e164;
        }
      }

      // `attributes` replaces the whole object: the service merges, so keys that are gone are sent as null and dropped afterwards.
      let dropKeys: string[] = [];
      if (has(raw, 'attributes')) {
        const next = body.attributes ?? {};
        dropKeys = Object.keys(row.data ?? {}).filter((k) => !(k in next));
        input.customFields = { ...next, ...Object.fromEntries(dropKeys.map((k) => [k, null])) };
      }

      try {
        await this.contacts.update(uuid, input, {
          source: 'api',
          evidence: { apiKeyId: apiKeyRef(ctx) },
        });
      } catch (err) {
        if (
          attempt < UPDATE_ATTEMPTS &&
          err instanceof AppError &&
          err.code === ERROR_CODES.ROW_VERSION_CONFLICT
        )
          continue;
        throw err;
      }

      const patch = {
        ...(has(raw, 'title') ? { title: body.title ?? null } : {}),
        ...(has(raw, 'middle_name') ? { middleName: body.middle_name ?? null } : {}),
        ...(has(raw, 'language') ? { language: body.language ?? null } : {}),
        ...(has(raw, 'address') ? { address: body.address ?? null } : {}),
        ...(has(raw, 'country_code') ? { countryCode: body.country_code ?? null } : {}),
        ...(has(raw, 'note') ? { message: body.note ?? null } : {}),
      };
      if (Object.keys(patch).length > 0 || dropKeys.length > 0) {
        await this.db.tx(async (tx) => {
          await this.extras.write(tx, ctx.orgId, extras.id, patch, dropKeys);
          const delta = this.audit.diff(
            extras as unknown as Record<string, unknown>,
            { ...extras, ...patch } as unknown as Record<string, unknown>,
          );
          if (Object.keys(delta).length > 0) {
            await this.audit.record(tx, {
              module: 'contacts',
              recordId: extras.id,
              action: 'update',
              delta,
            });
          }
        });
      }
      if (groupIds) await this.groups.setGroupsOfContact(uuid, { groupIds });
      return this.read(uuid);
    }
  }

  async remove(id: string): Promise<{ id: string; deleted: true }> {
    const uuid = uuidOrNotFound(id, 'Contact');
    await this.contacts.remove(uuid);
    return { id: uuid, deleted: true };
  }

  /** The contact with its groups as `tags`, read straight from the row so a key sees the whole workspace. */
  private async read(uuid: string): Promise<V1Contact> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!row) throw AppError.notFound('Contact');
      const chips = await this.repo.groupChips(tx, ctx.orgId, [row.id]);
      const minors = await this.privacy.minorUuids(tx, ctx.orgId, [row.uuid]);
      return toV1Contact(toContactResponse(row, { groups: chips }), minors.has(row.uuid));
    });
  }

  /** Every id must be a group of this workspace: a foreign or malformed one is a 422 naming `group_ids.<index>` (TW-API-024 rule 4). */
  private async resolveGroupIds(ids: string[] | null | undefined): Promise<string[]> {
    const wanted = ids ?? [];
    const out: string[] = [];
    for (const [i, gid] of wanted.entries()) {
      let ref: ContactGroupRef | undefined;
      if (isUuid(gid)) {
        try {
          const g = await this.groups.get(gid.toLowerCase());
          ref = { id: g.id, name: g.name, color: g.color };
        } catch (err) {
          if (!(err instanceof AppError) || err.code !== ERROR_CODES.NOT_FOUND) throw err;
        }
      }
      if (!ref) throw invalid(`group_ids.${i}`, 'The selected group_ids is invalid.');
      out.push(ref.id);
    }
    return [...new Set(out)];
  }
}
