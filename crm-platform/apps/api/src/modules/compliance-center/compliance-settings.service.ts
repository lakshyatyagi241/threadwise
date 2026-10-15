import { HttpStatus, Injectable } from '@nestjs/common';
import {
  COMPLIANCE_DEFAULTS,
  ERROR_CODES,
  countryCodeOf,
  suggestRegimes,
  type ComplianceLinks,
  type ComplianceSettings,
  type ComplianceSettingsValues,
  type UpdateComplianceSettingsInput,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { ComplianceRepository, type SettingsRow } from './compliance.repository';

const MODULE_KEY = 'compliance_settings';

/** Words in minutes of the day, for the window checks. */
const minutes = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

export function isKnownTimezone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** The rules a schema cannot say: a window needs a start before its end, a zone must exist. Returns the problems by field path. */
export function settingsProblems(
  v: ComplianceSettingsValues,
): Array<{ path: string; message: string }> {
  const bad: Array<{ path: string; message: string }> = [];
  if (v.windowTimezone !== null && !isKnownTimezone(v.windowTimezone)) {
    bad.push({ path: 'windowTimezone', message: 'Not an IANA time zone.' });
  }
  if (v.quietHours.enabled && v.quietHours.start === v.quietHours.end) {
    bad.push({
      path: 'quietHours.end',
      message: 'The quiet hours need an end different from the start.',
    });
  }
  if (v.callingWindow.enabled) {
    if (minutes(v.callingWindow.start) >= minutes(v.callingWindow.end)) {
      bad.push({
        path: 'callingWindow.end',
        message: 'The calling window ends after it starts, on the same day.',
      });
    }
    if (v.callingWindow.days.length === 0) {
      bad.push({ path: 'callingWindow.days', message: 'Pick at least one day.' });
    }
  }
  if (v.secondaryNoticeLocale === 'en') {
    bad.push({
      path: 'secondaryNoticeLocale',
      message: 'English is always the first notice. Pick another language.',
    });
  }
  return bad;
}

/** Field-level audit delta. Officer contacts are recorded as "changed", never with their values. */
export function settingsDelta(
  was: ComplianceSettingsValues,
  now: ComplianceSettingsValues,
): Record<string, { old: unknown; new: unknown }> {
  const delta: Record<string, { old: unknown; new: unknown }> = {};
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const plain = [
    'regimes',
    'privacyUrl',
    'termsUrl',
    'childrenPolicy',
    'parentalConsentRequired',
    'offerSaleShareOptOut',
    'optOutNoticeUrl',
    'quietHours',
    'callingWindow',
    'windowTimezone',
    'dndRegistry',
    'secondaryNoticeLocale',
    'subprocessorsPublic',
  ] as const;
  for (const k of plain) {
    if (!same(was[k], now[k])) delta[k] = { old: was[k], new: now[k] };
  }
  for (const k of ['dpo', 'grievanceOfficer', 'consentManager'] as const) {
    if (!same(was[k], now[k])) delta[k] = { old: 'previous', new: 'changed' };
  }
  return delta;
}

/**
 * The Compliance center's settings (BL-172, BL-175, BL-176): the profiles switched on, the officer contacts, the links, the children
 * flag, the extras of the DPDP and CCPA profiles, and the quiet hours, calling window and DND choice. The country SUGGESTS profiles
 * (`suggestion`); nothing is switched on until a person saves a choice. The windows are enforced by `SendWindowService` (BL-177): a
 * marketing send inside the quiet hours is held, a dial outside the calling window is refused. The DND choice is still a note.
 */
@Injectable()
export class ComplianceSettingsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: ComplianceRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /** The saved values, or the defaults for a workspace that never saved. */
  static valuesOf(row: SettingsRow | null): ComplianceSettingsValues {
    return row?.values ?? COMPLIANCE_DEFAULTS;
  }

  async get(): Promise<ComplianceSettings> {
    const orgId = RequestContextStore.orgId();
    return this.db.tx(async (tx) => {
      const [row, org] = await Promise.all([
        this.repo.getSettings(tx, orgId),
        this.repo.orgFacts(tx, orgId),
      ]);
      // The billing country wins when it is a country we can read; else the one given at onboarding.
      const billing = countryCodeOf(org.billingCountry);
      const onboarding = countryCodeOf(org.country);
      const code = billing ?? onboarding;
      return {
        ...ComplianceSettingsService.valuesOf(row),
        rowVersion: row?.rowVersion ?? null,
        updatedAt: row?.updatedAt ?? null,
        regimesConfirmedAt: row?.regimesConfirmedAt ?? null,
        suggestion: {
          country: code,
          source: billing ? 'billing' : onboarding ? 'onboarding' : null,
          regimes: suggestRegimes(code),
        },
        workspaceTimezone: org.timezone,
      };
    });
  }

  async update(input: UpdateComplianceSettingsInput): Promise<ComplianceSettings> {
    const orgId = RequestContextStore.orgId();
    const { rowVersion, ...values } = input;
    const bad = settingsProblems(values);
    if (bad.length > 0) {
      throw new AppError(
        ERROR_CODES.COMPLIANCE_SETTINGS_INVALID,
        'Some of the settings are not valid.',
        HttpStatus.UNPROCESSABLE_ENTITY,
        bad,
      );
    }
    await this.db.tx(async (tx) => {
      const before = await this.repo.getSettings(tx, orgId);
      if ((before === null) !== (rowVersion === undefined)) {
        throw AppError.rowVersionConflict('Compliance settings');
      }
      const ok = await this.repo.saveSettings(tx, orgId, values, rowVersion);
      if (!ok) throw AppError.rowVersionConflict('Compliance settings');
      await this.audit.record(tx, {
        module: MODULE_KEY,
        recordId: orgId,
        action: before ? 'update' : 'insert',
        delta: settingsDelta(ComplianceSettingsService.valuesOf(before), values),
      });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: orgId,
        eventType: 'compliance.settings_changed',
        payload: { regimes: values.regimes },
      });
    });
    return this.get();
  }

  /** What the form builder and the consent-notice editor offer. Readable by anyone who edits a consent line. */
  async links(): Promise<ComplianceLinks> {
    const orgId = RequestContextStore.orgId();
    return this.db.tx(async (tx) => {
      const row = await this.repo.getSettings(tx, orgId);
      return {
        privacyUrl: row?.values.privacyUrl ?? null,
        termsUrl: row?.values.termsUrl ?? null,
        noticeText: await this.repo.defaultNoticeText(tx, orgId),
      };
    });
  }
}
