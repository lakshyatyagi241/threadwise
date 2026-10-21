'use client';

import { useId, useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import type {
  FieldDependencyResponse,
  FieldResponse,
  FieldSectionResponse,
  FieldType,
  ModuleKey,
} from '@crm/contracts';
import {
  Alert,
  Button,
  Field,
  Input,
  Modal,
  Select,
  Spinner,
  Switch,
  Textarea,
  useToast,
} from '@crm/ui';
import {
  createField,
  createFieldDependency,
  createFieldOption,
  deleteFieldDependency,
  deleteFieldOption,
  hasLazyOptions,
  invalidateProperties,
  renameFieldOption,
  reorderFieldOptions,
  updateField,
} from '../api/properties';
import { ATTRIBUTE_KEY_MAX, suggestKey } from '../lib/attribute-model';
import { errorKind } from '../lib/errors';
import {
  CREATABLE_TYPES,
  DESCRIPTION_MAX,
  LABEL_MAX,
  OPTION_LABEL_MAX,
  checkDraft,
  conditionRulesOf,
  diffConditions,
  diffOptions,
  draftFromField,
  emptyDraft,
  hasProblems,
  isOptionType,
  newOptionValue,
  toCreateBody,
  toUpdateBody,
  type DraftCondition,
  type PropertyDraft,
} from '../lib/property-model';
import { moveItem, sameOrder } from '../lib/stage-model';
import { useModuleCopy } from '../lib/module-copy';
import { ErrorLine } from './error-line';
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, TrashIcon } from './icons';

export interface PropertyModalProps {
  open: boolean;
  /** Present = edit this property; absent = add one. */
  field?: FieldResponse;
  /** The section a new property starts in. */
  sectionId?: string;
  sections: readonly FieldSectionResponse[];
  /** Every custom property, inactive ones too: for the key check and the "show only when" choices. */
  fields: readonly FieldResponse[];
  dependencies: readonly FieldDependencyResponse[];
  /** The module the property belongs to (default contacts). */
  moduleKey?: ModuleKey;
  /** Called with the property once it is saved (made or changed), before the dialog closes. */
  onSaved?: (field: FieldResponse) => void;
  onClose: () => void;
}

export function PropertyModal(props: PropertyModalProps) {
  const t = useTranslations('contacts-attributes-tags.properties');
  const copy = useModuleCopy(props.moduleKey ?? 'contacts');
  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      size="lg"
      eyebrow={props.field ? t('modal.editEyebrow') : t('modal.newEyebrow')}
      title={props.field ? t('modal.editTitle') : copy('modal.newTitle')}
      closeLabel={t('modal.close')}
    >
      {props.open && <PropertyForm key={props.field?.id ?? 'new'} {...props} />}
    </Modal>
  );
}

