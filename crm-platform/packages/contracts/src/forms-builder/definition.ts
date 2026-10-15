import { z } from 'zod';

/**
 * The form definition (docs/specs/forms-builder-app.md section 5): ONE JSON document that the builder edits, the public renderer draws,
 * the server validates a submission against, and (phase 2) the AI builder returns. It is data, never code: no HTML, CSS or script
 * place exists in it, and every value that reaches a page is a validated token or text React escapes.
 *
 * v0.9 (phases 0 and 1) accepts ONE step and no conditional rules; the schema keeps the arrays so a later version widens the limit
 * without changing the shape. Payment and deal mapping are phase 2 and 3 and have no place here yet.
 */

export const FORM_SCHEMA_VERSION = 1;

/** The largest single payment a form takes, in minor units (10 million major units at 2 decimals). */
export const FORM_PAYMENT_MAX_MINOR = 1_000_000_000;

export const FORM_LIMITS = {
  maxBlocks: 100,
  /** The schema allows 10 steps (the spec's number); v0.9 refuses more than `maxStepsNow`. */
  maxSteps: 10,
  maxStepsNow: 1,
  maxOptions: 50,
  maxLabel: 200,
  maxRichText: 5000,
  maxDefinitionBytes: 256 * 1024,
  /** A visitor's answer to one field, in characters (a long text). Short kinds are held to their own bound. */
  maxAnswerLength: 5000,
} as const;

/** The kinds of input a visitor fills. They map onto the CRM property types (`fieldTypeSchema`) when a field is bound. */
export const FORM_FIELD_KINDS = [
  'short_text',
  'long_text',
  'email',
  'phone',
  'number',
  'currency',
  'date',
  'dropdown',
  'radio',
  'checkbox_group',
  'checkbox',
  'rating',
  'hidden',
] as const;
export const formFieldKindSchema = z.enum(FORM_FIELD_KINDS);
export type FormFieldKind = z.infer<typeof formFieldKindSchema>;

/** Kinds that take their answer from a fixed list of options. */
export const FORM_OPTION_KINDS: ReadonlySet<FormFieldKind> = new Set([
  'dropdown',
  'radio',
  'checkbox_group',
]);

/** The values a `hidden` field is filled with by the page (attribution) or by the form (a constant). */
export const FORM_HIDDEN_SOURCES = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'referrer',
  'page_url',
  'constant',
] as const;
export const formHiddenSourceSchema = z.enum(FORM_HIDDEN_SOURCES);
export type FormHiddenSource = z.infer<typeof formHiddenSourceSchema>;

/** The CRM objects a field can write to. Deals arrive in phase 2. */
export const FORM_BIND_OBJECTS = ['contact', 'company'] as const;
export const formBindObjectSchema = z.enum(FORM_BIND_OBJECTS);
export type FormBindObject = z.infer<typeof formBindObjectSchema>;

/**
 * An address typed as separate fields. The CRM keeps one address line per contact and company, so the parts are joined into it when
 * the submission is written (`composeAddress`); a field bound to the whole `address` wins over the parts.
 */
export const FORM_ADDRESS_PARTS = [
  'address_line',
  'address_city',
  'address_state',
  'address_postal_code',
  'address_country',
] as const;
export type FormAddressPart = (typeof FORM_ADDRESS_PARTS)[number];

/** "Street, City, State Postal, Country": empty parts drop out with their separators. Null when nothing was given. */
export function composeAddress(parts: Partial<Record<FormAddressPart, string | undefined>>): string | null {
  const t = (k: FormAddressPart): string => (parts[k] ?? '').trim();
  const region = [t('address_state'), t('address_postal_code')].filter(Boolean).join(' ');
  const out = [t('address_line'), t('address_city'), region, t('address_country')]
    .filter(Boolean)
    .join(', ');
  return out === '' ? null : out;
}

/** Contact properties a field may be bound to without a registry entry (columns of the contact). */
export const CONTACT_BUILTIN_PROPERTIES = [
  'name',
  'first_name',
  'middle_name',
  'last_name',
  'email',
  'phone',
  'title',
  'address',
  ...FORM_ADDRESS_PARTS,
  'message',
] as const;
export type ContactBuiltinProperty = (typeof CONTACT_BUILTIN_PROPERTIES)[number];

