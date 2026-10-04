'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Textarea } from '@crm/ui';
import { formatJsonText, problemPath, type DocName, type DocProblem } from '../lib/json-docs';

const NS = 'marketplace.operator.editor';

/** The text of one problem: ours are translated, the contract's and the server's are shown as they came. */
export function useProblemText(): (p: DocProblem) => string {
  const t = useTranslations(`${NS}.problems`);
  return (p) => {
    if (p.code === 'syntax') {
      return p.line !== undefined
        ? t('syntaxAt', { line: p.line, column: p.column ?? 1 })
        : t('syntax');
    }
    if (p.code) return t(p.code, p.values);
    return p.message ?? '';
  };
}

/** `path: message` for each problem, errors first. A document with no problems renders nothing. */
export function ProblemList({ problems, id }: { problems: readonly DocProblem[]; id?: string }) {
  const text = useProblemText();
  const t = useTranslations(`${NS}.problems`);
  if (problems.length === 0) return null;
  const sorted = [...problems].sort(
    (a, b) => Number(b.severity === 'error') - Number(a.severity === 'error'),
  );
  return (
    <ul id={id} className="space-y-1 text-xs" aria-label={t('listLabel')}>
      {sorted.map((p, i) => (
        <li
          key={`${p.doc}-${p.path}-${i}`}
          className={p.severity === 'error' ? 'text-danger' : 'text-warning'}
        >
          <span className="sr-only">
            {p.severity === 'error' ? t('errorLabel') : t('warningLabel')}{' '}
          </span>
          <code className="font-mono" dir="ltr">
            {problemPath(p)}
          </code>
          : <span dir="auto">{text(p)}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * A JSON text editor for one of the two documents: monospace, left-to-right in every language, no spell check, scrolling inside its
 * own box. The problems of its document are listed under it and tied to the box (aria-describedby, aria-invalid).
 */
export function JsonEditor({
  id,
  doc,
  label,
  hint,
  value,
  onChange,
  problems,
  valid,
  rows = 16,
  disabled,
  actions,
}: {
  id: string;
  doc: DocName;
  label: ReactNode;
  hint?: ReactNode;
  value: string;
  onChange: (next: string) => void;
  /** The problems of every document; this editor shows its own. */
  problems: readonly DocProblem[];
  /** The text follows its schema (shown as a quiet confirmation). Pass false while the check is behind the typing. */
  valid?: boolean;
  rows?: number;
  disabled?: boolean;
  /** Buttons beside Format: starters and the like. */
  actions?: ReactNode;
}) {
  const t = useTranslations(NS);
  const mine = problems.filter((p) => p.doc === doc);
  const errors = mine.filter((p) => p.severity === 'error').length;
  const formatted = formatJsonText(value);
  const hintId = `${id}-hint`;
  const problemsId = `${id}-problems`;
  return (
    <div className="space-y-2 text-sm">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <label htmlFor={id} className="block font-medium">
          {label}
        </label>
        <div className="flex flex-wrap items-center gap-2">
          {actions}
          <Button
            variant="secondary"
            size="sm"
            disabled={disabled || formatted === null || formatted === value}
            onClick={() => formatted !== null && onChange(formatted)}
          >
            {t('format')}
          </Button>
        </div>
      </div>
      <Textarea
        id={id}
        dir="ltr"
        spellCheck={false}
        autoComplete="off"
        autoCapitalize="off"
        wrap="off"
        rows={rows}
        value={value}
        disabled={disabled}
        invalid={errors > 0}
        aria-describedby={`${hintId}${mine.length > 0 ? ` ${problemsId}` : ''}`}
        onChange={(e) => onChange(e.target.value)}
        className="resize-y overflow-auto whitespace-pre font-mono text-xs leading-5"
      />
      <p id={hintId} className="text-xs text-muted-foreground" aria-live="polite">
        {errors > 0
          ? t('problemCount', { count: errors })
          : valid
            ? t(`valid.${doc}`)
            : (hint ?? null)}
      </p>
      <ProblemList problems={mine} id={problemsId} />
    </div>
  );
}
