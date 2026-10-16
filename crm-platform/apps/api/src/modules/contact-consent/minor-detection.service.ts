import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import {
  earliestToday,
  isUnderAge,
  minorBornAfter,
  minorUntilForBirth,
  type PrivacyFlagSource,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { DatabaseService } from '../../infra/db/database.service';
import { ContactPrivacyRepository } from './contact-privacy.repository';
import { ContactPrivacyService } from './contact-privacy.service';

/** What an evaluation did, for the caller's note and the tests. */
export type MinorEvaluation = 'flagged' | 'refreshed' | 'lifted' | 'none';

/** How many contacts one sweep run changes per kind, so a huge backlog is worked through over several nights, never in one transaction. */
const SWEEP_BATCH = 500;
/** The oldest age a form can ask for (21): a workspace's own age is never above it, so nobody older is a candidate for the sweep. */
const YOUNGEST_CANDIDATE_AGE = 21;

/**
 * Turns a date of birth, or an age answer, into the minor flag (BL-211, spec docs/specs/privacy-and-data-governance.md 11.10), through
 * the one door that writes the flag (`ContactPrivacyService`). Three entry points:
 *
 *  - `evaluateInTx`  a contact's stored date of birth against the workspace's minor age (a write of the date: contact form, REST v1, import,
 *                    form, flow). Flags an under-age contact with the source `dob` and an expiry day, refreshes the expiry when it moved,
 *                    and lifts a `dob` flag once the contact has come of age.
 *  - `flagFromAnswer` an under-age ANSWER (a form, an intake, a flow): flags the contact with the answer's own expiry.
 *  - `sweep`         the nightly worker run: lifts the `dob` flags whose day has come, and flags the under-age contacts nobody evaluated.
 *
 * A flag a person, the API, an import or a flow set (any source but `dob`) is never touched here (`planFlagChange` refuses): a birthday
 * does not overrule a decision. Run inside a tenant transaction and a request context (the audit row reads it).
 */
@Injectable()
export class MinorDetectionService {
  private readonly logger = new Logger(MinorDetectionService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: ContactPrivacyRepository,
    private readonly privacy: ContactPrivacyService,
  ) {}

  async evaluateInTx(
    tx: Tx,
    orgId: number,
    contactId: number,
    now: Date = new Date(),
  ): Promise<MinorEvaluation> {
    const dob = await this.repo.dateOfBirth(tx, orgId, contactId);
    if (!dob) return 'none';
    const [facts, flags] = await Promise.all([
      this.repo.complianceFacts(tx, orgId),
      this.repo.flagsOf(tx, orgId, contactId),
    ]);
    const evidence = { reference: `dob:${facts.minorAge}` };
    if (isUnderAge(dob, facts.minorAge, now)) {
      const until = minorUntilForBirth(dob, facts.minorAge);
      if (flags.isMinor) {
        // A flag a person set is theirs. One the system set only needs its expiry kept right (the date or the age line moved).
        if (flags.minorSource !== 'dob' || flags.minorUntil === until) return 'none';
        const out = await this.change(tx, orgId, contactId, true, until, evidence, now);
        return out ? 'refreshed' : 'none';
      }
      if (flags.dobOverrideFor === dob) return 'none';
      const out = await this.change(tx, orgId, contactId, true, until, evidence, now);
      return out ? 'flagged' : 'none';
    }
    if (flags.isMinor && flags.minorSource === 'dob' && flags.minorUntil !== null) {
      const out = await this.change(tx, orgId, contactId, false, null, evidence, now);
      return out ? 'lifted' : 'none';
    }
    return 'none';
  }

  /**
   * A flag whose day has come. With a stored date of birth the date decides (`evaluateInTx` refreshes or lifts it); a flag from a bare age
   * answer has no date to read, so it lapses on its own day.
   */
  async settleLapsedInTx(
    tx: Tx,
    orgId: number,
    contactId: number,
    now: Date = new Date(),
  ): Promise<MinorEvaluation> {
    if (await this.repo.dateOfBirth(tx, orgId, contactId)) {
      return this.evaluateInTx(tx, orgId, contactId, now);
    }
    const flags = await this.repo.flagsOf(tx, orgId, contactId);
    if (
      !flags.isMinor ||
      flags.minorSource !== 'dob' ||
      flags.minorUntil === null ||
      flags.minorUntil > earliestToday(now)
    ) {
      return 'none';
    }
    const out = await this.change(tx, orgId, contactId, false, null, { reference: 'age_lapsed' }, now);
    return out ? 'lifted' : 'none';
  }

  /**
   * A visitor said they are under the line (a date of birth or an age on a form, an intake or a flow). Flags the contact and returns
   * whether a flag was written. `source` is `dob` for a date or an age (it lapses on `minorUntil`), `declaration` for a box left
   * unticked (it never lapses by itself).
   */
  async flagFromAnswer(
    tx: Tx,
    orgId: number,
    contactId: number,
    answer: {
      source: Extract<PrivacyFlagSource, 'dob' | 'declaration'>;
      minorUntil: string | null;
      evidence: Record<string, unknown>;
      note?: string | null;
      now?: Date;
    },
  ): Promise<boolean> {
    const out = await this.privacy.changeInTx(tx, orgId, {
      contactId,
      kind: 'minor',
      value: true,
      source: answer.source,
      evidence: answer.evidence,
      note: answer.note ?? null,
      occurredAt: answer.now,
      actorUserId: null,
      minorUntil: answer.source === 'dob' ? answer.minorUntil : null,
      idempotencyKey: `${answer.source}:${randomUUID()}`,
    });
    return out.recorded;
  }

  /**
   * The nightly run (worker): lifts the `dob` flags whose day has come, then flags the contacts whose date of birth says minor and whom
   * nothing evaluated (a path that wrote the date without asking). Each contact is its own small transaction as the system actor of its
   * workspace, so one bad row never blocks the rest. Returns the counts.
   */
  async sweep(now: Date = new Date()): Promise<{ lifted: number; flagged: number }> {
    let lifted = 0;
    let flagged = 0;
    const today = earliestToday(now);

    const lapsed = await this.db.privileged((tx) => this.repo.lapsedFlags(tx, today, SWEEP_BATCH));
    for (const row of lapsed) {
      if ((await this.evaluateOne(row.orgId, row.contactId, now, true)) === 'lifted') lifted += 1;
    }

    const orgs = await this.db.privileged((tx) =>
      this.repo.orgsWithYoungContacts(tx, minorBornAfter(YOUNGEST_CANDIDATE_AGE, now)),
    );
    for (const orgId of orgs) {
      const age = await this.db.txAs({ orgId, userId: null }, async (tx) => {
        return (await this.repo.complianceFacts(tx, orgId)).minorAge;
      });
      const ids = await this.db.txAs({ orgId, userId: null }, (tx) =>
        this.repo.unflaggedYoung(tx, orgId, minorBornAfter(age, now), SWEEP_BATCH),
      );
      for (const id of ids) {
        if ((await this.evaluateOne(orgId, id, now, false)) === 'flagged') flagged += 1;
      }
    }
    if (lifted + flagged > 0) this.logger.log({ lifted, flagged }, '[MINOR] birthday sweep');
    return { lifted, flagged };
  }

  private async evaluateOne(
    orgId: number,
    contactId: number,
    now: Date,
    lapsed: boolean,
  ): Promise<MinorEvaluation> {
    try {
      return await this.asSystem(orgId, () =>
        this.db.txAs({ orgId, userId: null }, (tx) =>
          lapsed
            ? this.settleLapsedInTx(tx, orgId, contactId, now)
            : this.evaluateInTx(tx, orgId, contactId, now),
        ),
      );
    } catch (err) {
      this.logger.error({ err: String(err), orgId, contactId }, '[MINOR] sweep could not evaluate a contact');
      return 'none';
    }
  }

  private change(
    tx: Tx,
    orgId: number,
    contactId: number,
    value: boolean,
    minorUntil: string | null,
    evidence: Record<string, unknown>,
    now: Date,
  ): Promise<boolean> {
    return this.privacy
      .changeInTx(tx, orgId, {
        contactId,
        kind: 'minor',
        value,
        source: 'dob',
        evidence,
        actorUserId: null,
        occurredAt: now,
        minorUntil,
        idempotencyKey: `dob:${randomUUID()}`,
      })
      .then((o) => o.recorded);
  }

  /** The audit row names the context's workspace and actor: the sweep and a public page act as the system of THIS workspace. */
  private asSystem<T>(orgId: number, fn: () => Promise<T>): Promise<T> {
    const current = RequestContextStore.peek();
    if (current && current.orgId === orgId) return fn();
    return RequestContextStore.run(
      {
        requestId: `minor-${randomUUID()}`,
        orgId,
        actorType: 'system',
        actorId: null,
        userId: null,
      },
      fn,
    );
  }
}