/** Company properties a field may be bound to without a registry entry (columns of the company). */
export const COMPANY_BUILTIN_PROPERTIES = [
  'name',
  'domain',
  'email',
  'phone',
  'industry',
  'size_range',
  'address',
  ...FORM_ADDRESS_PARTS,
  'notes',
] as const;
export type CompanyBuiltinProperty = (typeof COMPANY_BUILTIN_PROPERTIES)[number];

/** A block's key in `answers`: stable for the life of the form, so old submissions keep reading. */
export const FORM_BLOCK_ID = /^[a-z][a-z0-9_]{0,39}$/;
const blockIdSchema = z
  .string()
  .regex(
    FORM_BLOCK_ID,
    'must be lower case letters, digits and _, starting with a letter (max 40)',
  );

/** A CRM property key: a built-in name or the key of a custom property in the registry. */
const propertyKeySchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,63}$/, 'must be a property key such as "budget"');

const label = z.string().trim().min(1).max(FORM_LIMITS.maxLabel);
const richText = z.string().max(FORM_LIMITS.maxRichText);

/** https only: a `javascript:`, `data:` or plain http address never reaches a page or a redirect. */
export const httpsUrlSchema = z
  .string()
  .trim()
  .max(500)
  .url()
  .refine((u) => /^https:\/\//i.test(u), 'must be an https:// address');

/**
 * A regular expression an admin typed is evaluated by the server against a visitor's text, so a catastrophic pattern would be a
 * denial of service. Refused here: backreferences, lookaround, and a group whose body repeats and is itself repeated (`(a+)+`). The
 * server also only tests values of at most 500 characters. Not a proof of safety, a floor.
 */
export function isSafeFormPattern(pattern: string): boolean {
  if (pattern.length === 0 || pattern.length > 200) return false;
  if (/\\[1-9]|\(\?[=!<]|\\k</.test(pattern)) return false;
  if (/\([^)]*[+*}][^)]*\)\s*[+*{]/.test(pattern)) return false;
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

export const formValidationSchema = z
  .object({
    /** number, currency and rating: the smallest and largest value. date: not used. */
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
    minLen: z.number().int().min(0).max(FORM_LIMITS.maxAnswerLength).optional(),
    maxLen: z.number().int().min(1).max(FORM_LIMITS.maxAnswerLength).optional(),
    pattern: z
      .string()
      .refine(
        isSafeFormPattern,
        'is not a safe regular expression (max 200 characters, no backreference or lookaround)',
      )
      .optional(),
  })
  .strict();
export type FormValidation = z.infer<typeof formValidationSchema>;

export const formOptionSchema = z.object({
  value: z.string().trim().min(1).max(100),
  label,
  /** Payment `from_field` only: what choosing this option costs, in minor units (paise, cents). Never read from a visitor. */
  amountMinor: z.number().int().min(1).max(FORM_PAYMENT_MAX_MINOR).optional(),
});
export type FormOption = z.infer<typeof formOptionSchema>;

export const formBindSchema = z.object({
  object: formBindObjectSchema,
  property: propertyKeySchema,
});
export type FormBind = z.infer<typeof formBindSchema>;

export const formFieldBlockSchema = z
  .object({
    id: blockIdSchema,
    type: z.literal('field'),
    kind: formFieldKindSchema,
    label,
    help: z.string().trim().max(300).optional(),
    placeholder: z.string().trim().max(120).optional(),
    required: z.boolean().default(false),
    width: z.enum(['full', 'half']).default('full'),
    validation: formValidationSchema.optional(),
    options: z.array(formOptionSchema).max(FORM_LIMITS.maxOptions).optional(),
    bind: formBindSchema.optional(),
    /** `hidden` only: where the value comes from. */
    hiddenSource: formHiddenSourceSchema.optional(),
    /** `hidden` with the source `constant`. */
    constant: z.string().max(500).optional(),
  })
  .strict();
export type FormFieldBlock = z.infer<typeof formFieldBlockSchema>;

export const formHeadingBlockSchema = z
  .object({
    id: blockIdSchema,
    type: z.literal('heading'),
    text: label,
    level: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(2),
  })
  .strict();
export const formParagraphBlockSchema = z
  .object({ id: blockIdSchema, type: z.literal('paragraph'), html: richText })
  .strict();
export const formDividerBlockSchema = z
  .object({ id: blockIdSchema, type: z.literal('divider') })
  .strict();

export const formBlockSchema = z.discriminatedUnion('type', [
  formFieldBlockSchema,
  formHeadingBlockSchema,
  formParagraphBlockSchema,
  formDividerBlockSchema,
]);
export type FormBlock = z.infer<typeof formBlockSchema>;

export const formStepSchema = z
  .object({
    id: blockIdSchema,
    title: z.string().trim().max(FORM_LIMITS.maxLabel).optional(),
    blocks: z.array(formBlockSchema).max(FORM_LIMITS.maxBlocks),
  })
  .strict();
export type FormStep = z.infer<typeof formStepSchema>;

// --- styling ---------------------------------------------------------------------------------------------------------------------------

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'must be a #rrggbb colour');

