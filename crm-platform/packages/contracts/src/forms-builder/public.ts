import { z } from 'zod';
import {
  formConsentSchema,
  formStepSchema,
  formThemeSchema,
  formSettingsSchema,
  formPaymentSchema,
} from './definition';

/**
 * What the public page and the embed read: `GET /v2/public/forms/:publicKey`. Only what the form shows (docs/specs/forms-builder-app.md
 * 7.2): never the owner rule, the notification list, the allowed origins' owner, mapping or tags. Rich text is already sanitised.
 */
export const publicFormSchema = z.object({
  key: z.string(),
  /** The form is paused: the page says it is closed and the steps are empty. A submit is answered 404. */
  closed: z.boolean(),
  /** The frozen version the visitor sees; sent back by nothing, shown to staff in the submission. */
  version: z.number().int(),
  title: z.string(),
  /** Sanitised HTML. */
  description: z.string().nullable(),
  steps: z.array(formStepSchema),
  settings: formSettingsSchema.pick({
    submitLabel: true,
    successMode: true,
    locale: true,
    dir: true,
  }),
  consent: formConsentSchema.pick({
    enabled: true,
    text: true,
    privacyUrl: true,
    required: true,
    version: true,
  }),
  theme: formThemeSchema,
  /** What the visitor will be asked to pay: shown before they submit. Null when the form takes no payment. */
  payment: formPaymentSchema
    .pick({
      amountType: true,
      amountMinor: true,
      fieldId: true,
      minMinor: true,
      maxMinor: true,
      currency: true,
      description: true,
    })
    .nullable(),
  /** The name of the honeypot input the page must render, hidden from people and from assistive tech; null when the form has none. */
  honeypotField: z.string().nullable(),
  captcha: z.object({
    /** The page must send a `captchaToken`. */
    required: z.boolean(),
    version: z.enum(['v2', 'v3']).nullable(),
    siteKey: z.string().nullable(),
  }),
  /** The "Powered by" line (decision D8): shown unless the plan removes it. Brand is data, never hard-coded in the page. */
  poweredBy: z.object({ show: z.boolean(), label: z.string() }),
  /**
   * The value of `Content-Security-Policy: frame-ancestors` the page must answer with: `'none'` for the hosted page, the form's allowed
   * origins for `?embed=1`. Computed here so the web app never decides what may frame a form.
   */
  frameAncestors: z.object({ hosted: z.string(), embed: z.string() }),
});
export type PublicForm = z.infer<typeof publicFormSchema>;
