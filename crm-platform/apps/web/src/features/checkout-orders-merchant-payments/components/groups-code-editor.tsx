'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { StoreGroup } from '@crm/contracts';
import { Button, Input, Spinner, useToast } from '@crm/ui';
import { useSetGroupCode } from '../api/hooks';
import { errorKind } from '../lib/errors';
import {
  GROUP_CODE_MAX,
  isGroupCodeDirty,
  orderingLink,
  validateGroupCode,
} from '../lib/group-code';
import { useErrorLine } from './parts';

/** Copy text to the clipboard; false when the browser refuses (no permission, insecure page). */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** A button that copies a text and says "Copied" for a moment. */
export function CopyButton({
  text,
  label,
  className,
}: {
  text: string;
  label: string;
  className?: string;
}) {
  const t = useTranslations('checkout-orders-merchant-payments.common');
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <button
      type="button"
      onClick={() => {
        void copyText(text).then((ok) => {
          if (!ok) return;
          setDone(true);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setDone(false), 1500);
        });
      }}
      className={
        className ??
        'inline-flex items-center gap-1 rounded text-xs font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary'
      }
    >
      <svg
        viewBox="0 0 16 16"
        className="size-3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        aria-hidden="true"
      >
        <path d="M5 5V3.5A1.5 1.5 0 0 1 6.5 2h6A1.5 1.5 0 0 1 14 3.5v6A1.5 1.5 0 0 1 12.5 11H11" />
        <rect x="2" y="5" width="9" height="9" rx="1.5" />
      </svg>
      <span aria-live="polite">{done ? t('copied') : label}</span>
    </button>
  );
}

/**
 * The ordering code of one group: an input with Save and Clear (Reference's inline form), then the "Copy ordering link" line when the
 * group has a code and a bot number exists. Without the manage right the code is plain text. The parent keys this by row version, so
 * a saved or refreshed row starts from what the server holds.
 */
export function GroupCodeEditor({
  group,
  botNumber,
  canManage,
  onStale,
}: {
  group: StoreGroup;
  botNumber: string | null;
  canManage: boolean;
  /** The row changed under the person (row version conflict): reload the list. */
  onStale: () => void;
}) {
  const t = useTranslations('checkout-orders-merchant-payments.groups');
  const tc = useTranslations('checkout-orders-merchant-payments.common');
  const { toast } = useToast();
  const errorLine = useErrorLine();
  const save = useSetGroupCode();
  const [draft, setDraft] = useState(group.groupCode ?? '');
  const [problem, setProblem] = useState<string | null>(null);
  const link = orderingLink(botNumber, group.groupCode);
  const name = group.subject?.trim() || t('row.unnamed');

  function submit(next: string) {
    const check = validateGroupCode(next);
    if (!check.ok) {
      setProblem(
        check.problem === 'tooLong' ? t('row.tooLong', { max: GROUP_CODE_MAX }) : t('row.badChars'),
      );
      return;
    }
    setProblem(null);
    save.mutate(
      { id: group.id, body: { groupCode: check.value, rowVersion: group.rowVersion } },
      {
        onSuccess: () => toast(check.value === null ? t('row.cleared') : t('row.saved'), 'success'),
        onError: (e) => {
          const kind = errorKind(e);
          if (kind === 'groupCodeTaken') setProblem(t('row.taken'));
          else {
            setProblem(errorLine(e));
            if (kind === 'conflict') onStale();
          }
        },
      },
    );
  }

  if (!canManage) {
    return (
      <div className="space-y-1">
        {group.groupCode ? (
          <span className="font-mono text-xs">{group.groupCode}</span>
        ) : (
          <span className="text-xs text-muted-foreground">{t('row.noCode')}</span>
        )}
        {link && (
          <div>
            <CopyButton text={link} label={t('row.copyLink')} />
          </div>
        )}
      </div>
    );
  }

  const dirty = isGroupCodeDirty(draft, group.groupCode);
  const errorId = `group-code-error-${group.id}`;
  return (
    <div className="space-y-1.5">
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          submit(draft);
        }}
        className="flex flex-wrap items-center gap-1.5"
      >
        <Input
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setProblem(null);
          }}
          placeholder={t('row.placeholder')}
          maxLength={GROUP_CODE_MAX + 8}
          aria-label={t('row.label', { name })}
          aria-describedby={problem ? errorId : undefined}
          invalid={problem !== null}
          autoComplete="off"
          spellCheck={false}
          dir="ltr"
          className="h-9 w-32 font-mono text-xs"
        />
        <Button type="submit" size="sm" variant="secondary" disabled={!dirty || save.isPending}>
          {save.isPending && <Spinner />}
          {tc('save')}
        </Button>
        {group.groupCode && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={save.isPending}
            onClick={() => {
              setDraft('');
              submit('');
            }}
          >
            {tc('clear')}
          </Button>
        )}
      </form>
      {problem && (
        <p id={errorId} role="alert" className="text-xs text-danger">
          {problem}
        </p>
      )}
      {link && <CopyButton text={link} label={t('row.copyLink')} />}
    </div>
  );
}