/** Ten curated stacks: the renderer maps each name to a font stack and loads a Google font only when it is chosen. */
export const FORM_FONT_FAMILIES = [
  'system',
  'serif',
  'mono',
  'inter',
  'roboto',
  'open_sans',
  'lato',
  'poppins',
  'merriweather',
  'nunito',
] as const;

/**
 * Tokens, not CSS (spec section 8): a closed set of keys with hex colours, enums and bounded numbers. The renderer turns them into CSS
 * custom properties on one wrapper element, so theming is safe by construction.
 */
export const formThemeSchema = z
  .object({
    primary: hex.default('#2563eb'),
    background: hex.default('#ffffff'),
    surface: hex.default('#ffffff'),
    text: hex.default('#111827'),
    mutedText: hex.default('#6b7280'),
    border: hex.default('#d1d5db'),
    error: hex.default('#dc2626'),
    radius: z.enum(['none', 'sm', 'md', 'lg', 'pill']).default('md'),
    density: z.enum(['compact', 'comfortable', 'spacious']).default('comfortable'),
    fontFamily: z.enum(FORM_FONT_FAMILIES).default('system'),
    fontScale: z.number().min(0.8).max(1.4).default(1),
    labelPosition: z.enum(['top', 'left', 'floating']).default('top'),
    buttonStyle: z.enum(['filled', 'outline']).default('filled'),
    buttonWidth: z.enum(['auto', 'full']).default('full'),
    shadow: z.enum(['none', 'sm', 'md', 'lg']).default('md'),
    backgroundImage: httpsUrlSchema.nullable().default(null),
    logo: httpsUrlSchema.nullable().default(null),
    coverImage: httpsUrlSchema.nullable().default(null),
    maxWidth: z.number().int().min(320).max(960).default(560),
    mode: z.enum(['light', 'dark', 'auto']).default('light'),
    layout: z.enum(['classic', 'full_width', 'split', 'minimal']).default('classic'),
  })
  .strict();
export type FormTheme = z.infer<typeof formThemeSchema>;

// --- settings, consent, what happens next ---------------------------------------------------------------------------------------------

export const formSettingsSchema = z
  .object({
    submitLabel: z.string().trim().min(1).max(60).default('Submit'),
    successMode: z.enum(['message', 'redirect']).default('message'),
    successMessage: z
      .string()
      .max(FORM_LIMITS.maxRichText)
      .default('Thanks, we received your details.'),
    /** https only; required when `successMode` is `redirect`. */
    redirectUrl: httpsUrlSchema.optional(),
    locale: z.enum(['en', 'ar']).default('en'),
    dir: z.enum(['ltr', 'rtl']).optional(),
    /** The calling code a phone typed without a country prefix is read with ("91"). */
    phoneCountryCode: z
      .string()
      .regex(/^\d{1,4}$/)
      .optional(),
  })
  .strict();
export type FormSettings = z.infer<typeof formSettingsSchema>;

/**
 * The consent line (spec 9.5). The exact text shown, its version and the time are stored on every submission. `marketing` ties the box
 * to the contact's subscription: a ticked box subscribes, an unticked one never flips anything.
 */
export const formConsentSchema = z
  .object({
    enabled: z.boolean().default(false),
    text: z.string().trim().min(1).max(500).default('I agree to be contacted about my request.'),
    privacyUrl: httpsUrlSchema.optional(),
    /** The box must be ticked to submit. */
    required: z.boolean().default(true),
    /** Ticking it records marketing opt-in on the contact. */
    marketing: z.boolean().default(false),
    /**
     * The wording also tells the person they may be contacted by SMS (BL-171). Declared by the form's owner, never guessed from the
     * text: it adds an SMS record beside WhatsApp and email when the form collects a phone number.
     */
    coversSms: z.boolean().default(false),
    /** Bump when the text changes: submissions keep the version they saw. */
    version: z.number().int().min(1).max(10_000).default(1),
  })
  .strict();
export type FormConsent = z.infer<typeof formConsentSchema>;

