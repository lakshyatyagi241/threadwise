import {
  formFields,
  type FormDefinition,
  type FormFieldBlock,
  type FormFieldKind,
  type FormPublishProblem,
} from '@crm/contracts';
import { isBuiltinProperty } from './form-rules';

/**
 * What Publish checks (docs/specs/forms-builder-app.md 7.1 and 9.3): the form must be able to do its job, and it is told at publish,
 * not "at 2 a.m. on a visitor". Pure: the caller hands in what the workspace's registry says.
 *
 * Problems come back as `{ path, reason }` with a stable reason, so the builder can mark the field and say what to do.
 */

export interface RegistryProperty {
  type: string;
  label: string;
}

export interface PublishContext {
  /** Active, writable contact properties of the workspace (the registry), by key. */
  contactProps: ReadonlyMap<string, RegistryProperty>;
  /** Same for companies. */
  companyProps: ReadonlyMap<string, RegistryProperty>;
  /** Keys of the contact properties the workspace marks required: a form that writes contacts must bind and require each. */
  contactRequired: ReadonlyArray<{ key: string; label: string }>;
  /** A lifecycle stage a submission may put a contact in. */
  stageUsable: (stage: string) => boolean;
}

const TEXTLIKE: readonly FormFieldKind[] = ['short_text', 'long_text', 'dropdown', 'radio'];

/** The block kinds each CRM property type can take its answer from. Anything not listed takes only free text. */
const KINDS_FOR_TYPE: Record<string, readonly FormFieldKind[]> = {
  text: ['short_text', 'long_text', 'dropdown', 'radio', 'email', 'phone'],
  long_text: ['long_text', 'short_text'],
  integer: ['number', 'rating', 'short_text'],
  big_integer: ['number', 'short_text'],
  decimal: ['number', 'currency', 'short_text'],
  percentage: ['number', 'short_text'],
  currency: ['currency', 'number', 'short_text'],
  boolean: ['checkbox'],
  checkbox: ['checkbox', 'checkbox_group'],
  radio: ['radio', 'dropdown'],
  select: ['dropdown', 'radio', 'short_text'],
  multiselect: ['checkbox_group'],
  date: ['date'],
  datetime: ['date'],
  url: ['short_text'],
  email: ['email', 'short_text'],
  phone: ['phone', 'short_text'],
  rating: ['rating', 'number'],
  timezone: ['dropdown', 'short_text'],
};

/** Built-in properties that must come from a specific kind of field, so what is bound is what the CRM expects. */
const BUILTIN_KINDS: Record<string, readonly FormFieldKind[]> = {
  'contact:email': ['email'],
  'contact:phone': ['phone'],
  'company:email': ['email'],
  'company:phone': ['phone'],
};

const problem = (path: string, reason: string): FormPublishProblem => ({ path, reason });

export function publishProblems(def: FormDefinition, ctx: PublishContext): FormPublishProblem[] {
  const out: FormPublishProblem[] = [];
  const fields = formFields(def).filter((f) => f.kind !== 'hidden' || f.bind);
  const inputs = formFields(def).filter((f) => f.kind !== 'hidden');
  if (inputs.length === 0) out.push(problem('steps', 'no_fields'));

  const at = (f: FormFieldBlock): string => {
    const si = def.steps.findIndex((s) => s.blocks.includes(f));
    const bi = def.steps[si]?.blocks.indexOf(f) ?? 0;
    return `steps.${si}.blocks.${bi}`;
  };

  let companyBound = false;
  const bound = new Map<string, FormFieldBlock>();
  for (const f of fields) {
    if (!f.bind) continue;
    const { object, property } = f.bind;
    bound.set(`${object}:${property}`, f);
    if (object === 'company') companyBound = true;
    const path = `${at(f)}.bind`;

    if (isBuiltinProperty(object, property)) {
      const only = BUILTIN_KINDS[`${object}:${property}`];
      if (only && !only.includes(f.kind)) out.push(problem(path, 'bind_type_mismatch'));
      else if (!only && !([...TEXTLIKE, 'hidden'] as readonly FormFieldKind[]).includes(f.kind)) {
        out.push(problem(path, 'bind_type_mismatch'));
      }
      continue;
    }
    const registry = object === 'contact' ? ctx.contactProps : ctx.companyProps;
    const prop = registry.get(property);
    if (!prop) {
      out.push(problem(path, 'bind_unknown_property'));
      continue;
    }
    const allowed = KINDS_FOR_TYPE[prop.type] ?? ['short_text'];
    if (f.kind !== 'hidden' && !allowed.includes(f.kind))
      out.push(problem(path, 'bind_type_mismatch'));
  }

  const hasContactPoint = bound.has('contact:email') || bound.has('contact:phone');
  if (!hasContactPoint) out.push(problem('steps', 'no_contact_point'));

  for (const req of ctx.contactRequired) {
    const f = bound.get(`contact:${req.key}`);
    if (!f) out.push(problem(`contact.${req.key}`, 'crm_required_unbound'));
    else if (!f.required) out.push(problem(`${at(f)}.required`, 'crm_required_not_required'));
  }

  if (companyBound && def.mapping.company.match === 'none') {
    out.push(problem('mapping.company.match', 'company_fields_need_match'));
  }

  const stage = def.after.lifecycleStage;
  if (stage && !ctx.stageUsable(stage))
    out.push(problem('after.lifecycleStage', 'lifecycle_stage_unknown'));

  return out;
}
