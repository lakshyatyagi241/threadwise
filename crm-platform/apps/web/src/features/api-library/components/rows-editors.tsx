'use client';

import { useTranslations } from 'next-intl';
import { API_LIBRARY_MAX_HEADERS, apiLibraryIsSensitiveName } from '@crm/contracts';
import { Alert, Badge, Button, Checkbox, Input } from '@crm/ui';
import {
  emptyField,
  emptyHeader,
  isMasked,
  type FieldRow,
  type FormErrors,
  type HeaderRow,
} from '../lib/form-model';
import { VariableField } from './variable-field';

const removeAt = <T,>(rows: T[], i: number): T[] => rows.filter((_, j) => j !== i);

/**
 * Header rows: name, value (variables allowed) and a secret toggle. A secret reads as ******** once saved; leaving the mask in place
 * keeps the stored value, typing anything else replaces it.
 */
export function HeadersEditor({
  rows,
  onChange,
  errors,
  disabled,
}: {
  rows: HeaderRow[];
  onChange: (rows: HeaderRow[]) => void;
  errors: FormErrors;
  disabled?: boolean;
}) {
  const t = useTranslations('api-library.form.headers');
  const patch = (i: number, p: Partial<HeaderRow>) =>
    onChange(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));

  return (
    <div className="space-y-3">
      {rows.length === 0 && <p className="text-sm text-muted-foreground">{t('none')}</p>}
      {rows.map((r, i) => {
        const sensitive = apiLibraryIsSensitiveName(r.key);
        const secret = r.secret || sensitive;
        const masked = isMasked(r.value);
        const err = errors.fields[`header:${r.id}`];
        return (
          <div key={r.id} className="space-y-1.5 rounded-md border border-border p-3">
            <div className="grid gap-2 sm:grid-cols-[1fr_2fr_auto]">
              <Input
                value={r.key}
                aria-label={t('keyN', { n: i + 1 })}
                placeholder={t('keyPlaceholder')}
                maxLength={128}
                disabled={disabled}
                invalid={err !== undefined}
                dir="ltr"
                onChange={(e) => patch(i, { key: e.target.value })}
              />
              {masked && secret ? (
                <div className="flex items-center gap-2">
                  <Input
                    value={r.value}
                    readOnly
                    aria-label={t('valueN', { n: i + 1 })}
                    dir="ltr"
                    className="font-mono"
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={disabled}
                    onClick={() => patch(i, { value: '' })}
                  >
                    {t('replace')}
                  </Button>
                </div>
              ) : (
                <VariableField
                  value={r.value}
                  label={t('valueN', { n: i + 1 })}
                  placeholder={t('valuePlaceholder')}
                  disabled={disabled}
                  invalid={err !== undefined}
                  chips={false}
                  onChange={(v) => patch(i, { value: v })}
                />
              )}
              <Button
                variant="ghost"
                size="sm"
                disabled={disabled}
                aria-label={t('removeN', { n: i + 1 })}
                onClick={() => onChange(removeAt(rows, i))}
              >
                ×
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Checkbox
                id={`alib-hs-${r.id}`}
                label={t('secret')}
                checked={secret}
                disabled={disabled || sensitive}
                onChange={(e) => patch(i, { secret: e.target.checked })}
              />
              {sensitive && <Badge>{t('alwaysSecret')}</Badge>}
              {masked && secret && (
                <span className="text-xs text-muted-foreground">{t('kept')}</span>
              )}
            </div>
            {err && (
              <p role="alert" className="text-xs text-danger">
                {err}
              </p>
            )}
          </div>
        );
      })}
      <Button
        variant="secondary"
        size="sm"
        disabled={disabled || rows.length >= API_LIBRARY_MAX_HEADERS}
        onClick={() => onChange([...rows, emptyHeader()])}
      >
        {t('add')}
      </Button>
    </div>
  );
}

/** A secret kept as the mask stays with its address: say so before the save fails. */
export function SecretAddressWarning() {
  const t = useTranslations('api-library.form.headers');
  return <Alert tone="warning">{t('addressChanged')}</Alert>;
}

/** The text fields of a multipart/form-data payload. */
export function FieldRowsEditor({
  rows,
  onChange,
  disabled,
}: {
  rows: FieldRow[];
  onChange: (rows: FieldRow[]) => void;
  disabled?: boolean;
}) {
  const t = useTranslations('api-library.form.formData');
  const patch = (i: number, p: Partial<FieldRow>) =>
    onChange(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  return (
    <div className="space-y-3">
      {rows.length === 0 && <p className="text-sm text-muted-foreground">{t('none')}</p>}
      {rows.map((r, i) => (
        <div key={r.id} className="grid gap-2 sm:grid-cols-[1fr_2fr_auto]">
          <Input
            value={r.key}
            aria-label={t('keyN', { n: i + 1 })}
            placeholder={t('keyPlaceholder')}
            disabled={disabled}
            dir="ltr"
            onChange={(e) => patch(i, { key: e.target.value })}
          />
          <VariableField
            value={r.value}
            label={t('valueN', { n: i + 1 })}
            placeholder={t('valuePlaceholder')}
            disabled={disabled}
            chips={false}
            onChange={(v) => patch(i, { value: v })}
          />
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled}
            aria-label={t('removeN', { n: i + 1 })}
            onClick={() => onChange(removeAt(rows, i))}
          >
            ×
          </Button>
        </div>
      ))}
      <Button
        variant="secondary"
        size="sm"
        disabled={disabled}
        onClick={() => onChange([...rows, emptyField()])}
      >
        {t('add')}
      </Button>
    </div>
  );
}
