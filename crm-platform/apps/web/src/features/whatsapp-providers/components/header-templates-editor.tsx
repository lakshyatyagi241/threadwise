'use client';

import { useId } from 'react';
import { useTranslations } from 'next-intl';
import type { HeaderPlaceholder, WhatsappAuthScheme, WhatsappCredentialMode } from '@crm/contracts';
import { Alert, Button, Input, Select } from '@crm/ui';
import { previewUrl } from '../lib/base-url';
import {
  PLACEHOLDERS,
  insertPlaceholder,
  newRow,
  previewHeaders,
  unreachablePlaceholders,
  type HeaderProblem,
  type HeaderRow,
} from '../lib/header-templates';

const NS = 'whatsapp-providers.headers';

/**
 * The custom-header editor: one row per header (name and a value that may hold {{providerToken}} {{channelToken}} {{wabaId}}
 * {{phoneNumberId}}), the rules in plain words, and a live preview of the request with stand-in values. The preview never holds
 * a real secret.
 */
export function HeaderTemplatesEditor({
  rows,
  onChange,
  problems,
  credentialMode,
  disabled,
}: {
  rows: HeaderRow[];
  onChange: (rows: HeaderRow[]) => void;
  problems: readonly HeaderProblem[];
  credentialMode: WhatsappCredentialMode;
  disabled?: boolean;
}) {
  const t = useTranslations(NS);
  const tp = useTranslations(`${NS}.problems`);
  const tph = useTranslations(`${NS}.placeholders`);
  const base = useId();

  const patch = (id: string, p: Partial<HeaderRow>) =>
    onChange(rows.map((r) => (r.id === id ? { ...r, ...p } : r)));
  const remove = (id: string) => onChange(rows.filter((r) => r.id !== id));
  const rowProblems = (id: string) => problems.filter((p) => p.rowId === id);
  const setProblems = problems.filter((p) => !p.rowId);

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t('intro')}</p>

      <ul className="space-y-3" aria-label={t('listLabel')}>
        {rows.map((row, i) => {
          const mine = rowProblems(row.id);
          const nameId = `${base}-n-${row.id}`;
          const valueId = `${base}-v-${row.id}`;
          const insertId = `${base}-i-${row.id}`;
          return (
            <li key={row.id} className="space-y-1.5 rounded-md border border-border p-3">
              <div className="grid gap-2 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto]">
                <div className="space-y-1">
                  <label htmlFor={nameId} className="block text-xs font-medium">
                    {t('name')}
                  </label>
                  <Input
                    id={nameId}
                    value={row.name}
                    onChange={(e) => patch(row.id, { name: e.target.value })}
                    placeholder="x-api-key"
                    className="font-mono text-xs"
                    autoComplete="off"
                    spellCheck={false}
                    invalid={mine.length > 0}
                    disabled={disabled}
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor={valueId} className="block text-xs font-medium">
                    {t('value')}
                  </label>
                  <Input
                    id={valueId}
                    value={row.value}
                    onChange={(e) => patch(row.id, { value: e.target.value })}
                    placeholder="{{providerToken}}"
                    className="font-mono text-xs"
                    autoComplete="off"
                    spellCheck={false}
                    invalid={mine.length > 0}
                    disabled={disabled}
                  />
                </div>
                <div className="flex items-end gap-2">
                  <label htmlFor={insertId} className="sr-only">
                    {t('insertFor', { n: i + 1 })}
                  </label>
                  <Select
                    id={insertId}
                    className="w-40 text-xs"
                    value=""
                    disabled={disabled}
                    onChange={(e) => {
                      const p = e.target.value as HeaderPlaceholder;
                      if (p) patch(row.id, { value: insertPlaceholder(row.value, p) });
                    }}
                  >
                    <option value="">{t('insert')}</option>
                    {PLACEHOLDERS.map((p) => (
                      <option key={p} value={p}>
                        {`{{${p}}}`}
                      </option>
                    ))}
                  </Select>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={disabled}
                    onClick={() => remove(row.id)}
                    aria-label={t('removeFor', { n: i + 1 })}
                  >
                    {t('remove')}
                  </Button>
                </div>
              </div>
              {mine.map((p, j) => (
                <p key={`${p.code}-${j}`} role="alert" className="text-xs text-danger">
                  {tp(p.code, p.values)}
                </p>
              ))}
            </li>
          );
        })}
      </ul>

      <Button
        variant="secondary"
        size="sm"
        disabled={disabled}
        onClick={() => onChange([...rows, newRow()])}
      >
        {t('add')}
      </Button>

      {setProblems.map((p) => (
        <p key={p.code} role="alert" className="text-xs text-danger">
          {tp(p.code, p.values)}
        </p>
      ))}

      <details className="rounded-md border border-border p-3 text-sm">
        <summary className="cursor-pointer font-medium">{t('placeholdersTitle')}</summary>
        <dl className="mt-2 space-y-1.5">
          {PLACEHOLDERS.map((p) => (
            <div key={p} className="flex flex-wrap gap-x-2">
              <dt className="font-mono text-xs">{`{{${p}}}`}</dt>
              <dd className="text-xs text-muted-foreground">{tph(p)}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-2 text-xs text-muted-foreground">{t('leftOut')}</p>
      </details>
      {unreachablePlaceholders(rows, credentialMode).length > 0 && (
        <Alert tone="warning">{t('channelTokenNeverKnown')}</Alert>
      )}
    </div>
  );
}

/** The request a call would make, rendered with stand-in values: the URL and every header. */
export function RequestPreview({
  baseUrl,
  apiVersion,
  authScheme,
  rows,
  credentialMode,
}: {
  baseUrl: string;
  apiVersion: string;
  authScheme: WhatsappAuthScheme;
  rows: HeaderRow[];
  credentialMode: WhatsappCredentialMode;
}) {
  const t = useTranslations(`${NS}.preview`);
  const url = previewUrl(baseUrl, apiVersion);
  const headers = previewHeaders(authScheme, rows, credentialMode);
  return (
    <div className="space-y-2" aria-live="polite">
      <h3 className="text-sm font-medium">{t('title')}</h3>
      <pre
        dir="ltr"
        className="overflow-x-auto rounded-md border border-border bg-muted p-3 text-start font-mono text-xs leading-relaxed"
        data-testid="request-preview"
      >
        {`GET ${url ?? t('urlPending')}`}
        {headers.map((h) => `\n${h.name}: ${h.value}`).join('')}
      </pre>
      <p className="text-xs text-muted-foreground">{t('note')}</p>
    </div>
  );
}
