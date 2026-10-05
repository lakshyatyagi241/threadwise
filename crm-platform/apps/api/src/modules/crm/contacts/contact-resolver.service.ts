import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { canonicalizePhone } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../../common/context/request-context';
import { AuditService } from '../../../kernel/audit/audit.service';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import { PlanEntitlementService } from '../../plans-subscriptions-trials';
import { TagsRepository } from '../tags/tags.repository';
import type {
  ContactLink,
  ContactResolveInput,
  ContactResolverPort,
} from '../contact-resolver.port';
import { ContactsRepository } from './contacts.repository';
import { ContactsService } from './contacts.service';

const CONTACTS = 'contacts';
const TAG_COLOR = '#0B7285';

type Fillable = 'name' | 'email' | 'address';

/** The text trimmed, or null when nothing is left. */
export const clean = (v: string | null | undefined): string | null => {
  const t = v?.trim();
  return t ? t : null;
};

/** What a store order knows about its buyer that the contact lacks: only blanks are filled, a curated value is never replaced. */
export function blankFills(
  row: Record<Fillable, string | null>,
  have: Record<Fillable, string | null>,
): Partial<Record<Fillable, string>> {
  const patch: Partial<Record<Fillable, string>> = {};
  if (!clean(row.name) && have.name) patch.name = have.name;
  if (!clean(row.email) && have.email) patch.email = have.email;
  if (!clean(row.address) && have.address) patch.address = have.address;
  return patch;
}

/**
 * Find-or-create a contact by phone for the commerce flows (WaDesk kept store customers apart from contacts; the owner decided on
 * 2026-10-05 to link them). It is a thin policy layer over `ContactsService.resolveOrCreateByIdentity`, which already owns the rules
 * every writer shares: one canonicaliser, identity-first lookup, an advisory lock per number, the plan's contact cap, the workspace's
 * default stage and status, audit and `contact.created` in the caller's transaction. On top of that it fills the buyer's blanks (name,
 * email, delivery address) and tags the contact, all inside a savepoint so a failure is a skipped link, not a lost order.
 */
@Injectable()
export class ContactResolverService implements ContactResolverPort {
  private readonly logger = new Logger(ContactResolverService.name);

  constructor(
    private readonly contacts: ContactsService,
    private readonly repo: ContactsRepository,
    private readonly tags: TagsRepository,
    private readonly entitlements: PlanEntitlementService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  async findOrCreateByPhone(
    tx: Tx,
    orgId: number,
    input: ContactResolveInput,
  ): Promise<ContactLink> {
    const raw = clean(input.phone);
    if (!raw) return { outcome: 'skipped', reason: 'no_phone' };
    if (!canonicalizePhone({ number: raw })) {
      return { outcome: 'skipped', reason: 'unusable_phone' };
    }
    try {
      // A savepoint: a statement that fails inside must not abort the order's own transaction.
      return await this.inOrg(orgId, () =>
        tx.transaction((sp) => this.resolve(sp as unknown as Tx, orgId, raw, input)),
      );
    } catch (err) {
      this.logger.warn({ err: String(err), orgId }, 'store contact link failed: no contact link');
      return { outcome: 'skipped', reason: 'error' };
    }
  }

  /**
   * The audit row and the events of a contact this writes name the context's organization and actor. A buyer on a public shop page (or
   * a webhook) has no staff context of its own, so the work runs as the system actor of THIS organization; a staff member who triggers
   * it from their own request of the same organization keeps their name on the rows.
   */
  private inOrg<T>(orgId: number, fn: () => Promise<T>): Promise<T> {
    const current = RequestContextStore.peek();
    if (current && current.orgId === orgId && current.actorType === 'user') return fn();
    return RequestContextStore.run(
      {
        requestId: current?.requestId ?? `store-${randomUUID()}`,
        orgId,
        actorType: 'system',
        actorId: null,
        userId: null,
        ip: current?.ip,
      },
      fn,
    );
  }

  private async resolve(
    tx: Tx,
    orgId: number,
    phone: string,
    input: ContactResolveInput,
  ): Promise<ContactLink> {
    const name = clean(input.name);
    const resolved = await this.contacts.resolveOrCreateByIdentity(tx, orgId, {
      kind: 'phone',
      value: phone,
      name,
      source: input.source,
      eventPayload: { origin: 'store' },
    });
    if (resolved.outcome === 'quota_reached') {
      this.logger.warn(
        { orgId },
        'contact cap reached: the order is placed without a contact link',
      );
      return { outcome: 'skipped', reason: 'plan_limit_reached' };
    }
    if (resolved.outcome === 'unusable') return { outcome: 'skipped', reason: 'unusable_phone' };

    await this.fillBlanks(tx, orgId, resolved.contactId, resolved.uuid, resolved.outcome, {
      name,
      email: clean(input.email)?.toLowerCase() ?? null,
      address: clean(input.address),
    });
    if (input.tag) await this.applyTag(tx, orgId, resolved.contactId, input.tag);
    return { outcome: resolved.outcome, contactId: resolved.contactId, contactUuid: resolved.uuid };
  }

  private async fillBlanks(
    tx: Tx,
    orgId: number,
    id: number,
    uuid: string,
    outcome: 'found' | 'created',
    have: Record<Fillable, string | null>,
  ): Promise<void> {
    if (!have.name && !have.email && !have.address) return;
    const row = await tx.execute(
      sql`SELECT name, email::text AS email, address FROM contacts WHERE org_id = ${orgId} AND id = ${id}`,
    );
    const current = row.rows[0] as Record<Fillable, string | null> | undefined;
    if (!current) return;
    const patch = blankFills(current, have);
    if (patch.email) {
      // An address another contact already holds is not stolen: the order keeps it, this contact stays without.
      const holder = await this.repo.findByIdentity(tx, orgId, 'email', patch.email);
      const legacy = await tx.execute(
        sql`SELECT id FROM contacts WHERE org_id = ${orgId} AND normalized_email = ${patch.email} AND id <> ${id} LIMIT 1`,
      );
      if ((holder !== undefined && holder !== id) || legacy.rows.length > 0) delete patch.email;
      else await this.repo.addIdentity(tx, orgId, id, 'email', patch.email);
    }
    if (Object.keys(patch).length === 0) return;
    await this.repo.updateFieldsById(tx, orgId, id, { ...patch, updatedBy: null });
    if (outcome === 'created') return;
    await this.audit.record(tx, {
      module: CONTACTS,
      recordId: id,
      action: 'update',
      delta: Object.fromEntries(
        Object.entries(patch).map(([k, v]) => [k, { old: current[k as Fillable] ?? null, new: v }]),
      ),
    });
    await this.outbox.emit(tx, {
      aggregateModule: CONTACTS,
      aggregateId: id,
      eventType: 'contact.updated',
      orgId,
      payload: { uuid, via: 'store' },
    });
  }

  /** Attaches the label; a workspace at its tag cap simply goes without it (a buyer is never refused over a label). */
  private async applyTag(tx: Tx, orgId: number, contactId: number, name: string): Promise<void> {
    let tag = await this.tags.findByName(tx, orgId, name);
    if (!tag) {
      const cap = await this.entitlements.limit(orgId, 'tags');
      if (cap > 0 && (await this.tags.countAll(tx, orgId)) >= cap) return;
      await this.tags.insertIfAbsent(tx, orgId, { name, color: TAG_COLOR });
      tag = await this.tags.findByName(tx, orgId, name);
    }
    if (tag) await this.tags.attach(tx, orgId, [contactId], [tag.id], null);
  }
}
