import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import 'reflect-metadata';
import {
  CONSENT_GATE_REASONS,
  ERROR_CODES,
  LEGAL_HOLD_REASON_CATEGORIES,
  extendLegalHoldSchema,
  placeLegalHoldSchema,
  privacyRequestsSettingsSchema,
} from '@crm/contracts';
import {
  NO_FACTS,
  RESTRICTED_PURPOSES,
  decideConsent,
  type ConsentFacts,
  type DecideInput,
} from '../../../src/modules/contact-consent/consent-gate.rules';
import {
  LEGAL_HOLD_BLOCKED_MESSAGE,
  isLegalHoldDbError,
  legalHoldActive,
  legalHoldRestricted,
} from '../../../src/common/errors/legal-hold.error';
import { REQUIRED_PERMISSION_KEY } from '../../../src/common/decorators';
import { LegalHoldsController } from '../../../src/modules/privacy/legal-holds/legal-holds.controller';
import { toLegalHold } from '../../../src/modules/privacy/legal-holds/legal-holds.mapper';
import type { HoldRow } from '../../../src/modules/privacy/legal-holds/legal-holds.repository';
import {
  sqlContactNotHeld,
  sqlOrgHasNoHold,
  sqlWorkspaceNotHeld,
} from '../../../src/modules/privacy/legal-holds/legal-hold.sql';
import { toPrivacyRequest } from '../../../src/modules/privacy/requests/privacy-requests.mapper';
import type { RequestRow } from '../../../src/modules/privacy/requests/privacy-requests.repository';

const facts = (f: Partial<ConsentFacts> = {}): ConsentFacts => ({ ...NO_FACTS, ...f });
const decide = (i: Partial<DecideInput> & Pick<DecideInput, 'purpose'>) =>
  decideConsent({ channel: 'whatsapp', requireConsent: false, facts: facts(), ...i });

describe('ConsentGate: a contact under a legal hold is restricted (BL-295)', () => {
  it('refuses marketing with the reason legal_hold, whatever consent says', () => {
    expect(decide({ purpose: 'marketing_messaging', facts: facts({ restricted: true }) })).toEqual({
      decision: 'deny',
      reason: 'legal_hold',
    });
    // Even a recorded grant does not lift a hold.
    expect(
      decide({
        purpose: 'marketing_messaging',
        requireConsent: true,
        facts: facts({ restricted: true, ledgerState: 'granted' }),
      }).reason,
    ).toBe('legal_hold');
  });

  it('refuses AI processing, profiling, sharing and staff AI help', () => {
    for (const [purpose, channel] of [
      ['ai_content_processing', 'whatsapp'],
      ['analytics_profiling', 'whatsapp'],
      ['third_party_sharing', 'whatsapp'],
      ['staff_ai_assist', 'whatsapp'],
      ['voice_ai_conversation', 'voice'],
    ] as const) {
      expect(decide({ purpose, channel, facts: facts({ restricted: true }) })).toMatchObject({
        decision: 'deny',
        reason: 'legal_hold',
      });
    }
  });

  it('keeps serving the customer: service messaging is allowed under a hold', () => {
    expect(decide({ purpose: 'service_messaging', facts: facts({ restricted: true }) })).toEqual({
      decision: 'allow',
      reason: 'utility_exempt',
    });
    expect(
      decide({
        purpose: 'service_messaging',
        replyWindowOpen: true,
        facts: facts({ restricted: true }),
      }).decision,
    ).toBe('allow');
  });

  it('changes nothing for a contact that is not held (today behaviour, exactly)', () => {
    expect(decide({ purpose: 'marketing_messaging' })).toEqual({
      decision: 'allow',
      reason: 'policy_off',
    });
    expect(
      decide({ purpose: 'marketing_messaging', facts: facts({ restricted: false }) }).reason,
    ).toBe('policy_off');
  });

  it('the reason is in the closed set, and the restricted purposes are the documented ones', () => {
    expect(CONSENT_GATE_REASONS).toContain('legal_hold');
    expect([...RESTRICTED_PURPOSES].sort()).toEqual(
      [
        'ai_content_processing',
        'analytics_profiling',
        'marketing_messaging',
        'staff_ai_assist',
        'third_party_sharing',
        'voice_ai_conversation',
      ].sort(),
    );
  });
});

