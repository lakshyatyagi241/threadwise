/**
 * calling-voice: call recording consent and lifecycle (BL-144). The workspace switch (off by default, decision D7), the versioned
 * notice, the consent evidence kept on the call, the retention window and the manual delete and legal hold of one recording.
 * Requirements: docs/privacy/voice-bot-consent-requirements.md. API: docs/api/calling-voice.md.
 */
import { z } from 'zod';
import { CONSENT_GATE_DECISIONS, CONSENT_GATE_REASONS } from '../privacy/gate';

/**
 * How consent to record is obtained on a call an operator takes in the browser.
 *  - `announcement`: the operator reads the notice and the call goes on (accepted only where counsel confirms an announcement is
 *    enough; the strict, safe default is `confirmed`).
 *  - `confirmed`: the person says yes to being recorded and the operator records it.
 * The DTMF method of the voice-bot requirements belongs to the bot (BL-148); there is no keypad prompt on an operator call.
 */
export const CALL_RECORDING_CONSENT_MODES = ['announcement', 'confirmed'] as const;
export type CallRecordingConsentMode = (typeof CALL_RECORDING_CONSENT_MODES)[number];

/** The method stored on the call: how the consent was given (voice-bot requirements, point 4). */
export const CALL_RECORDING_CONSENT_METHODS = ['announcement_continue', 'spoken_yes'] as const;
export type CallRecordingConsentMethod = (typeof CALL_RECORDING_CONSENT_METHODS)[number];

/** The method each mode accepts for a grant. A decline is stored with the method of the mode too. */
export const CALL_RECORDING_MODE_METHOD: Record<
  CallRecordingConsentMode,
  CallRecordingConsentMethod
> = { announcement: 'announcement_continue', confirmed: 'spoken_yes' };

/** Recordings are kept this many days by default (decision D4); a workspace sets 7 to 365 (spec 4.6). */
export const CALL_RECORDING_RETENTION_DEFAULT_DAYS = 90;
export const CALL_RECORDING_RETENTION_MIN_DAYS = 7;
export const CALL_RECORDING_RETENTION_MAX_DAYS = 365;

export const CALL_RECORDING_NOTICE_MIN = 10;
export const CALL_RECORDING_NOTICE_MAX = 600;
export const CALL_RECORDING_HOLD_REASON_MAX = 200;

export const CALL_RECORDING_DELETE_REASONS = ['retention', 'manual'] as const;
export type CallRecordingDeleteReason = (typeof CALL_RECORDING_DELETE_REASONS)[number];

// --- workspace settings ------------------------------------------------------------------------------------------------

export const callRecordingSettingsSchema = z.object({
  /** Off until a workspace turns it on. While off, no recording is armed in the browser and none is accepted by the server. */
  enabled: z.boolean(),
  consentMode: z.enum(CALL_RECORDING_CONSENT_MODES),
  retentionDays: z
    .number()
    .int()
    .min(CALL_RECORDING_RETENTION_MIN_DAYS)
    .max(CALL_RECORDING_RETENTION_MAX_DAYS),
  /** The notice the operator reads out; null until the workspace writes one. */
  noticeText: z.string().nullable(),
  /** The version of the notice text; every edit makes a new version, and a call stores the version it used. 0 = no notice yet. */
  noticeVersion: z.number().int().nonnegative(),
  /** null until the first save. */
  rowVersion: z.number().int().positive().nullable(),
  updatedAt: z.string().nullable(),
});
export type CallRecordingSettings = z.infer<typeof callRecordingSettingsSchema>;

export const updateCallRecordingSettingsInputSchema = z
  .object({
    enabled: z.boolean(),
    consentMode: z.enum(CALL_RECORDING_CONSENT_MODES),
    retentionDays: z
      .number()
      .int()
      .min(CALL_RECORDING_RETENTION_MIN_DAYS)
      .max(CALL_RECORDING_RETENTION_MAX_DAYS),
    noticeText: z.string().trim().max(CALL_RECORDING_NOTICE_MAX),
    /** Omitted on the first save; required on every later one (optimistic lock). */
    rowVersion: z.number().int().positive().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.enabled && v.noticeText.length < CALL_RECORDING_NOTICE_MIN) {
      ctx.addIssue({
        code: 'custom',
        path: ['noticeText'],
        message: `Write the recording notice (at least ${CALL_RECORDING_NOTICE_MIN} characters) before switching recording on.`,
      });
    }
  });
export type UpdateCallRecordingSettingsInput = z.infer<
  typeof updateCallRecordingSettingsInputSchema
>;

// --- consent evidence on a call ----------------------------------------------------------------------------------------

export const callRecordingConsentSchema = z.object({
  status: z.enum(['granted', 'declined']).nullable(),
  method: z.enum(CALL_RECORDING_CONSENT_METHODS).nullable(),
  at: z.string().nullable(),
  noticeVersion: z.number().int().positive().nullable(),
  /** sha-256 of the notice text that was presented (voice-bot requirements, point 4). */
  noticeSha256: z.string().nullable(),
});
export type CallRecordingConsent = z.infer<typeof callRecordingConsentSchema>;

/** `POST /v2/calling/calls/:id/recording-consent`: the operator records the person's answer. */
export const recordCallConsentInputSchema = z.object({
  decision: z.enum(['granted', 'declined']),
  method: z.enum(CALL_RECORDING_CONSENT_METHODS),
});
export type RecordCallConsentInput = z.infer<typeof recordCallConsentInputSchema>;

/**
 * What the gate says about recording one call, with what the panel needs to act on it: the notice to read and the answer so far.
 * `allow` is the only decision under which the browser may arm the recorder and the server accepts the file.
 */
export const callRecordingGateSchema = z.object({
  decision: z.enum(CONSENT_GATE_DECISIONS),
  reason: z.enum(CONSENT_GATE_REASONS),
  consentMode: z.enum(CALL_RECORDING_CONSENT_MODES),
  noticeText: z.string().nullable(),
  noticeVersion: z.number().int().nonnegative(),
  consent: callRecordingConsentSchema,
});
export type CallRecordingGate = z.infer<typeof callRecordingGateSchema>;

// --- one recording's lifecycle -----------------------------------------------------------------------------------------

export const callRecordingLifecycleSchema = z.object({
  /** When the file was stored; the retention clock starts here. */
  storedAt: z.string().nullable(),
  /** When the retention sweep deletes the file (stored + the workspace's days); null when none is stored or it is on hold. */
  expiresAt: z.string().nullable(),
  legalHold: z.boolean(),
  holdReason: z.string().nullable(),
  /** Set once the file has been removed; the call row stays. */
  deletedAt: z.string().nullable(),
  deletedReason: z.enum(CALL_RECORDING_DELETE_REASONS).nullable(),
  consent: callRecordingConsentSchema,
});
export type CallRecordingLifecycle = z.infer<typeof callRecordingLifecycleSchema>;

/** `PUT /v2/calling/call-logs/:id/recording-hold`: a legal hold keeps one recording out of the sweep and out of a manual delete. */
export const setRecordingHoldInputSchema = z
  .object({
    hold: z.boolean(),
    reason: z.string().trim().max(CALL_RECORDING_HOLD_REASON_MAX).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.hold && !v.reason) {
      ctx.addIssue({
        code: 'custom',
        path: ['reason'],
        message: 'Say why the recording is kept (a legal hold is audited with its reason).',
      });
    }
  });
export type SetRecordingHoldInput = z.infer<typeof setRecordingHoldInputSchema>;
