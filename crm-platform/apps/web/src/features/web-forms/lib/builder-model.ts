import { FORM_LIMITS, FORM_OPTION_KINDS, formDefinitionSchema } from '@crm/contracts';
import { safeRedirect } from './share';
import type {
  Block,
  CrmProperty,
  Definition,
  FieldBlock,
  FieldKind,
  FormHiddenSource,
  FormOption,
} from './types';

/** Copy the model needs for a new form; the screen passes translated strings so the model stays free of the i18n runtime. */
export interface NewFormCopy {
  title: string;
  submitLabel: string;
  successMessage: string;
}

let counter = 0;
/** A block id: lower case, unique inside a form and stable once made (answers and CRM writes refer to it). Fits `FORM_BLOCK_ID`. */
export function newId(prefix = 'f'): string {
  counter += 1;
  const bytes =
    typeof crypto !== 'undefined' && 'getRandomValues' in crypto
      ? crypto.getRandomValues(new Uint8Array(4))
      : Uint8Array.from({ length: 4 }, () => Math.floor(Math.random() * 256));
  const rand = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${prefix}_${rand}${counter.toString(36)}`;
}

/** A new, empty form: the contract's defaults for everything the person has not chosen yet. */
export function blankDefinition(copy: NewFormCopy, locale: 'en' | 'ar' = 'en'): Definition {
  return formDefinitionSchema.parse({
    title: copy.title,
    steps: [{ id: newId('s'), blocks: [] }],
    settings: {
      submitLabel: copy.submitLabel,
      successMessage: copy.successMessage,
      locale,
      dir: locale === 'ar' ? 'rtl' : 'ltr',
    },
  });
}

export const kindHasOptions = (k: FieldKind): boolean => FORM_OPTION_KINDS.has(k);

/** A new field with the defaults a person would expect; a choice starts with two options so it is valid at once. */
export function newField(
  kind: FieldKind,
  label: string,
  optionLabels: [string, string] = ['Option 1', 'Option 2'],
): FieldBlock {
  const f: FieldBlock = {
    type: 'field',
    id: newId('f'),
    kind,
    label,
    required: false,
    width: 'full',
  };
  if (kindHasOptions(kind))
    f.options = optionLabels.map((l, i) => ({ value: `opt_${i + 1}`, label: l }));
  if (kind === 'rating') f.validation = { min: 1, max: 5 };
  if (kind === 'hidden') f.hiddenSource = 'utm_source';
  return f;
}

/** A hidden field: a tracking value (or a constant) the visitor never sees, saved with the submission and optionally into the CRM. */
export function newHiddenField(source: FormHiddenSource, label: string): FieldBlock {
  const f = newField('hidden', label);
  f.hiddenSource = source;
  if (source === 'constant') f.constant = '';
  return f;
}

export function newHeading(text: string): Block {
  return { type: 'heading', id: newId('h'), text, level: 2 };
}
export function newParagraph(html: string): Block {
  return { type: 'paragraph', id: newId('p'), html };
}
export function newDivider(): Block {
  return { type: 'divider', id: newId('d') };
}

/** The field a "Map to CRM property" pick creates: label, kind, options and the workspace's required rule come from the property. */
export function fieldFromProperty(p: CrmProperty): FieldBlock {
  const f = newField(p.suggestedKind, p.label);
  f.bind = { object: p.object, property: p.property };
  f.required = p.requiredByWorkspace;
  if (kindHasOptions(p.suggestedKind)) f.options = (p.options ?? []).map((o) => ({ ...o }));
  else delete f.options;
  if (p.type === 'url') f.validation = { pattern: '^https?://\\S+$' };
  return f;
}

/** Re-point an existing field at a property (or detach it with null). Attaching adopts the property's kind and options. */
export function bindField(f: FieldBlock, p: CrmProperty | null): FieldBlock {
  if (!p) {
    const next = { ...f };
    delete next.bind;
    return next;
  }
  const next: FieldBlock = {
    ...f,
    kind: p.suggestedKind,
    bind: { object: p.object, property: p.property },
  };
  if (p.requiredByWorkspace) next.required = true;
  if (kindHasOptions(p.suggestedKind)) next.options = (p.options ?? []).map((o) => ({ ...o }));
  else delete next.options;
  if (p.suggestedKind !== 'hidden') {
    delete next.hiddenSource;
    delete next.constant;
  }
  return next;
}

/** Changing a field's kind keeps what still applies: options only where the new kind takes them, validation only where it makes sense. */
export function changeKind(f: FieldBlock, kind: FieldKind): FieldBlock {
  const next: FieldBlock = { ...f, kind };
  if (kindHasOptions(kind))
    next.options = f.options?.length ? f.options : newField(kind, f.label).options;
  else delete next.options;
  if (kind !== 'hidden') {
    delete next.hiddenSource;
    delete next.constant;
  } else {
    next.hiddenSource = f.hiddenSource ?? 'utm_source';
    next.required = false;
  }
  if (kind === 'rating') next.validation = { min: 1, max: 5 };
  else if (f.kind === 'rating') delete next.validation;
  return next;
}

// ---- editing the block list (immutable: every function returns a new definition) -------------------------------------------

/** v0.9 forms have one step (`FORM_LIMITS.maxStepsNow`); the editor works on it. The helpers still take a step index for later. */
function mapStep(def: Definition, si: number, fn: (blocks: Block[]) => Block[]): Definition {
  return {
    ...def,
    steps: def.steps.map((s, i) => (i === si ? { ...s, blocks: fn(s.blocks) } : s)),
  };
}

export function findBlock(
  def: Definition,
  id: string,
): { step: number; index: number; block: Block } | null {
  for (let si = 0; si < def.steps.length; si += 1) {
    const index = def.steps[si]!.blocks.findIndex((b) => b.id === id);
    if (index >= 0) return { step: si, index, block: def.steps[si]!.blocks[index]! };
  }
  return null;
}

export function blockCount(def: Definition): number {
  return def.steps.reduce((n, s) => n + s.blocks.length, 0);
}

export function addBlock(def: Definition, block: Block, at?: number, step = 0): Definition {
  if (blockCount(def) >= FORM_LIMITS.maxBlocks) return def;
  return mapStep(def, step, (blocks) => {
    const copy = [...blocks];
    copy.splice(at === undefined ? copy.length : Math.max(0, Math.min(at, copy.length)), 0, block);
    return copy;
  });
}

export function updateBlock(def: Definition, id: string, next: (b: Block) => Block): Definition {
  return {
    ...def,
    steps: def.steps.map((s) => ({
      ...s,
      blocks: s.blocks.map((b) => (b.id === id ? next(b) : b)),
    })),
  };
}

export function removeBlock(def: Definition, id: string): Definition {
  return {
    ...def,
    steps: def.steps.map((s) => ({ ...s, blocks: s.blocks.filter((b) => b.id !== id) })),
  };
}

/** Moves a block up (-1) or down (+1) inside its step. */
export function moveBlock(def: Definition, id: string, delta: -1 | 1): Definition {
  const at = findBlock(def, id);
  if (!at) return def;
  const to = at.index + delta;
  const blocks = def.steps[at.step]!.blocks;
  if (to < 0 || to >= blocks.length) return def;
  return mapStep(def, at.step, (list) => {
    const copy = [...list];
    [copy[at.index], copy[to]] = [copy[to]!, copy[at.index]!];
    return copy;
  });
}

export function canMove(def: Definition, id: string, delta: -1 | 1): boolean {
  const at = findBlock(def, id);
  if (!at) return false;
  const to = at.index + delta;
  return to >= 0 && to < def.steps[at.step]!.blocks.length;
}

export function duplicateBlock(
  def: Definition,
  id: string,
): { def: Definition; id: string } | null {
  const at = findBlock(def, id);
  if (!at || blockCount(def) >= FORM_LIMITS.maxBlocks) return null;
  const prefix =
    at.block.type === 'field'
      ? 'f'
      : at.block.type === 'heading'
        ? 'h'
        : at.block.type === 'paragraph'
          ? 'p'
          : 'd';
  const copy: Block = { ...at.block, id: newId(prefix) };
  // A copy of a bound field would bind the same property twice, which the server refuses: the copy starts unbound.
  if (copy.type === 'field') delete copy.bind;
  return { def: addBlock(def, copy, at.index + 1, at.step), id: copy.id };
}

export function addOption(f: FieldBlock, label: string): FieldBlock {
  const options = [...(f.options ?? [])];
  if (options.length >= FORM_LIMITS.maxOptions) return f;
  let n = options.length + 1;
  while (options.some((o) => o.value === `opt_${n}`)) n += 1;
  options.push({ value: `opt_${n}`, label });
  return { ...f, options };
}

export function removeOption(f: FieldBlock, index: number): FieldBlock {
  return { ...f, options: (f.options ?? []).filter((_, i) => i !== index) };
}

export function moveOption(f: FieldBlock, index: number, delta: -1 | 1): FieldBlock {
  const options = [...(f.options ?? [])];
  const to = index + delta;
  if (to < 0 || to >= options.length) return f;
  [options[index], options[to]] = [options[to]!, options[index]!];
  return { ...f, options };
}

export function setOptionLabel(f: FieldBlock, index: number, label: string): FieldBlock {
  const options: FormOption[] = (f.options ?? []).map((o, i) =>
    i === index ? { ...o, label } : o,
  );
  return { ...f, options };
}

// ---- checks before Publish (the server repeats every one; this only tells the person early) ----------------------------------

export type DefinitionProblem =
  | { code: 'no_fields' }
  | { code: 'no_contact_point' }
  | { code: 'empty_label'; blockId: string }
  | { code: 'no_options'; blockId: string }
  | { code: 'duplicate_option'; blockId: string }
  | { code: 'bad_range'; blockId: string }
  | { code: 'constant_empty'; blockId: string }
  | { code: 'crm_required_unbound'; property: string; object: string }
  | { code: 'crm_required_optional'; blockId: string }
  | { code: 'redirect_not_https' }
  | { code: 'age_gate_field_missing' }
  | { code: 'age_gate_field_optional'; blockId: string }
  | { code: 'too_large' };

const bindKey = (b: { object: string; property: string }) => `${b.object}:${b.property}`;

export function fieldsOf(def: Pick<Definition, 'steps'>): FieldBlock[] {
  return def.steps.flatMap((s) => s.blocks).filter((b): b is FieldBlock => b.type === 'field');
}

/**
 * Problems that would make Publish fail or the form useless. `properties` is the picker's catalogue (both objects); a property the
 * workspace requires must be bound to a required field (the same check the API makes at publish).
 */
export function definitionProblems(
  def: Definition,
  properties: readonly CrmProperty[] = [],
): DefinitionProblem[] {
  const out: DefinitionProblem[] = [];
  const fields = fieldsOf(def);
  const visible = fields.filter((f) => f.kind !== 'hidden');
  if (visible.length === 0) out.push({ code: 'no_fields' });
  if (JSON.stringify(def).length > FORM_LIMITS.maxDefinitionBytes) out.push({ code: 'too_large' });

  const bound = new Map<string, FieldBlock>();
  for (const f of fields) if (f.bind) bound.set(bindKey(f.bind), f);

  for (const f of fields) {
    if (!f.label.trim()) out.push({ code: 'empty_label', blockId: f.id });
    if (kindHasOptions(f.kind)) {
      const options = f.options ?? [];
      if (options.length === 0 || options.some((o) => !o.label.trim()))
        out.push({ code: 'no_options', blockId: f.id });
      else if (new Set(options.map((o) => o.label.trim().toLowerCase())).size !== options.length)
        out.push({ code: 'duplicate_option', blockId: f.id });
    }
    const v = f.validation;
    if (
      (v?.min !== undefined && v.max !== undefined && v.min > v.max) ||
      (v?.minLen !== undefined && v.maxLen !== undefined && v.minLen > v.maxLen)
    )
      out.push({ code: 'bad_range', blockId: f.id });
    if (f.kind === 'hidden' && f.hiddenSource === 'constant' && !f.constant?.trim())
      out.push({ code: 'constant_empty', blockId: f.id });
  }

  // A contact needs something to be found by; the server parks a submission without one in "Needs attention".
  const contactPoint = fields.some(
    (f) =>
      f.bind?.object === 'contact' &&
      (f.bind.property === 'email' ||
        f.bind.property === 'phone' ||
        f.kind === 'email' ||
        f.kind === 'phone'),
  );
  if (fields.length > 0 && !contactPoint) out.push({ code: 'no_contact_point' });

  for (const p of properties) {
    if (!p.requiredByWorkspace) continue;
    const field = bound.get(bindKey({ object: p.object, property: p.property }));
    if (!field) out.push({ code: 'crm_required_unbound', property: p.property, object: p.object });
    else if (!field.required) out.push({ code: 'crm_required_optional', blockId: field.id });
  }

  // The age check needs the question it judges, and it has to be required (BL-217). The declaration needs none.
  if (def.ageGate.enabled && def.ageGate.mode !== 'declaration') {
    const want = def.ageGate.mode === 'dob' ? 'date_of_birth' : 'age';
    const q = fields.find((f) => f.kind === want);
    if (!q) out.push({ code: 'age_gate_field_missing' });
    else if (!q.required) out.push({ code: 'age_gate_field_optional', blockId: q.id });
  }

  if (def.settings.successMode === 'redirect' && safeRedirect(def.settings.redirectUrl) === null)
    out.push({ code: 'redirect_not_https' });
  return out;
}

/**
 * Changes the age check (BL-217) and keeps the form able to ask it: a date-of-birth or age mode adds the question as a REQUIRED field
 * when the form has none, and makes an existing one required. The declaration mode needs no field.
 */
export function withAgeGate(
  def: Definition,
  patch: Partial<Definition['ageGate']>,
  labels: { dob: string; age: string },
): Definition {
  const gate = { ...def.ageGate, ...patch };
  let steps = def.steps;
  if (gate.enabled && gate.mode !== 'declaration') {
    const kind: FieldKind = gate.mode === 'dob' ? 'date_of_birth' : 'age';
    const have = fieldsOf(def).find((f) => f.kind === kind);
    if (!have) {
      const q = newField(kind, gate.mode === 'dob' ? labels.dob : labels.age);
      q.required = true;
      steps = def.steps.map((s, i) =>
        i === def.steps.length - 1 ? { ...s, blocks: [...s.blocks, q] } : s,
      );
    } else if (!have.required) {
      steps = def.steps.map((s) => ({
        ...s,
        blocks: s.blocks.map((b) =>
          b.type === 'field' && b.id === have.id ? { ...b, required: true } : b,
        ),
      }));
    }
  }
  return { ...def, ageGate: gate, steps };
}

/** Unsaved changes: the draft on the page differs from what the server has. */
export function isDirty(current: unknown, saved: unknown): boolean {
  return JSON.stringify(current) !== JSON.stringify(saved);
}

export function fieldCount(def: Definition): number {
  return fieldsOf(def).filter((f) => f.kind !== 'hidden').length;
}

/** The CRM properties already bound in this form, to grey them in the picker. */
export function boundKeys(def: Definition): Set<string> {
  const out = new Set<string>();
  for (const f of fieldsOf(def)) if (f.bind) out.add(bindKey(f.bind));
  return out;
}

export const isBound = (
  keys: ReadonlySet<string>,
  p: Pick<CrmProperty, 'object' | 'property'>,
): boolean => keys.has(bindKey(p));
