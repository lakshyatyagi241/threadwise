/**
 * The form document and the shapes around it come from `@crm/contracts` (`forms-builder`): the API owns the rules, this feature only
 * re-exports them so every import of a contract type goes through one file, and adds the few shapes that exist only in the browser
 * (a visitor's answers while they type, the issues found before sending).
 */
import { DEFAULT_MINOR_AGE } from '@crm/contracts';
import type {
  PublicForm,
  FormBlock,
  FormDefinition,
  FormFieldBlock,
  FormFieldKind,
  FormProperty,
  FormTheme,
} from '@crm/contracts';

export {
  FORM_FIELD_KINDS,
  FORM_HIDDEN_SOURCES,
  FORM_LIMITS,
  FORM_OPTION_KINDS,
  FORM_FONT_FAMILIES,
  FORM_STATUSES,
  FORM_SUBMISSION_STATUSES,
} from '@crm/contracts';
export type {
  CreateFormInput,
  FormBlock,
  FormCaptchaMode,
  FormConsent,
  FormDefinition,
  FormDetail,
  FormFieldBlock,
  FormFieldKind,
  FormHiddenSource,
  FormLiveSettings,
  FormOption,
  FormProperty,
  FormPublishProblem,
  FormShare,
  FormStatus,
  FormSubmissionDetail,
  FormSubmissionStatus,
  FormSubmissionSummary,
  FormSummary,
  FormTemplate,
  FormTheme,
  FormVersion,
  PublicForm,
  UpdateFormInput,
} from '@crm/contracts';

export type FieldBlock = FormFieldBlock;
export type Block = FormBlock;
export type FieldKind = FormFieldKind;
export type ThemeTokens = FormTheme;
export type Definition = FormDefinition;
export type CrmProperty = FormProperty;

/** What a visitor has typed for one field: text, a number as text, a ticked box, or the ticked options. */
export type AnswerValue = string | boolean | string[];
/** Answers keyed by block id; the consent box is under `CONSENT_KEY`. */
export type Answers = Record<string, AnswerValue>;
export const CONSENT_KEY = '__consent';
/**
 * The age check's own answers (BL-211): the declaration box and a parent or guardian's details. They belong to the page, not to a field,
 * and no field id can start with two underscores, so they never collide with a visitor's own answers.
 */
export const AGE_CONFIRMED_KEY = '__age_confirmed';
export const GUARDIAN_KEY = '__guardian';
export const GUARDIAN_NAME_KEY = '__guardian_name';
export const GUARDIAN_EMAIL_KEY = '__guardian_email';
export const GUARDIAN_PHONE_KEY = '__guardian_phone';

export type IssueCode =
  | 'required'
  | 'invalid_email'
  | 'invalid_phone'
  | 'invalid_number'
  | 'invalid_date'
  | 'too_small'
  | 'too_large'
  | 'too_short'
  | 'too_long'
  | 'pattern'
  | 'invalid_option'
  | 'invalid_amount'
  | 'consent_required'
  | 'guardian_required';

export interface FieldIssue {
  fieldId: string;
  code: IssueCode;
}

/**
 * What the renderer needs, and nothing more: the builder's preview passes the draft `FormDefinition`, the public page passes the
 * frozen version the API serves (`PublicForm`, which leaves out what a visitor must not see). Both fit.
 */
export interface RenderableForm {
  title: string;
  description?: string | null;
  steps: Definition['steps'];
  settings: Pick<Definition['settings'], 'submitLabel' | 'successMode' | 'locale' | 'dir'> & {
    successMessage?: string;
  };
  consent: Pick<
    Definition['consent'],
    'enabled' | 'text' | 'privacyUrl' | 'termsUrl' | 'required' | 'version'
  >;
  theme: ThemeTokens;
  /**
   * The age question (BL-211): the public form's summary (the page never learns the action or, for a date of birth or an age, the
   * minimum), or in the builder's preview the draft's own gate. Absent or off = nothing is asked.
   */
  ageGate?: PublicForm['ageGate'] | Definition['ageGate'];
  /** What the visitor is asked to pay: the public form's summary, or (in the builder's preview) the draft's own block. Absent = no payment. */
  payment?: PublicForm['payment'] | Definition['payment'];
}

export type FormShape = Pick<RenderableForm, 'steps' | 'consent' | 'ageGate'>;

/** The age question a page draws, from either shape of the gate; null when nothing is asked. */
export function pageAgeGate(
  form: Pick<RenderableForm, 'ageGate'>,
): { mode: 'dob' | 'age' | 'declaration'; declarationAge: number | null } | null {
  const g = form.ageGate;
  if (!g) return null;
  if ('enabled' in g) {
    if (!g.enabled) return null;
    return {
      mode: g.mode,
      declarationAge: g.mode === 'declaration' ? (g.minAge ?? DEFAULT_MINOR_AGE) : null,
    };
  }
  return g;
}
