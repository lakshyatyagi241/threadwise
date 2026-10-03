'use client';

import { useId, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Button, Input } from '@crm/ui';
import {
  PLACEHOLDERS,
  bearerPreview,
  missingTokenPlaceholder,
  previewHeaders,
  validateHeaderRows,
  type HeaderIssue,
  type HeaderRow,
  type PreviewValues,
} from '../lib/header-templates';
import type { AuthScheme, CredentialMode } from '../api/schemas';

/**
 * The custom-headers editor: one row per header, placeholders checked as you type, and a preview of what one call would send with
 * every secret masked. With the Bearer scheme there is nothing to edit; the preview shows the one header the platform sends.
 */
export function HeaderTemplatesEditor({
  rows,
  onChange,
  authScheme,
  credentialMode,
  previewValues,
  disabled,
}: {
  rows: HeaderRow[];
  onChange: (rows: HeaderRow[]) => void;
  authScheme: AuthScheme;
  credentialMode: CredentialMode;
  previewValues?: PreviewValues;
  disabled?: boolean;
}) {
  const t = useTranslations('whatsapp-providers.headers');
  const base = useId();
  const [focused, setFocused] = useState(0);
  const issues = useMemo(() => validateHeaderRows(rows), [rows]);
  const preview = useMemo(
    () => (authScheme === 'bearer' ? bearerPreview() : previewHeaders(rows, previewValues)),
    [authScheme, rows, previewValues],
  );
  const needsToken = missingTokenPlaceholder(rows, authScheme, credentialMode);

  const issueAt = (row: number, field: 'name' | 'value'): HeaderIssue | undefined =>
    issues.find((i) => i.row === row && i.field === field);
  const message = (i: HeaderIssue | undefined): string | undefined =>
    i ? t(`issues.${i.code}`, { detail: i.detail ?? '' }) : undefined;

  const set = (i: number, patch: Partial<HeaderRow>) =>
    onChange(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const insert = (placeholder: string) => {
    const token = `{{${placeholder}}}`;
    if (rows.length === 0) return onChange([{ name: '', value: token }]);
    const at = Math.min(focused, rows.length - 1);
    set(at, { value: `${rows[at]?.value ?? ''}${token}` });
  };

  if (authScheme === 'bearer') {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">{t('bearerExplain')}</p>
        <HeaderPreview preview={preview} title={t('preview')} note={t('previewNote')} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('explain')}</p>
      <div className="space-y-2" role="group" aria-label={t('rows')}>
        {rows.length === 0 && <p className="text-sm text-muted-foreground">{t('empty')}</p>}
        {rows.map((row, i) => {
          const nameIssue = issueAt(i, 'name');
          const valueIssue = issueAt(i, 'value');
          return (
            <div key={i} className="grid gap-2 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto]">
              <div className="space-y-1">
                <Input
                  id={`${base}-n${i}`}
                  aria-label={t('name', { n: i + 1 })}
                  placeholder={t('namePlaceholder')}
                  value={row.name}
                  invalid={!!nameIssue}
                  disabled={disabled}
                  autoComplete="off"
                  spellCheck={false}
                  className="font-mono text-xs"
                  onFocus={() => setFocused(i)}
                  onChange={(e) => set(i, { name: e.target.value })}
                />
                {nameIssue && (
                  <p role="alert" className="text-xs text-danger">
                    {message(nameIssue)}
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <Input
                  id={`${base}-v${i}`}
                  aria-label={t('value', { n: i + 1 })}
                  placeholder={t('valuePlaceholder')}
                  value={row.value}
                  invalid={!!valueIssue}
                  disabled={disabled}
                  autoComplete="off"
                  spellCheck={false}
                  className="font-mono text-xs"
                  onFocus={() => setFocused(i)}
                  onChange={(e) => set(i, { value: e.target.value })}
                />
                {valueIssue && (
                  <p role="alert" className="text-xs text-danger">
                    {message(valueIssue)}
                  </p>
                )}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled}
                aria-label={t('remove', { n: i + 1 })}
                onClick={() => onChange(rows.filter((_, k) => k !== i))}
              >
                {t('removeShort')}
              </Button>
            </div>
          );
        })}
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={disabled}
          onClick={() => {
            onChange([...rows, { name: '', value: '' }]);
            setFocused(rows.length);
          }}
        >
          {t('add')}
        </Button>
      </div>

      <div className="space-y-1.5">
        <p className="text-sm font-medium">{t('placeholdersTitle')}</p>
        <ul className="flex flex-wrap gap-2">
          {PLACEHOLDERS.map((p) => (
            <li key={p}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => insert(p)}
                title={t(`placeholders.${p}`)}
                className="rounded-md border border-border px-2 py-1 font-mono text-xs hover:bg-muted disabled:opacity-50"
              >
                {`{{${p}}}`}
              </button>
            </li>
          ))}
        </ul>
        <dl className="space-y-0.5 text-xs text-muted-foreground">
          {PLACEHOLDERS.map((p) => (
            <div key={p} className="flex flex-wrap gap-x-1">
              <dt className="font-mono">{`{{${p}}}`}</dt>
              <dd>{t(`placeholders.${p}`)}</dd>
            </div>
          ))}
        </dl>
      </div>

      {needsToken && <Alert tone="warning">{t('needsToken')}</Alert>}
      <HeaderPreview preview={preview} title={t('preview')} note={t('previewNote')} />
    </div>
  );
}

function HeaderPreview({
  preview,
  title,
  note,
}: {
  preview: Array<{ name: string; value: string }>;
  title: string;
  note: string;
}) {
  return (
    <div className="space-y-1.5" data-testid="header-preview">
      <p className="text-sm font-medium">{title}</p>
      <pre
        dir="ltr"
        className="overflow-x-auto rounded-md border border-border bg-muted/50 p-3 text-xs"
      >
        {preview.length === 0 ? '—' : preview.map((h) => `${h.name}: ${h.value}`).join('\n')}
      </pre>
      <p className="text-xs text-muted-foreground">{note}</p>
    </div>
  );
}
