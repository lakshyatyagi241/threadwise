import { Injectable, Logger } from '@nestjs/common';
import {
  registrationSettingsPatchSchema,
  registrationSettingsSchema,
  securityPolicySchema,
  type OtpTemplateState,
  type RegistrationSettings,
  type SecurityPolicy,
  type SecurityPolicyPatch,
} from '@crm/contracts';
import { AppError } from '../../../common/errors/app-error';
import { PlanCatalogService } from '../../plans-subscriptions-trials';
import { neutraliseAllowlist } from './ip-allowlist';
import { PlatformSettingsService } from './platform-settings.service';

export const POLICY_KEY = 'security.policy';
export const REGISTRATION_KEY = 'registration';

/**
 * Reads the stored document one setting at a time. A value that no longer fits
 * the contract (hand-edited, or written under an older range) falls back to that
 * setting's own default and nothing else changes: one bad key must never reset the
 * rest, because the rest includes the allowlist, the MFA requirements and the
 * send guardrails. Returns the keys that had to be replaced, for the log.
 */
export function salvagePolicy(stored: unknown): { policy: SecurityPolicy; rejected: string[] } {
  const doc =
    stored && typeof stored === 'object' && !Array.isArray(stored)
      ? (stored as Record<string, unknown>)
      : {};
  const whole = securityPolicySchema.safeParse(doc);
  if (whole.success) return { policy: whole.data, rejected: [] };

  const rejected: string[] = [];
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(securityPolicySchema.shape)) {
    const parsed = field.safeParse(doc[key]);
    if (parsed.success) {
      out[key] = parsed.data;
    } else {
      rejected.push(key);
      out[key] = field.parse(undefined);
    }
  }
  return { policy: securityPolicySchema.parse(out), rejected };
}

/**
 * The effective security policy and registration policy.
 *
 * The stored document may be partial or contain keys from an older contract;
 * parsing it through the Zod schema applies defaults, and a key that no longer
 * validates is replaced by its own default (and logged), never the whole document.
 * WaDesk's readers failed open per setting; replacing everything with defaults
 * would silently switch the allowlist, MFA requirements and guardrails off.
 */
@Injectable()
export class SecurityPolicyService {
  private readonly logger = new Logger(SecurityPolicyService.name);
  private lastWarned = 0;

  constructor(
    private readonly settings: PlatformSettingsService,
    private readonly plans: PlanCatalogService,
  ) {}

  /**
   * What the platform enforces. Allowlist entries that are not strictly valid
   * are read back as entries that match nothing: they can narrow access, never
   * widen it (`10.0.0.5/` would otherwise read as /0, every address).
   */
  async policy(): Promise<SecurityPolicy> {
    const policy = await this.storedPolicy();
    const { entries, rejected } = neutraliseAllowlist(policy.ipAllowlistCidrs);
    if (rejected.length === 0) return policy;
    this.warn({ rejected }, 'malformed IP allowlist entries are being ignored');
    return { ...policy, ipAllowlistCidrs: entries };
  }

  /** The stored values as they are (what the Security Center edits), with bad keys defaulted. */
  async storedPolicy(): Promise<SecurityPolicy> {
    const stored = await this.settings.get<Record<string, unknown>>(POLICY_KEY);
    const { policy, rejected } = salvagePolicy(stored);
    if (rejected.length > 0) {
      this.warn(
        { keys: rejected },
        'stored security policy has invalid values; using defaults for those keys only',
      );
    }
    return policy;
  }

  /** One line a minute, not one per request: a bad row is read on every login. */
  private warn(context: Record<string, unknown>, message: string): void {
    const now = Date.now();
    if (now - this.lastWarned < 60_000) return;
    this.lastWarned = now;
    this.logger.warn(context, message);
  }

  /**
   * Applies a validated partial patch. Returns the previous and next documents
   * so the caller can write one audit event with a diff.
   */
  async patchPolicy(
    patch: SecurityPolicyPatch,
    updatedBy: number,
  ): Promise<{
    before: SecurityPolicy;
    after: SecurityPolicy;
    changes: Record<string, { from: unknown; to: unknown }>;
  }> {
    const { policy: before, rejected } = salvagePolicy(
      await this.settings.get<Record<string, unknown>>(POLICY_KEY),
    );
    const given = stripUndefined(patch);
    const after = securityPolicySchema.parse({ ...before, ...given });
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const key of Object.keys(after) as Array<keyof SecurityPolicy>) {
      if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
        changes[key] = { from: before[key], to: after[key] };
      }
    }
    // A key that was stored invalid reads as its default; saving that default
    // is not a "change" but must still replace the bad value.
    const repairs = Object.keys(given).some((k) => rejected.includes(k));
    if (Object.keys(changes).length > 0 || repairs) {
      // Only the keys this save names are written, in one merge: a concurrent
      // save of other keys is kept, and settings nobody touched keep following
      // the contract's defaults instead of being frozen at today's.
      await this.settings.mergeDocument(
        POLICY_KEY,
        Object.fromEntries(Object.keys(given).map((k) => [k, after[k as keyof SecurityPolicy]])),
        updatedBy,
      );
    }
    return { before, after, changes };
  }

  async registration(): Promise<RegistrationSettings> {
    const stored = await this.settings.get<Record<string, unknown>>(REGISTRATION_KEY);
    const parsed = registrationSettingsSchema.safeParse(stored ?? {});
    return parsed.success ? parsed.data : registrationSettingsSchema.parse({});
  }

  async patchRegistration(
    patchInput: unknown,
    updatedBy: number,
  ): Promise<{ before: RegistrationSettings; after: RegistrationSettings }> {
    const patch = registrationSettingsPatchSchema.parse(patchInput);
    // The signup default must name a plan sign-ups can actually land on (WD-PLAN-008).
    // Clearing it (null) is always allowed: the resolver then falls back on its own.
    if (patch.defaultPlanId && !(await this.plans.isActiveSlug(patch.defaultPlanId))) {
      throw AppError.validation('Unknown plan', [
        { path: 'defaultPlanId', message: 'Choose an existing, active plan.' },
      ]);
    }
    const before = await this.registration();
    const merged = {
      ...before,
      ...stripUndefined(patch),
      otp: { ...before.otp, ...stripUndefined(patch.otp ?? {}) },
    };
    const after = registrationSettingsSchema.parse(merged);
    await this.settings.set(REGISTRATION_KEY, after, updatedBy);
    return { before, after };
  }

  /**
   * Stores the OTP template state (or clears it). Server-managed: the settings
   * patch never writes it, only the template endpoints and the status refresh do.
   * It touches only `otp.template`, in one statement, so the worker's refresh
   * cannot overwrite an operator's concurrent save. `updatedBy` is null for the worker.
   */
  async setOtpTemplate(
    template: OtpTemplateState | null,
    updatedBy: number | null,
  ): Promise<RegistrationSettings> {
    await this.settings.mergeMember(REGISTRATION_KEY, 'otp', { template }, updatedBy);
    return this.registration();
  }

  /** The removed sender was the selected one: forget the selection and its template. */
  async clearOtpSelection(updatedBy: number): Promise<RegistrationSettings> {
    await this.settings.mergeMember(
      REGISTRATION_KEY,
      'otp',
      { sender: null, template: null },
      updatedBy,
    );
    return this.registration();
  }
}

function stripUndefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}