/** How a company is found for a submission that carries company properties (spec 9.3). */
export const FORM_COMPANY_MATCH = ['none', 'email_domain', 'name_or_domain'] as const;
export const formMappingSchema = z
  .object({
    company: z
      .object({ match: z.enum(FORM_COMPANY_MATCH).default('name_or_domain') })
      .strict()
      .default({}),
  })
  .strict();
export type FormMapping = z.infer<typeof formMappingSchema>;

/** What every submission adds to the contact. The visitor can never set any of it. */
export const formAfterSchema = z
  .object({
    tags: z.array(z.string().trim().min(1).max(60)).max(10).default([]),
    /** A lifecycle stage value of the workspace; checked at publish. */
    lifecycleStage: z.string().trim().min(1).max(60).optional(),
  })
  .strict();
export type FormAfter = z.infer<typeof formAfterSchema>;

/**
 * Payment collection (spec section 10): the SERVER computes the amount from this frozen block and the validated answers; a number the
 * browser sends is never read. One currency per form. The visitor pays on a hosted link of the workspace's gateway after the answers are
 * stored; the form is `paid` only when the gateway's verified notification arrives, never on the redirect back.
 */
export const FORM_PAYMENT_AMOUNT_TYPES = ['fixed', 'from_field', 'pay_what_you_want'] as const;
export const formPaymentAmountTypeSchema = z.enum(FORM_PAYMENT_AMOUNT_TYPES);
export type FormPaymentAmountType = z.infer<typeof formPaymentAmountTypeSchema>;

export const formPaymentSchema = z
  .object({
    enabled: z.boolean().default(false),
    amountType: formPaymentAmountTypeSchema.default('fixed'),
    /** `fixed`: the price. */
    amountMinor: z.number().int().min(1).max(FORM_PAYMENT_MAX_MINOR).optional(),
    /** `from_field`: a dropdown or radio whose options carry amounts. `pay_what_you_want`: a number or currency field (major units). */
    fieldId: blockIdSchema.optional(),
    /** `pay_what_you_want`: the smallest and largest amount the visitor may pay, in minor units. */
    minMinor: z.number().int().min(1).max(FORM_PAYMENT_MAX_MINOR).optional(),
    maxMinor: z.number().int().min(1).max(FORM_PAYMENT_MAX_MINOR).optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/, 'must be an ISO 4217 code such as INR')
      .default('INR'),
    /** What the payer sees on the gateway's page. */
    description: z.string().trim().max(120).optional(),
  })
  .strict();
export type FormPayment = z.infer<typeof formPaymentSchema>;

// --- the document -------------------------------------------------------------------------------------------------------------------------

