'use client';

import { useId } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Button, Field, Input } from '@crm/ui';
import {
  BUTTON_LIMITS,
  BUTTON_TEXT_MAX,
  addableKinds,
  buttonIssues,
  canAdd,
  moveRow,
  newRow,
  ADDABLE_KINDS,
  type AddableKind,
  type ButtonRow,
} from '../lib/buttons';
import { countPlaceholders } from '../lib/variables';
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, TrashIcon } from './icons';

/**
 * WD-TPL-010: the buttons editor with Meta's limits (10 in all; 10 quick replies, 2 URLs, 1 phone, 1 copy code), shown as
 * the limits are reached rather than only on submit. Quick replies must sit together at the start or the end.
 */
export function ButtonsEditor({
  rows,
  onChange,
}: {
  rows: ButtonRow[];
  onChange: (rows: ButtonRow[]) => void;
}) {
  const t = useTranslations('message-templates.form.buttons');
  const base = useId();
  const issues = buttonIssues(rows);
  const patch = (key: string, p: Partial<ButtonRow>) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, ...p } : r)));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {ADDABLE_KINDS.map((k: AddableKind) => (
          <Button
            key={k}
            size="sm"
            variant="secondary"
            disabled={!canAdd(rows, k)}
            onClick={() => onChange([...rows, newRow(k)])}
            title={canAdd(rows, k) ? undefined : t('limitReached', { max: BUTTON_LIMITS[k] })}
          >
            <PlusIcon className="size-3.5" />
            {t(`add.${k}`)}
          </Button>
        ))}
        <span className="ms-auto text-xs text-muted-foreground" aria-live="polite">
          {t('count', { used: rows.length, max: BUTTON_LIMITS.total })}
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <ol className="space-y-3">
          {rows.map((r, i) => {
            const mine = issues.filter((x) => x.rowKey === r.key);
            const err = (code: string) => mine.find((x) => x.code === code);
            const id = `${base}-${r.key}`;
            return (
              <li key={r.key} className="rounded-md border border-border p-3" data-testid="button-row">
                <div className="mb-2 flex items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t(`kind.${r.kind}`)}
                  </span>
                  <span className="ms-auto flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={t('moveUp', { n: i + 1 })}
                      disabled={i === 0}
                      onClick={() => onChange(moveRow(rows, i, i - 1))}
                    >
                      <ArrowUpIcon className="size-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={t('moveDown', { n: i + 1 })}
                      disabled={i === rows.length - 1}
                      onClick={() => onChange(moveRow(rows, i, i + 1))}
                    >
                      <ArrowDownIcon className="size-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-danger"
                      aria-label={t('remove', { n: i + 1 })}
                      onClick={() => onChange(rows.filter((x) => x.key !== r.key))}
                    >
                      <TrashIcon className="size-3.5" />
                    </Button>
                  </span>
                </div>
                {r.kind === 'other' ? (
                  <p className="text-sm text-muted-foreground">{t('keptAsIs', { text: r.text })}</p>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {r.kind !== 'copy_code' && (
                      <Field
                        label={t('text')}
                        htmlFor={`${id}-text`}
                        hint={t('textHint', { used: r.text.length, max: BUTTON_TEXT_MAX })}
                        error={
                          err('textRequired')
                            ? t('issue.textRequired')
                            : err('textTooLong')
                              ? t('issue.textTooLong', { max: BUTTON_TEXT_MAX })
                              : err('quickReplyVariable')
                                ? t('issue.quickReplyVariable')
                                : undefined
                        }
                      >
                        <Input
                          id={`${id}-text`}
                          value={r.text}
                          maxLength={BUTTON_TEXT_MAX + 10}
                          invalid={Boolean(err('textRequired') || err('textTooLong'))}
                          onChange={(e) => patch(r.key, { text: e.target.value })}
                        />
                      </Field>
                    )}
                    {r.kind === 'url' && (
                      <Field
                        label={t('url')}
                        htmlFor={`${id}-url`}
                        hint={t('urlHint')}
                        error={
                          err('urlRequired')
                            ? t('issue.urlRequired')
                            : err('urlInvalid')
                              ? t('issue.urlInvalid')
                              : undefined
                        }
                      >
                        <Input
                          id={`${id}-url`}
                          type="url"
                          inputMode="url"
                          dir="ltr"
                          placeholder="https://example.com/{{1}}"
                          value={r.url}
                          invalid={Boolean(err('urlRequired') || err('urlInvalid'))}
                          onChange={(e) => patch(r.key, { url: e.target.value })}
                        />
                      </Field>
                    )}
                    {r.kind === 'url' && countPlaceholders(r.url) > 0 && (
                      <Field
                        label={t('urlExample')}
                        htmlFor={`${id}-ex`}
                        error={err('urlExampleRequired') ? t('issue.urlExampleRequired') : undefined}
                      >
                        <Input
                          id={`${id}-ex`}
                          dir="ltr"
                          value={r.example}
                          onChange={(e) => patch(r.key, { example: e.target.value })}
                        />
                      </Field>
                    )}
                    {r.kind === 'phone' && (
                      <Field
                        label={t('phone')}
                        htmlFor={`${id}-phone`}
                        hint={t('phoneHint')}
                        error={err('phoneRequired') ? t('issue.phoneRequired') : undefined}
                      >
                        <Input
                          id={`${id}-phone`}
                          type="tel"
                          inputMode="tel"
                          dir="ltr"
                          placeholder="+15551234567"
                          value={r.phone}
                          invalid={Boolean(err('phoneRequired'))}
                          onChange={(e) => patch(r.key, { phone: e.target.value })}
                        />
                      </Field>
                    )}
                    {r.kind === 'copy_code' && (
                      <Field
                        label={t('code')}
                        htmlFor={`${id}-code`}
                        hint={t('codeHint')}
                        error={err('codeRequired') ? t('issue.codeRequired') : undefined}
                      >
                        <Input
                          id={`${id}-code`}
                          dir="ltr"
                          placeholder="PROMO50"
                          value={r.example}
                          invalid={Boolean(err('codeRequired'))}
                          onChange={(e) => patch(r.key, { example: e.target.value })}
                        />
                      </Field>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {issues.some((x) => x.code === 'quickReplyPosition') && (
        <Alert tone="warning">{t('issue.quickReplyPosition')}</Alert>
      )}
      <p className="text-xs text-muted-foreground">
        {t('limits', {
          quick: BUTTON_LIMITS.quick_reply,
          url: BUTTON_LIMITS.url,
          phone: BUTTON_LIMITS.phone,
          copy: BUTTON_LIMITS.copy_code,
        })}
        {addableKinds(rows).length === 0 && ` ${t('allUsed')}`}
      </p>
    </div>
  );
}
