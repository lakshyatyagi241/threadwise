'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { Badge, Card, Checkbox, Field, Input, Select, Switch, Textarea, cn } from '@crm/ui';
import { enforcementFor, enforcementTone } from '../lib/enforcement';
import {
  MFA_METHODS,
  NUMERIC_FIELDS,
  type BooleanKey,
  type MfaMethod,
  type NumericKey,
} from '../lib/policy-draft';
import { SECURITY_NS, fieldId, usePolicyForm } from './policy-form';
import type { SecurityPolicy } from '@crm/contracts';

/** "Enforced / Partial / Reserved": what the platform really does with a control today. */
export function EnforcementBadge({ name }: { name: keyof SecurityPolicy }) {
  const t = useTranslations(`${SECURITY_NS}.enforcement`);
  const { matrix } = usePolicyForm();
  const row = enforcementFor(matrix, name);
  if (!row) return null;
  return (
    <Badge tone={enforcementTone(row.status)} title={row.consumer} className="shrink-0 font-normal">
      {t(row.status)}
      <span className="sr-only">: {row.consumer}</span>
    </Badge>
  );
}

function ControlLabel({ name, children }: { name: keyof SecurityPolicy; children: ReactNode }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      {children}
      <EnforcementBadge name={name} />
    </span>
  );
}

/** A card with a small caps kicker, a title and optional description, used by every panel. */
export function SettingsCard({
  kicker,
  title,
  description,
  tone = 'default',
  className,
  children,
}: {
  kicker?: string;
  title: string;
  description?: string;
  tone?: 'default' | 'danger';
  className?: string;
  children: ReactNode;
}) {
  return (
    <Card
      className={cn('space-y-4', tone === 'danger' && 'border-danger/40 bg-danger/5', className)}
    >
      <header className="space-y-1">
        {kicker && (
          <p
            className={cn(
              'font-mono text-[11px] uppercase tracking-[0.16em]',
              tone === 'danger' ? 'text-danger' : 'text-muted-foreground',
            )}
          >
            {kicker}
          </p>
        )}
        <h2
          className={cn('text-lg font-semibold leading-tight', tone === 'danger' && 'text-danger')}
        >
          {title}
        </h2>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </header>
      {children}
    </Card>
  );
}

export function ToggleControl({
  name,
  emphasis = false,
}: {
  name: BooleanKey;
  emphasis?: boolean;
}) {
  const t = useTranslations(`${SECURITY_NS}.controls`);
  const { draft, setField, readOnly, errors } = usePolicyForm();
  const id = fieldId(name);
  const error = errors[name];
  return (
    <div
      className={cn(
        'flex items-start justify-between gap-3 rounded-md border p-3',
        emphasis ? 'border-primary/50 bg-primary/5' : 'border-border',
      )}
    >
      <div className="min-w-0 space-y-1">
        <label htmlFor={id} className="block cursor-pointer text-sm font-medium">
          <ControlLabel name={name}>{t(`${name}.label`)}</ControlLabel>
        </label>
        {t.has(`${name}.hint`) && (
          <p className="text-xs text-muted-foreground">{t(`${name}.hint`)}</p>
        )}
        {error && (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        )}
      </div>
      <Switch
        id={id}
        checked={draft[name]}
        onCheckedChange={(v) => setField(name, v)}
        label={t(`${name}.label`)}
        disabled={readOnly}
      />
    </div>
  );
}

export function NumberControl({ name }: { name: NumericKey }) {
  const t = useTranslations(`${SECURITY_NS}.controls`);
  const tc = useTranslations(`${SECURITY_NS}.common`);
  const { base, draft, setField, readOnly, errors } = usePolicyForm();
  const spec = NUMERIC_FIELDS[name];
  const allowZero = 'allowZero' in spec && spec.allowZero === true;
  const range = allowZero
    ? tc('rangeWithZero', { min: spec.min, max: spec.max })
    : tc('range', { min: spec.min, max: spec.max });
  const hint = [t.has(`${name}.hint`) ? t(`${name}.hint`) : '', range, tc('blankKeeps')]
    .filter(Boolean)
    .join(' ');
  return (
    <Field
      label={<ControlLabel name={name}>{t(`${name}.label`)}</ControlLabel>}
      htmlFor={fieldId(name)}
      hint={hint}
      error={errors[name]}
    >
      <Input
        id={fieldId(name)}
        type="number"
        inputMode="numeric"
        min={allowZero ? 0 : spec.min}
        max={spec.max}
        step={1}
        value={draft[name]}
        placeholder={String(base[name])}
        onChange={(e) => setField(name, e.target.value)}
        invalid={Boolean(errors[name])}
        readOnly={readOnly}
        className="font-mono"
      />
    </Field>
  );
}