export const formDefinitionSchema = z
  .object({
    schemaVersion: z.literal(FORM_SCHEMA_VERSION).default(FORM_SCHEMA_VERSION),
    title: label,
    description: richText.optional(),
    steps: z
      .array(formStepSchema)
      .min(1)
      .max(FORM_LIMITS.maxStepsNow, 'Multi-step forms arrive in a later version'),
    settings: formSettingsSchema.default({}),
    consent: formConsentSchema.default({}),
    theme: formThemeSchema.default({}),
    /** Conditional rules arrive in phase 2; the array is here so the shape does not change. */
    rules: z.array(z.never()).max(0, 'Conditional logic arrives in a later version').default([]),
    mapping: formMappingSchema.default({}),
    after: formAfterSchema.default({}),
    payment: formPaymentSchema.default({}),
  })
  .strict()
  .superRefine((def, ctx) => {
    const seen = new Set<string>();
    const binds = new Set<string>();
    let blocks = 0;
    def.steps.forEach((step, si) => {
      if (seen.has(step.id))
        ctx.addIssue({ code: 'custom', path: ['steps', si, 'id'], message: 'duplicate_id' });
      seen.add(step.id);
      step.blocks.forEach((b, bi) => {
        blocks += 1;
        const at = ['steps', si, 'blocks', bi];
        if (seen.has(b.id))
          ctx.addIssue({ code: 'custom', path: [...at, 'id'], message: 'duplicate_id' });
        seen.add(b.id);
        if (b.type !== 'field') return;
        if (FORM_OPTION_KINDS.has(b.kind) && (b.options?.length ?? 0) === 0) {
          ctx.addIssue({ code: 'custom', path: [...at, 'options'], message: 'options_required' });
        }
        if (b.options && !FORM_OPTION_KINDS.has(b.kind)) {
          ctx.addIssue({
            code: 'custom',
            path: [...at, 'options'],
            message: 'options_not_allowed',
          });
        }
        if (b.options) {
          const values = new Set<string>();
          b.options.forEach((o, oi) => {
            if (values.has(o.value)) {
              ctx.addIssue({
                code: 'custom',
                path: [...at, 'options', oi, 'value'],
                message: 'duplicate_option',
              });
            }
            values.add(o.value);
          });
        }
        if (b.kind === 'hidden') {
          if (!b.hiddenSource)
            ctx.addIssue({
              code: 'custom',
              path: [...at, 'hiddenSource'],
              message: 'hidden_source_required',
            });
          if (b.hiddenSource === 'constant' && !b.constant) {
            ctx.addIssue({
              code: 'custom',
              path: [...at, 'constant'],
              message: 'constant_required',
            });
          }
          if (b.required)
            ctx.addIssue({
              code: 'custom',
              path: [...at, 'required'],
              message: 'hidden_cannot_be_required',
            });
        }
        if (
          b.validation?.min !== undefined &&
          b.validation.max !== undefined &&
          b.validation.min > b.validation.max
        ) {
          ctx.addIssue({ code: 'custom', path: [...at, 'validation'], message: 'min_above_max' });
        }
        if (
          b.validation?.minLen !== undefined &&
          b.validation.maxLen !== undefined &&
          b.validation.minLen > b.validation.maxLen
        ) {
          ctx.addIssue({ code: 'custom', path: [...at, 'validation'], message: 'min_above_max' });
        }
        if (b.bind) {
          const key = `${b.bind.object}:${b.bind.property}`;
          if (binds.has(key))
            ctx.addIssue({ code: 'custom', path: [...at, 'bind'], message: 'duplicate_bind' });
          binds.add(key);
        }
      });
    });
    if (blocks > FORM_LIMITS.maxBlocks) {
      ctx.addIssue({ code: 'custom', path: ['steps'], message: 'too_many_blocks' });
    }
    if (def.settings.successMode === 'redirect' && !def.settings.redirectUrl) {
      ctx.addIssue({
        code: 'custom',
        path: ['settings', 'redirectUrl'],
        message: 'redirect_url_required',
      });
    }
    const pay = def.payment;
    if (pay.enabled) {
      const payField = def.steps
        .flatMap((st) => st.blocks)
        .find((b) => b.type === 'field' && b.id === pay.fieldId);
      const bad = (path: string, message: string) =>
        ctx.addIssue({ code: 'custom', path: ['payment', path], message });
      if (pay.amountType === 'fixed' && pay.amountMinor === undefined) {
        bad('amountMinor', 'payment_amount_required');
      }
      if (pay.amountType === 'from_field') {
        if (
          !payField ||
          payField.type !== 'field' ||
          !['dropdown', 'radio'].includes(payField.kind)
        ) {
          bad('fieldId', 'payment_field_must_be_choice');
        } else if (
          !payField.required ||
          (payField.options ?? []).some((o) => o.amountMinor === undefined)
        ) {
          bad('fieldId', 'payment_options_need_amounts');
        }
      }
      if (pay.amountType === 'pay_what_you_want') {
        if (
          !payField ||
          payField.type !== 'field' ||
          !['number', 'currency'].includes(payField.kind)
        ) {
          bad('fieldId', 'payment_field_must_be_number');
        } else if (!payField.required) {
          bad('fieldId', 'payment_field_must_be_required');
        }
        if (pay.minMinor === undefined) bad('minMinor', 'payment_min_required');
        if (
          pay.minMinor !== undefined &&
          pay.maxMinor !== undefined &&
          pay.minMinor > pay.maxMinor
        ) {
          bad('minMinor', 'min_above_max');
        }
      }
    }
    if (JSON.stringify(def).length > FORM_LIMITS.maxDefinitionBytes) {
      ctx.addIssue({ code: 'custom', path: [], message: 'definition_too_large' });
    }
  });
export type FormDefinition = z.infer<typeof formDefinitionSchema>;
/** What a client may send: defaults not yet applied. */
export type FormDefinitionInput = z.input<typeof formDefinitionSchema>;

/** Every block of a definition, in order, with the step it sits in. */
export function formBlocks(def: FormDefinition): FormBlock[] {
  return def.steps.flatMap((s) => s.blocks);
}
/** Every input block (`type: 'field'`) of a definition, in order. */
export function formFields(def: FormDefinition): FormFieldBlock[] {
  return formBlocks(def).filter((b): b is FormFieldBlock => b.type === 'field');
}