describe('the refusal a purge path answers with', () => {
  it('is a neutral 409 LEGAL_HOLD_ACTIVE that never names a matter', () => {
    const err = legalHoldActive(3);
    expect(err.getStatus()).toBe(409);
    expect(err.code).toBe(ERROR_CODES.LEGAL_HOLD_ACTIVE);
    expect(err.message).toBe(LEGAL_HOLD_BLOCKED_MESSAGE);
    // The count of held records is for the audit row, not for the caller.
    expect(err.details).toEqual([{ path: 'held', message: 'true' }]);
    for (const word of ['investigation', 'legal', 'hold', 'claim', 'regulator']) {
      expect(LEGAL_HOLD_BLOCKED_MESSAGE.toLowerCase()).not.toContain(word);
      expect(legalHoldRestricted().message.toLowerCase()).not.toContain('investigation');
    }
    expect(legalHoldActive(1, true).details).toContainEqual({
      path: 'restricted',
      message: 'true',
    });
  });

  it('recognises the error of the database delete trigger, also when wrapped', () => {
    const raw = new Error('LEGAL_HOLD_ACTIVE: this record is protected and cannot be deleted');
    expect(isLegalHoldDbError(raw)).toBe(true);
    expect(isLegalHoldDbError(new Error('Failed query', { cause: raw }))).toBe(true);
    expect(isLegalHoldDbError(new Error('duplicate key'))).toBe(false);
    expect(isLegalHoldDbError(null)).toBe(false);
  });
});

describe('contracts', () => {
  const uuid = '8f14e45f-ceea-467a-9575-9bbbc3c2f2c1';

  it('a contact hold needs a subject, a workspace hold must not name one', () => {
    const base = { reasonCategory: 'legal_claim', caseRef: 'CASE-1' } as const;
    expect(
      placeLegalHoldSchema.safeParse({ ...base, scope: 'contact', subjectId: uuid }).success,
    ).toBe(true);
    expect(placeLegalHoldSchema.safeParse({ ...base, scope: 'contact' }).success).toBe(false);
    expect(placeLegalHoldSchema.safeParse({ ...base, scope: 'workspace' }).success).toBe(true);
    expect(
      placeLegalHoldSchema.safeParse({ ...base, scope: 'workspace', subjectId: uuid }).success,
    ).toBe(false);
  });

  it('knows exactly the four reason categories, and a case reference is required', () => {
    expect([...LEGAL_HOLD_REASON_CATEGORIES]).toEqual([
      'legal_obligation',
      'legal_claim',
      'regulator_request',
      'internal_investigation',
    ]);
    expect(
      placeLegalHoldSchema.safeParse({
        scope: 'workspace',
        reasonCategory: 'legal_claim',
        caseRef: '  ',
      }).success,
    ).toBe(false);
    expect(
      placeLegalHoldSchema.safeParse({ scope: 'workspace', reasonCategory: 'fun', caseRef: 'X' })
        .success,
    ).toBe(false);
  });

  it('extend needs at least one change; the notice override is bounded', () => {
    expect(extendLegalHoldSchema.safeParse({}).success).toBe(false);
    expect(extendLegalHoldSchema.safeParse({ expiresAt: null }).success).toBe(true);
    expect(privacyRequestsSettingsSchema.safeParse({ slaDays: 30 }).success).toBe(true);
    expect(
      privacyRequestsSettingsSchema.safeParse({
        slaDays: 30,
        legalHoldRequesterNotice: 'x'.repeat(1501),
      }).success,
    ).toBe(false);
  });
});