/** One authenticator-method checkbox group; none ticked keeps the saved list, so it can never be emptied. */
export function MfaMethodsControl() {
  const t = useTranslations(`${SECURITY_NS}.controls.allowedMfaMethods`);
  const { draft, setField, readOnly, errors } = usePolicyForm();
  const toggle = (m: MfaMethod, on: boolean) =>
    setField(
      'allowedMfaMethods',
      on ? [...draft.allowedMfaMethods, m] : draft.allowedMfaMethods.filter((x) => x !== m),
    );
  return (
    <fieldset
      className="min-w-0 space-y-2"
      aria-describedby={`${fieldId('allowedMfaMethods')}-hint`}
    >
      <legend className="mb-1 text-sm font-medium">
        <ControlLabel name="allowedMfaMethods">{t('label')}</ControlLabel>
      </legend>
      <div className="grid gap-2 sm:grid-cols-3">
        {MFA_METHODS.map((m, i) => (
          <div key={m} className="rounded-md border border-border px-3 py-2">
            <Checkbox
              id={i === 0 ? fieldId('allowedMfaMethods') : `${fieldId('allowedMfaMethods')}-${m}`}
              checked={draft.allowedMfaMethods.includes(m)}
              onChange={(e) => toggle(m, e.target.checked)}
              disabled={readOnly}
              label={t(`methods.${m}`)}
            />
          </div>
        ))}
      </div>
      <p id={`${fieldId('allowedMfaMethods')}-hint`} className="text-xs text-muted-foreground">
        {t('hint')}
      </p>
      {errors.allowedMfaMethods && (
        <p role="alert" className="text-xs text-danger">
          {errors.allowedMfaMethods}
        </p>
      )}
    </fieldset>
  );
}

export function GuardrailModeControl() {
  const t = useTranslations(`${SECURITY_NS}.controls.waGuardrailsMode`);
  const { draft, setField, readOnly, errors } = usePolicyForm();
  const modes = ['off', 'monitor', 'enforce'] as const;
  return (
    <div className="space-y-3">
      <Field
        label={<ControlLabel name="waGuardrailsMode">{t('label')}</ControlLabel>}
        htmlFor={fieldId('waGuardrailsMode')}
        error={errors.waGuardrailsMode}
        className="max-w-xs"
      >
        <Select
          id={fieldId('waGuardrailsMode')}
          value={draft.waGuardrailsMode}
          onChange={(e) =>
            setField('waGuardrailsMode', e.target.value as SecurityPolicy['waGuardrailsMode'])
          }
          disabled={readOnly}
          invalid={Boolean(errors.waGuardrailsMode)}
        >
          {modes.map((m) => (
            <option key={m} value={m}>
              {t(`options.${m}`)}
            </option>
          ))}
        </Select>
      </Field>
      <ul className="space-y-1.5 text-sm">
        {modes.map((m) => (
          <li
            key={m}
            className={cn(
              'rounded-md border px-3 py-2',
              draft.waGuardrailsMode === m
                ? 'border-primary/50 bg-primary/5'
                : 'border-border text-muted-foreground',
            )}
          >
            <span className="font-medium text-foreground">{t(`options.${m}`)}</span>
            <span className="block text-xs">{t(`explain.${m}`)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AlertChannelControl() {
  const t = useTranslations(`${SECURITY_NS}.controls.alertChannel`);
  const { draft, setField, readOnly, errors } = usePolicyForm();
  const options = ['email', 'whatsapp', 'both'] as const;
  return (
    <fieldset className="min-w-0 space-y-2">
      <legend className="mb-1 text-sm font-medium">
        <ControlLabel name="alertChannel">{t('label')}</ControlLabel>
      </legend>
      <div className="space-y-2">
        {options.map((o, i) => (
          <label
            key={o}
            className="flex cursor-pointer items-center gap-3 rounded-md border border-border px-3 py-2.5 text-sm has-[:checked]:border-primary/50 has-[:checked]:bg-primary/5"
          >
            <input
              id={i === 0 ? fieldId('alertChannel') : undefined}
              type="radio"
              name="alertChannel"
              value={o}
              checked={draft.alertChannel === o}
              onChange={() => setField('alertChannel', o)}
              disabled={readOnly}
              className="size-4 accent-[var(--primary)]"
            />
            <span className="font-medium">{t(`options.${o}`)}</span>
          </label>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{t('hint')}</p>
      {errors.alertChannel && (
        <p role="alert" className="text-xs text-danger">
          {errors.alertChannel}
        </p>
      )}
    </fieldset>
  );
}

export function KeywordListControl() {
  const t = useTranslations(`${SECURITY_NS}.controls.abuseBlockKeywordList`);
  const { draft, setField, readOnly, errors } = usePolicyForm();
  return (
    <Field
      label={<ControlLabel name="abuseBlockKeywordList">{t('label')}</ControlLabel>}
      htmlFor={fieldId('abuseBlockKeywordList')}
      hint={t('hint')}
      error={errors.abuseBlockKeywordList}
    >
      <Textarea
        id={fieldId('abuseBlockKeywordList')}
        rows={6}
        value={draft.abuseBlockKeywordList}
        onChange={(e) => setField('abuseBlockKeywordList', e.target.value)}
        placeholder={t('placeholder')}
        readOnly={readOnly}
        invalid={Boolean(errors.abuseBlockKeywordList)}
        spellCheck={false}
        dir="auto"
        className="resize-y font-mono"
      />
    </Field>
  );
}