function PropertyForm({
  field,
  sectionId,
  sections,
  fields,
  dependencies,
  moduleKey = 'contacts',
  onSaved,
  onClose,
}: PropertyModalProps) {
  const t = useTranslations('contacts-attributes-tags.properties');
  const copy = useModuleCopy(moduleKey);
  const qc = useQueryClient();
  const { toast } = useToast();
  const uid = useId();
  const id = (n: string) => `${uid}-${n}`;
  const editing = field !== undefined;
  // Options too many to send with the property list (every City): they are not edited here and are left untouched on save.
  const lazyOptions = field !== undefined && hasLazyOptions(field);

  const [draft, setDraft] = useState<PropertyDraft>(() =>
    field ? draftFromField(field, dependencies) : emptyDraft(sectionId ?? sections[0]?.id ?? ''),
  );
  const [keyTouched, setKeyTouched] = useState(false);
  const [newOption, setNewOption] = useState('');
  const [shown, setShown] = useState(false);
  const set = <K extends keyof PropertyDraft>(k: K, v: PropertyDraft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  const takenKeys = useMemo(() => new Set(fields.map((f) => f.key)), [fields]);
  const problems = shown ? checkDraft(draft, { editing, takenKeys, lazyOptions }) : {};
  const others = fields.filter((f) => f.id !== field?.id && f.isActive);
  // The saved "show only when" rules; a cascade link is left alone by this form (the Dependent fields dialog owns it).
  const savedDeps = field ? conditionRulesOf(field.id, dependencies) : [];

  const save = useMutation({
    mutationFn: async () => {
      let target: FieldResponse;
      if (field) {
        target = await updateField(field.id, toUpdateBody(draft, field));
        if (isOptionType(field.fieldType) && !lazyOptions) {
          const diff = diffOptions(field.options ?? [], draft.options);
          for (const r of diff.rename) await renameFieldOption(r.option, r.label);
          const made: Array<{ id: string }> = [];
          for (const o of diff.create) {
            made.push(await createFieldOption(field.id, { value: o.value, label: o.label.trim() }));
          }
          for (const r of diff.remove) await deleteFieldOption(r.id);
          let next = 0;
          const finalIds = draft.options.map((o) => o.id ?? made[next++]!.id);
          const removed = new Set(diff.remove.map((r) => r.id));
          const expected = [
            ...(field.options ?? []).filter((o) => !removed.has(o.id)).map((o) => o.id),
            ...made.map((m) => m.id),
          ];
          if (!sameOrder(finalIds, expected)) await reorderFieldOptions(field.id, finalIds);
        }
      } else {
        target = await createField(toCreateBody(draft, moduleKey));
      }
      const diff = diffConditions(savedDeps, draft.conditions);
      for (const dep of diff.remove) await deleteFieldDependency(dep);
      for (const c of diff.create) {
        await createFieldDependency({
          fieldId: target.id,
          dependsOnFieldId: c.fieldId,
          ...(c.optionId ? { dependsOnOptionId: c.optionId } : { dependsOnValue: c.value.trim() }),
        });
      }
      return target;
    },
    onSuccess: async (saved) => {
      await invalidateProperties(qc);
      toast(editing ? t('modal.updated') : t('modal.created'), 'success');
      onSaved?.(saved);
      onClose();
    },
    onError: () => void invalidateProperties(qc),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setShown(true);
    const found = checkDraft(draft, { editing, takenKeys, lazyOptions });
    if (hasProblems(found)) {
      const first = found.label ? 'label' : found.key ? 'key' : found.section ? 'section' : null;
      if (first) document.getElementById(id(first))?.focus();
      return;
    }
    save.mutate();
  }

  // --- options -------------------------------------------------------------------------------------------------
  function addOption() {
    const label = newOption.trim();
    if (!label) return;
    setDraft((d) => ({
      ...d,
      options: [...d.options, { value: newOptionValue(label, d.options), label }],
    }));
    setNewOption('');
  }

  // --- conditions ---------------------------------------------------------------------------------------------
  const setCondition = (i: number, patch: Partial<DraftCondition>) =>
    setDraft((d) => ({
      ...d,
      conditions: d.conditions.map((c, at) => (at === i ? { ...c, ...patch } : c)),
    }));

  const failed = save.isError;
  const cycle = failed && errorKind(save.error) === 'dependencyCycle';
  const typeHelp = editing ? '' : t(`typeHelp.${draft.type}`);

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      {failed && (
        <div className="space-y-2">
          <ErrorLine error={save.error} />
          {!cycle && <p className="text-xs text-muted-foreground">{t('modal.partial')}</p>}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label={`${t('modal.name')} *`}
          htmlFor={id('label')}
          error={problems.label ? t(`modal.problem.label.${problems.label}`) : undefined}
        >
          <Input
            id={id('label')}
            value={draft.label}
            maxLength={LABEL_MAX}
            autoFocus
            invalid={Boolean(problems.label)}
            placeholder={t('modal.namePlaceholder')}
            onChange={(e) => {
              const label = e.target.value;
              setDraft((d) => ({
                ...d,
                label,
                key: editing || keyTouched ? d.key : suggestKey(label),
              }));
            }}
          />
        </Field>
        <Field
          label={`${t('modal.key')} *`}
          htmlFor={id('key')}
          error={problems.key ? t(`modal.problem.key.${problems.key}`) : undefined}
          hint={editing ? t('modal.keyFixed') : t('modal.keyHint')}
        >
          <Input
            id={id('key')}
            dir="ltr"
            className="font-mono"
            value={draft.key}
            maxLength={ATTRIBUTE_KEY_MAX + 1}
            readOnly={editing}
            invalid={Boolean(problems.key)}
            placeholder="order_id"
            onChange={(e) => {
              setKeyTouched(true);
              set('key', e.target.value);
            }}
          />
        </Field>
        <Field
          label={t('modal.type')}
          htmlFor={id('type')}
          hint={editing ? t('modal.typeFixed') : typeHelp}
        >
          <Select
            id={id('type')}
            value={draft.type}
            disabled={editing}
            onChange={(e) => set('type', e.target.value as FieldType)}
          >
            {editing && !(CREATABLE_TYPES as readonly string[]).includes(draft.type) && (
              <option value={draft.type}>{t(`types.${draft.type}`)}</option>
            )}
            {CREATABLE_TYPES.map((x) => (
              <option key={x} value={x}>
                {t(`types.${x}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label={`${t('modal.section')} *`}
          htmlFor={id('section')}
          error={problems.section ? t('modal.problem.section') : undefined}
        >
          <Select
            id={id('section')}
            value={draft.sectionId}
            invalid={Boolean(problems.section)}
            onChange={(e) => set('sectionId', e.target.value)}
          >
            {draft.sectionId === '' && <option value="">{t('modal.sectionNone')}</option>}
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field
        label={t('modal.description')}
        htmlFor={id('description')}
        hint={copy('modal.descriptionHint')}
      >
        <Textarea
          id={id('description')}
          rows={2}
          maxLength={DESCRIPTION_MAX}
          value={draft.description}
          onChange={(e) => set('description', e.target.value)}
        />
      </Field>

      {isOptionType(draft.type) && lazyOptions && (
        <p className="text-xs text-muted-foreground">
          {t('modal.optionsLazy', { count: field?.optionCount ?? 0 })}
        </p>
      )}
      {isOptionType(draft.type) && !lazyOptions && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t('modal.options')} *</legend>
          {draft.options.length > 0 && (
            <ul className="space-y-1.5">
              {draft.options.map((o, i) => (
                <li key={o.id ?? o.value} className="flex items-center gap-1.5">
                  <Input
                    value={o.label}
                    maxLength={OPTION_LABEL_MAX}
                    aria-label={t('modal.optionLabel', { n: i + 1 })}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        options: d.options.map((x, at) =>
                          at === i ? { ...x, label: e.target.value } : x,
                        ),
                      }))
                    }
                  />
                  <code
                    dir="ltr"
                    className="hidden w-28 shrink-0 truncate font-mono text-xs text-muted-foreground sm:block"
                    title={o.value}
                  >
                    {o.value}
                  </code>
                  <SmallButton
                    label={t('modal.optionUp', { n: i + 1 })}
                    disabled={i === 0}
                    onClick={() => set('options', moveItem(draft.options, i, i - 1))}
                  >
                    <ArrowUpIcon className="size-3.5" />
                  </SmallButton>
                  <SmallButton
                    label={t('modal.optionDown', { n: i + 1 })}
                    disabled={i === draft.options.length - 1}
                    onClick={() => set('options', moveItem(draft.options, i, i + 1))}
                  >
                    <ArrowDownIcon className="size-3.5" />
                  </SmallButton>
                  <SmallButton
                    label={t('modal.optionRemove', { n: i + 1 })}
                    danger
                    onClick={() =>
                      set(
                        'options',
                        draft.options.filter((_, at) => at !== i),
                      )
                    }
                  >
                    <TrashIcon className="size-3.5" />
                  </SmallButton>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <Input
              value={newOption}
              maxLength={OPTION_LABEL_MAX}
              placeholder={t('modal.optionPlaceholder')}
              aria-label={t('modal.optionNew')}
              onChange={(e) => setNewOption(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addOption();
                }
              }}
            />
            <Button variant="secondary" onClick={addOption} disabled={!newOption.trim()}>
              <PlusIcon /> {t('modal.optionAdd')}
            </Button>
          </div>
          {problems.options && (
            <p role="alert" className="text-xs text-danger">
              {t(`modal.problem.options.${problems.options}`)}
            </p>
          )}
          {editing && <p className="text-xs text-muted-foreground">{copy('modal.optionsNote')}</p>}
        </fieldset>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        <ToggleRow
          id={id('required')}
          label={t('modal.required')}
          hint={copy('modal.requiredHint')}
          checked={draft.required}
          onChange={(v) => set('required', v)}
        />
        <ToggleRow
          id={id('visible')}
          label={t('modal.visible')}
          hint={copy('modal.visibleHint')}
          checked={draft.visible}
          onChange={(v) => set('visible', v)}
        />
        <ToggleRow
          id={id('readonly')}
          label={t('modal.readOnly')}
          hint={t('modal.readOnlyHint')}
          checked={draft.readOnly}
          onChange={(v) => set('readOnly', v)}
        />
        {editing && (
          <ToggleRow
            id={id('active')}
            label={t('modal.active')}
            hint={t('modal.activeHint')}
            checked={draft.active}
            onChange={(v) => set('active', v)}
          />
        )}
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t('modal.conditions')}</legend>
        <p className="text-xs text-muted-foreground">{copy('modal.conditionsHint')}</p>
        {draft.conditions.map((c, i) => {
          const parent = others.find((f) => f.id === c.fieldId);
          // a parent with a very long list comes without its options: its value is typed (the rule then matches that stored value)
          const choices =
            parent && isOptionType(parent.fieldType) && !hasLazyOptions(parent)
              ? (parent.options ?? [])
              : null;
          const yesNo =
            parent && (parent.fieldType === 'checkbox' || parent.fieldType === 'boolean');
          return (
            <div
              key={c.id ?? `new-${i}`}
              className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2"
            >
              <span className="text-xs text-muted-foreground">{t('modal.when')}</span>
              <Select
                aria-label={t('modal.conditionField')}
                className="w-auto min-w-40 flex-1"
                value={c.fieldId}
                disabled={Boolean(c.id)}
                onChange={(e) =>
                  setCondition(i, { fieldId: e.target.value, optionId: null, value: '' })
                }
              >
                <option value="">{t('modal.conditionPick')}</option>
                {others.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </Select>
              <span className="text-xs text-muted-foreground">{t('modal.is')}</span>
              {choices ? (
                <Select
                  aria-label={t('modal.conditionValue')}
                  className="w-auto min-w-36 flex-1"
                  value={c.optionId ?? ''}
                  disabled={Boolean(c.id)}
                  onChange={(e) => setCondition(i, { optionId: e.target.value || null, value: '' })}
                >
                  <option value="">{t('modal.conditionPick')}</option>
                  {choices.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              ) : yesNo ? (
                <Select
                  aria-label={t('modal.conditionValue')}
                  className="w-auto min-w-36 flex-1"
                  value={c.value}
                  disabled={Boolean(c.id)}
                  onChange={(e) => setCondition(i, { optionId: null, value: e.target.value })}
                >
                  <option value="">{t('modal.conditionPick')}</option>
                  <option value="true">{t('modal.yes')}</option>
                  <option value="false">{t('modal.no')}</option>
                </Select>
              ) : (
                <Input
                  aria-label={t('modal.conditionValue')}
                  className="w-auto min-w-36 flex-1"
                  value={c.value}
                  disabled={Boolean(c.id)}
                  placeholder={t('modal.conditionText')}
                  onChange={(e) => setCondition(i, { optionId: null, value: e.target.value })}
                />
              )}
              <SmallButton
                label={t('modal.conditionRemove')}
                danger
                onClick={() =>
                  set(
                    'conditions',
                    draft.conditions.filter((_, at) => at !== i),
                  )
                }
              >
                <TrashIcon className="size-3.5" />
              </SmallButton>
            </div>
          );
        })}
        {problems.condition && (
          <p role="alert" className="text-xs text-danger">
            {t('modal.problem.condition')}
          </p>
        )}
        <Button
          variant="secondary"
          size="sm"
          disabled={others.length === 0}
          onClick={() =>
            set('conditions', [...draft.conditions, { fieldId: '', optionId: null, value: '' }])
          }
        >
          <PlusIcon /> {t('modal.conditionAdd')}
        </Button>
      </fieldset>

      {editing && draft.active !== field.isActive && !draft.active && (
        <Alert tone="warning">{copy('modal.deactivateNote')}</Alert>
      )}

      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
          {failed ? t('modal.closeAfterError') : t('modal.cancel')}
        </Button>
        <Button type="submit" disabled={save.isPending || failed}>
          {save.isPending && <Spinner />}
          {editing ? t('modal.save') : t('modal.create')}
        </Button>
      </div>
    </form>
  );
}

function ToggleRow({
  id,
  label,
  hint,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border border-border p-3">
      <div className="min-w-0 text-sm">
        <label htmlFor={id} className="block font-medium">
          {label}
        </label>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} label={label} />
    </div>
  );
}

function SmallButton({
  label,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={
        'inline-flex size-8 shrink-0 items-center justify-center rounded-md outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-35 ' +
        (danger ? 'text-danger hover:bg-danger/10' : 'text-muted-foreground hover:text-foreground')
      }
    >
      {children}
    </button>
  );
}