describe('permissions: no new keys, the existing privacy ones', () => {
  const proto = LegalHoldsController.prototype as unknown as Record<string, unknown>;
  const keyOf = (name: string) =>
    Reflect.getMetadata(REQUIRED_PERMISSION_KEY, proto[name] as object) as string[] | undefined;

  it('placing, extending, reviewing and releasing need privacy.requests.manage', () => {
    for (const name of ['place', 'extend', 'review', 'release']) {
      expect(keyOf(name), name).toEqual(['privacy.requests.manage']);
    }
  });

  it('reading the register, one hold, a status and the export need privacy.requests.read', () => {
    for (const name of ['list', 'get', 'status', 'export']) {
      expect(keyOf(name), name).toEqual(['privacy.requests.read']);
    }
  });
});

const holdRow = (over: Partial<HoldRow> = {}): HoldRow => ({
  id: 1,
  uuid: '8f14e45f-ceea-467a-9575-9bbbc3c2f2c1',
  scope: 'contact',
  contactId: 5,
  contactUuid: '11111111-1111-4111-8111-111111111111',
  leadId: null,
  leadUuid: null,
  subjectLabel: 'R•••• · ••••4821',
  reasonCategory: 'legal_claim',
  caseRef: 'CASE-1',
  note: null,
  reviewAt: new Date('2026-10-01T00:00:00Z'),
  expiresAt: null,
  status: 'active',
  placedBy: 2,
  placedByName: 'Admin',
  placedAt: new Date('2026-09-01T00:00:00Z'),
  lastReviewedByName: null,
  lastReviewedAt: null,
  releasedByName: null,
  releasedAt: null,
  releaseNote: null,
  restrictedCases: 0,
  rowVersion: 1,
  ...over,
});

describe('the register shape', () => {
  it('flags a review that is overdue, only while the hold is active', () => {
    const now = new Date('2026-10-18T00:00:00Z');
    expect(toLegalHold(holdRow(), now).reviewDue).toBe(true);
    expect(toLegalHold(holdRow({ status: 'released', releasedAt: now }), now).reviewDue).toBe(
      false,
    );
    expect(toLegalHold(holdRow({ reviewAt: null }), now).reviewDue).toBe(false);
  });

  it('shows the subject uuid only for the scope it belongs to, never an internal id', () => {
    const h = toLegalHold(holdRow());
    expect(h.subjectId).toBe('11111111-1111-4111-8111-111111111111');
    expect(JSON.stringify(h)).not.toContain('"contactId"');
    expect(
      toLegalHold(holdRow({ scope: 'workspace', contactId: null, contactUuid: null })).subjectId,
    ).toBeNull();
  });
});

const requestRow = (over: Partial<RequestRow> = {}): RequestRow =>
  ({
    id: 9,
    uuid: '22222222-2222-4222-8222-222222222222',
    requestType: 'erasure',
    status: 'in_progress',
    subjectKind: 'contact',
    contactId: 5,
    contactUuid: '11111111-1111-4111-8111-111111111111',
    leadId: null,
    leadUuid: null,
    identifierKind: null,
    identifierCipher: null,
    subjectLabel: 'R••••',
    requesterChannel: 'staff',
    internalNote: null,
    receivedAt: new Date('2026-10-01T00:00:00Z'),
    dueAt: new Date('2026-10-31T00:00:00Z'),
    verificationMethod: null,
    verificationEvidenceRef: null,
    verifiedAt: null,
    legalHold: false,
    legalHoldReason: null,
    restrictedAt: null,
    restrictedHoldId: null,
    erasureConfirmedBy: null,
    erasureConfirmedAt: null,
    historyMode: 'delete',
    rejectionReason: null,
    dryRunAt: null,
    dryRunSummary: null,
    resultSummary: {},
    proof: null,
    proofSha256: null,
    completedAt: null,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    rowVersion: 1,
    ...over,
  }) as RequestRow;

