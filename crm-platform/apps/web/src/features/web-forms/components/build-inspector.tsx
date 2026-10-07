'use client';

import { useId } from 'react';
import { useTranslations } from 'next-intl';
import { FORM_LIMITS, isSafeFormPattern } from '@crm/contracts';
import { Button, Field, Input, Select, Switch, Textarea } from '@crm/ui';
import { findProperty, groupProperties, kindChoices, kindTraits } from '../lib/build-view';
import {
  addOption,
  bindField,
  changeKind,
  isBound,
  moveOption,
  removeOption,
  setOptionLabel,
} from '../lib/builder-model';
import {
  FORM_HIDDEN_SOURCES,
  type Block,
  type CrmProperty,
  type FieldBlock,
  type FormHiddenSource,
} from '../lib/types';

const numberOrUndefined = (v: string): number | undefined => {
  if (v.trim() === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

/** The right-hand panel: the settings of the selected block. Everything is read only without edit permission. */
export function BlockInspector({
  block,
  properties,
  bound,
  canEdit,
  onChange,
}: {
  block: Block;
  properties: readonly CrmProperty[];
  bound: ReadonlySet<string>;
  canEdit: boolean;
  onChange: (next: Block) => void;
}) {
  const t = useTranslations('web-forms.build.inspector');
  const id = useId();

  if (block.type === 'divider')
    return <p className="text-sm text-muted-foreground">{t('dividerNote')}</p>;

  if (block.type === 'heading') {
    return (
      <div className="space-y-4">
        <Field label={t('headingText')} htmlFor={`${id}-text`}>
          <Input
            id={`${id}-text`}
            value={block.text}
            maxLength={FORM_LIMITS.maxLabel}
            disabled={!canEdit}
            onChange={(e) => onChange({ ...block, text: e.target.value })}
          />
        </Field>
        <Field label={t('headingLevel')} htmlFor={`${id}-level`}>
          <Select
            id={`${id}-level`}
            value={String(block.level)}
            disabled={!canEdit}
            onChange={(e) => onChange({ ...block, level: Number(e.target.value) as 1 | 2 | 3 })}
          >
            {[1, 2, 3].map((l) => (
              <option key={l} value={l}>
                {t(`level.${l}`)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    );
  }

  if (block.type === 'paragraph') {
    return (
      <Field label={t('paragraphText')} htmlFor={`${id}-html`} hint={t('paragraphHint')}>
        <Textarea
          id={`${id}-html`}
          rows={6}
          value={block.html}
          maxLength={FORM_LIMITS.maxRichText}
          disabled={!canEdit}
          onChange={(e) => onChange({ ...block, html: e.target.value })}
        />
      </Field>
    );
  }

  return (
    <FieldInspector
      field={block}
      properties={properties}
      bound={bound}
      canEdit={canEdit}
      onChange={onChange}
      id={id}
    />
  );
}

function FieldInspector({
  field: f,
  properties,
  bound,
  canEdit,
  onChange,
  id,
}: {
  field: FieldBlock;
  properties: readonly CrmProperty[];
  bound: ReadonlySet<string>;
  canEdit: boolean;
  onChange: (next: FieldBlock) => void;
  id: string;
}) {
  const t = useTranslations('web-forms.build.inspector');
  const k = useTranslations('web-forms.kinds');
  const p = useTranslations('web-forms.build.palette');
  const traits = kindTraits(f.kind);
  const property = findProperty(properties, f.bind);
  const mode = f.bind ? 'crm' : 'new';
  const v = f.validation ?? {};
  const setValidation = (patch: Partial<NonNullable<FieldBlock['validation']>>) => {
    const next = { ...v, ...patch };
    for (const key of Object.keys(next) as Array<keyof typeof next>)
      if (next[key] === undefined) delete next[key];
    onChange({ ...f, validation: Object.keys(next).length ? next : undefined });
  };
  const patternBad = v.pattern !== undefined && v.pattern !== '' && !isSafeFormPattern(v.pattern);
  const rangeBad =
    (v.min !== undefined && v.max !== undefined && v.min > v.max) ||
    (v.minLen !== undefined && v.maxLen !== undefined && v.minLen > v.maxLen);
  // A property the catalogue no longer lists (renamed or removed) still shows, so the person can see and detach the binding.
  const groups = groupProperties(properties, '');

  return (
    <div className="space-y-5">
      {f.kind !== 'hidden' && (
        <Field
          label={t('label')}
          htmlFor={`${id}-label`}
          error={f.label.trim() === '' ? t('labelRequired') : undefined}
        >
          <Input
            id={`${id}-label`}
            value={f.label}
            maxLength={FORM_LIMITS.maxLabel}
            invalid={f.label.trim() === ''}
            disabled={!canEdit}
            onChange={(e) => onChange({ ...f, label: e.target.value })}
          />
        </Field>
      )}
      {f.kind === 'hidden' && (
        <Field label={t('hiddenName')} htmlFor={`${id}-label`} hint={t('hiddenNameHint')}>
          <Input
            id={`${id}-label`}
            value={f.label}
            maxLength={FORM_LIMITS.maxLabel}
            disabled={!canEdit}
            onChange={(e) => onChange({ ...f, label: e.target.value })}
          />
        </Field>
      )}

      <fieldset className="space-y-2" disabled={!canEdit}>
        <legend className="text-sm font-medium">{t('source.title')}</legend>
        {(['new', 'crm'] as const).map((m) => (
          <label key={m} className="flex cursor-pointer items-start gap-2 text-sm">
            <input
              type="radio"
              name={`${id}-source`}
              className="mt-1"
              checked={mode === m}
              onChange={() => {
                if (m === 'new') onChange(bindField(f, null));
                else {
                  const first = groups
                    .flatMap((g) => g.items)
                    .find((x) => !isBound(bound, x) && x.suggestedKind !== 'hidden');
                  if (first) onChange(bindField(f, first));
                }
              }}
            />
            <span>
              <span className="block font-medium">{t(`source.${m}`)}</span>
              <span className="block text-xs text-muted-foreground">{t(`source.${m}Hint`)}</span>
            </span>
          </label>
        ))}
        {mode === 'crm' && (
          <div>
            <label htmlFor={`${id}-prop`} className="sr-only">
              {t('source.property')}
            </label>
            <Select
              id={`${id}-prop`}
              value={f.bind ? `${f.bind.object}:${f.bind.property}` : ''}
              onChange={(e) => {
                const [object, ...rest] = e.target.value.split(':');
                const next = findProperty(properties, {
                  object: object ?? '',
                  property: rest.join(':'),
                });
                if (next) onChange(bindField(f, next));
              }}
            >
              {!property && f.bind && (
                <option value={`${f.bind.object}:${f.bind.property}`}>
                  {t('source.unknown', { property: f.bind.property })}
                </option>
              )}
              {groups.map((g) => (
                <optgroup key={g.object} label={p(`object.${g.object}`)}>
                  {g.items.map((x) => {
                    const mine = f.bind?.object === x.object && f.bind.property === x.property;
                    return (
                      <option
                        key={`${x.object}:${x.property}`}
                        value={`${x.object}:${x.property}`}
                        disabled={!mine && isBound(bound, x)}
                      >
                        {x.label}
                      </option>
                    );
                  })}
                </optgroup>
              ))}
            </Select>
            {property?.requiredByWorkspace && (
              <p className="mt-1 text-xs text-warning">{t('source.requiredByCrm')}</p>
            )}
          </div>
        )}
      </fieldset>

      <Field label={t('kind')} htmlFor={`${id}-kind`} hint={f.bind ? t('kindLocked') : undefined}>
        <Select
          id={`${id}-kind`}
          value={f.kind}
          disabled={!canEdit || kindChoices(f).length < 2}
          onChange={(e) => onChange(changeKind(f, e.target.value as FieldBlock['kind']))}
        >
          {kindChoices(f).map((kind) => (
            <option key={kind} value={kind}>
              {k(kind)}
            </option>
          ))}
        </Select>
      </Field>

      {f.kind === 'hidden' ? (
        <>
          <Field label={t('hiddenSource')} htmlFor={`${id}-hsource`}>
            <Select
              id={`${id}-hsource`}
              value={f.hiddenSource ?? 'utm_source'}
              disabled={!canEdit}
              onChange={(e) => {
                const hiddenSource = e.target.value as FormHiddenSource;
                const next = { ...f, hiddenSource };
                if (hiddenSource !== 'constant') delete next.constant;
                onChange(next);
              }}
            >
              {FORM_HIDDEN_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {p(`source.${s}`)}
                </option>
              ))}
            </Select>
          </Field>
          {f.hiddenSource === 'constant' && (
            <Field
              label={t('constant')}
              htmlFor={`${id}-constant`}
              error={!f.constant?.trim() ? t('constantRequired') : undefined}
            >
              <Input
                id={`${id}-constant`}
                value={f.constant ?? ''}
                maxLength={500}
                invalid={!f.constant?.trim()}
                disabled={!canEdit}
                onChange={(e) => onChange({ ...f, constant: e.target.value })}
              />
            </Field>
          )}
        </>
      ) : (
        <>
          <Field label={t('help')} htmlFor={`${id}-help`}>
            <Input
              id={`${id}-help`}
              value={f.help ?? ''}
              maxLength={300}
              disabled={!canEdit}
              onChange={(e) => onChange({ ...f, help: e.target.value || undefined })}
            />
          </Field>
          {traits.placeholder && (
            <Field label={t('placeholder')} htmlFor={`${id}-ph`}>
              <Input
                id={`${id}-ph`}
                value={f.placeholder ?? ''}
                maxLength={120}
                disabled={!canEdit}
                onChange={(e) => onChange({ ...f, placeholder: e.target.value || undefined })}
              />
            </Field>
          )}
          <div className="flex items-center justify-between gap-3">
            <label htmlFor={`${id}-required`} className="text-sm font-medium">
              {t('required')}
              {property?.requiredByWorkspace && (
                <span className="block text-xs font-normal text-muted-foreground">
                  {t('requiredLocked')}
                </span>
              )}
            </label>
            <Switch
              id={`${id}-required`}
              label={t('required')}
              checked={f.required}
              disabled={!canEdit || property?.requiredByWorkspace === true}
              onCheckedChange={(required) => onChange({ ...f, required })}
            />
          </div>
          <Field label={t('width')} htmlFor={`${id}-width`}>
            <Select
              id={`${id}-width`}
              value={f.width}
              disabled={!canEdit}
              onChange={(e) => onChange({ ...f, width: e.target.value as 'full' | 'half' })}
            >
              <option value="full">{t('widthFull')}</option>
              <option value="half">{t('widthHalf')}</option>
            </Select>
          </Field>
        </>
      )}

      {traits.options && (
        <OptionsEditor
          field={f}
          locked={f.bind !== undefined}
          canEdit={canEdit}
          onChange={onChange}
          id={id}
        />
      )}

      {(traits.textLimits || traits.range) && (
        <fieldset className="space-y-3" disabled={!canEdit}>
          <legend className="text-sm font-medium">{t('validation')}</legend>
          {traits.textLimits && (
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('minLen')} htmlFor={`${id}-minlen`}>
                <Input
                  id={`${id}-minlen`}
                  type="number"
                  min={0}
                  max={FORM_LIMITS.maxAnswerLength}
                  value={v.minLen ?? ''}
                  onChange={(e) => setValidation({ minLen: numberOrUndefined(e.target.value) })}
                />
              </Field>
              <Field label={t('maxLen')} htmlFor={`${id}-maxlen`}>
                <Input
                  id={`${id}-maxlen`}
                  type="number"
                  min={1}
                  max={FORM_LIMITS.maxAnswerLength}
                  value={v.maxLen ?? ''}
                  onChange={(e) => setValidation({ maxLen: numberOrUndefined(e.target.value) })}
                />
              </Field>
            </div>
          )}
          {traits.range && (
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('min')} htmlFor={`${id}-min`}>
                <Input
                  id={`${id}-min`}
                  type="number"
                  value={v.min ?? ''}
                  onChange={(e) => setValidation({ min: numberOrUndefined(e.target.value) })}
                />
              </Field>
              <Field label={t('max')} htmlFor={`${id}-max`}>
                <Input
                  id={`${id}-max`}
                  type="number"
                  value={v.max ?? ''}
                  onChange={(e) => setValidation({ max: numberOrUndefined(e.target.value) })}
                />
              </Field>
            </div>
          )}
          {rangeBad && (
            <p role="alert" className="text-xs text-danger">
              {t('rangeBad')}
            </p>
          )}
          {traits.pattern && (
            <Field
              label={t('pattern')}
              htmlFor={`${id}-pattern`}
              hint={t('patternHint')}
              error={patternBad ? t('patternBad') : undefined}
            >
              <Input
                id={`${id}-pattern`}
                value={v.pattern ?? ''}
                maxLength={200}
                invalid={patternBad}
                className="font-mono"
                dir="ltr"
                onChange={(e) => setValidation({ pattern: e.target.value || undefined })}
              />
            </Field>
          )}
        </fieldset>
      )}
    </div>
  );
}

function OptionsEditor({
  field: f,
  locked,
  canEdit,
  onChange,
  id,
}: {
  field: FieldBlock;
  locked: boolean;
  canEdit: boolean;
  onChange: (next: FieldBlock) => void;
  id: string;
}) {
  const t = useTranslations('web-forms.build.inspector');
  const options = f.options ?? [];
  const labels = options.map((o) => o.label.trim().toLowerCase());
  return (
    <fieldset className="space-y-2" disabled={!canEdit || locked}>
      <legend className="text-sm font-medium">{t('options')}</legend>
      {locked && <p className="text-xs text-muted-foreground">{t('optionsLocked')}</p>}
      <ol className="space-y-2">
        {options.map((o, i) => {
          const dup = o.label.trim() !== '' && labels.indexOf(o.label.trim().toLowerCase()) !== i;
          return (
            <li key={o.value} className="flex items-center gap-1.5">
              <label htmlFor={`${id}-opt-${i}`} className="sr-only">
                {t('optionN', { n: i + 1 })}
              </label>
              <Input
                id={`${id}-opt-${i}`}
                value={o.label}
                maxLength={FORM_LIMITS.maxLabel}
                invalid={o.label.trim() === '' || dup}
                onChange={(e) => onChange(setOptionLabel(f, i, e.target.value))}
              />
              <Button
                size="sm"
                variant="ghost"
                aria-label={t('optionUp', { n: i + 1 })}
                disabled={i === 0}
                onClick={() => onChange(moveOption(f, i, -1))}
              >
                <span aria-hidden="true">&#8593;</span>
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label={t('optionDown', { n: i + 1 })}
                disabled={i === options.length - 1}
                onClick={() => onChange(moveOption(f, i, 1))}
              >
                <span aria-hidden="true">&#8595;</span>
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label={t('optionRemove', { n: i + 1 })}
                disabled={options.length <= 1}
                onClick={() => onChange(removeOption(f, i))}
              >
                <span aria-hidden="true">&#215;</span>
              </Button>
            </li>
          );
        })}
      </ol>
      {labels.some((l, i) => l !== '' && labels.indexOf(l) !== i) && (
        <p role="alert" className="text-xs text-danger">
          {t('optionDuplicate')}
        </p>
      )}
      <Button
        size="sm"
        variant="secondary"
        disabled={options.length >= FORM_LIMITS.maxOptions}
        onClick={() => onChange(addOption(f, t('optionDefault', { n: options.length + 1 })))}
      >
        {t('addOption')}
      </Button>
    </fieldset>
  );
}
