import { Injectable } from '@nestjs/common';
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
import { PlatformSettingsService } from './platform-settings.service';

export const POLICY_KEY = 'security.policy';
export const REGISTRATION_KEY = 'registration';

/**
 * The effective security policy and registration policy.
 *
 * The stored document may be partial or contain keys from an older contract;
 * parsing it through the Zod schema applies defaults and drops anything
 * invalid, so a bad row degrades to defaults instead of breaking login.
 * Auth-path readers get strict defaults, not "off": Reference's readers failed
 * open, which meant a read error silently disabled lockout.
 */
@Injectable()
export class SecurityPolicyService {
  constructor(
    private readonly settings: PlatformSettingsService,
    private readonly plans: PlanCatalogService,
  ) {}

  async policy(): Promise<SecurityPolicy> {
    const stored = await this.settings.get<Record<string, unknown>>(POLICY_KEY);
    const parsed = securityPolicySchema.safeParse(stored ?? {});
    return parsed.success ? parsed.data : securityPolicySchema.parse({});
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
    const before = await this.policy();
    const after = securityPolicySchema.parse({ ...before, ...stripUndefined(patch) });
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const key of Object.keys(after) as Array<keyof SecurityPolicy>) {
      if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
        changes[key] = { from: before[key], to: after[key] };
      }
    }
    if (Object.keys(changes).length > 0) {
      await this.settings.set(POLICY_KEY, after, updatedBy);
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
    // The signup default must name a plan sign-ups can actually land on (TW-PLAN-008).
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