describe('a rights case under a hold', () => {
  it('is restricted while open and carries the workspace wording; the clock keeps running', () => {
    const at = new Date('2026-10-10T00:00:00Z');
    const r = toPrivacyRequest(
      requestRow({ restrictedAt: at }),
      new Date('2026-10-18T00:00:00Z'),
      'Our own wording',
    );
    expect(r.restricted).toBe(true);
    expect(r.restrictedAt).toBe(at.toISOString());
    expect(r.restrictionNotice).toBe('Our own wording');
    expect(r.daysLeft).not.toBeNull();
    // Erasure stays an available action: executing it while held records the confirmation (the call answers 409).
    expect(r.allowed.erase).toBe(true);
  });

  it('is not restricted once it is closed, and an ordinary case is unchanged', () => {
    const done = toPrivacyRequest(requestRow({ status: 'completed', restrictedAt: new Date() }));
    expect(done.restricted).toBe(false);
    expect(done.restrictionNotice).toBeNull();
    const plain = toPrivacyRequest(requestRow());
    expect(plain.restricted).toBe(false);
    expect(plain.restrictedAt).toBeNull();
  });
});

describe('SQL helpers for the sweeps', () => {
  it('only accept plain column references', () => {
    expect(() => sqlContactNotHeld('w.org_id', 'w.contact_id')).not.toThrow();
    expect(() => sqlOrgHasNoHold('org_id')).not.toThrow();
    expect(() => sqlWorkspaceNotHeld('o.id')).not.toThrow();
    expect(() => sqlContactNotHeld('w.org_id; DROP TABLE contacts', 'w.contact_id')).toThrow();
    expect(() => sqlContactNotHeld('w.org_id', '1) OR (1=1')).toThrow();
  });
});

/**
 * Coverage guard (docs/specs/legal-hold.md section 6): every purge path that was found and made hold-aware must keep asking the question.
 * A refactor that drops the condition fails here, not in a court. A NEW purge path (the retention engine, BL-146) is added to this list
 * in the same change that adds it.
 */
describe('every known purge path asks the legal-hold question', () => {
  const root = resolve(__dirname, '../../../src/modules');
  const read = (file: string) => readFileSync(resolve(root, file), 'utf8');
  const HOLD_AWARE: Array<[file: string, needle: RegExp]> = [
    ['privacy/engine/erasure.service.ts', /assertContactsNotHeld/],
    ['privacy/requests/privacy-requests.service.ts', /subjectHeld/],
    ['privacy/legal-holds/legal-hold-maintenance.service.ts', /subjectHeld/],
    ['crm/contact-dedupe/contact-dedupe.service.ts', /assertContactsNotHeld/],
    ['crm/contact-import/contact-import.engine.ts', /is_subject_held/],
    ['crm/contact-bulk/contact-bulk.service.ts', /is_subject_held/],
    ['calling-voice/call-recording.repository.ts', /is_subject_held/],
    ['calling-voice/logging/call-log-retention.service.ts', /is_subject_held/],
    ['leads/lead-retention-sweep.service.ts', /is_subject_held/],
    ['forms-builder/form-retention-sweep.service.ts', /is_subject_held/],
    ['lead-scoring/lead-scoring.repository.ts', /is_subject_held/],
    ['lead-scoring/lead-chat-digest.repository.ts', /is_subject_held/],
    ['audit-log/audit-log.repository.ts', /is_subject_held/],
    ['contact-consent/consent-export.repository.ts', /is_subject_held/],
    ['crm/revenue-report/revenue-export.repository.ts', /is_subject_held/],
    ['privacy/requests/privacy-requests.repository.ts', /is_subject_held/],
    ['plans-subscriptions-trials/plan-retention.service.ts', /org_has_active_legal_hold/],
    ['workspaces-teams-tenancy/lifecycle/lifecycle.repository.ts', /org_has_active_legal_hold/],
    ['company-briefs/brief-facts.service.ts', /is_subject_held/],
    ['ai-copilot-lead-finder/ai-crm-toolkit.service.ts', /is_subject_held/],
    ['lead-scoring/lead-scoring.service.ts', /isRestricted/],
    ['lead-scoring/lead-chat-digest.service.ts', /isRestricted/],
    ['contact-consent/consent-gate.service.ts', /is_subject_held/],
  ];

  for (const [file, needle] of HOLD_AWARE) {
    it(file, () => {
      expect(read(file)).toMatch(needle);
    });
  }
});
