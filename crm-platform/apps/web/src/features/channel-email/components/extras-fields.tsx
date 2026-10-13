'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { buildExtras, type ExtrasDraft } from '../lib/composer-extras';

/**
 * The email-only fields above the message box (TW-MAIL-022, 027): Cc, Bcc and a subject that replaces `Re: <subject>`. Folded away
 * until asked for, so a plain reply looks like any other channel's. A problem is shown once the agent has tried to send.
 */
export function EmailExtrasFields({
  value,
  onChange,
  defaultSubject,
  showProblems,
  disabled,
}: {
  value: ExtrasDraft;
  onChange: (next: ExtrasDraft) => void;
  defaultSubject: string;
  showProblems: boolean;
  disabled?: boolean;
}) {
  const t = useTranslations('email.composer');
  const id = useId();
  const used = value.cc !== '' || value.bcc !== '' || value.subject !== '';
  const [open, setOpen] = useState(used);
  const { problems, invalid } = buildExtras(value);
  const shown = open || used;

  const input =
    'h-8 w-full rounded-md border border-border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60';
  const err = (field: 'cc' | 'bcc' | 'subject') => {
    const p = showProblems ? problems[field] : undefined;
    if (!p) return null;
    const list = field === 'subject' ? [] : invalid[field];
    return (
      <p role="alert" className="mt-0.5 text-[11px] text-danger">
        {t(`problem.${p}`, { list: list.join(', ') })}
      </p>
    );
  };

  return (
    <div data-testid="email-extras" className="px-3 pt-2 text-xs">
      {!shown ? (
        <button
          type="button"
          data-testid="email-extras-toggle"
          aria-expanded={false}
          onClick={() => setOpen(true)}
          className="rounded text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-primary"
        >
          {t('toggle')}
        </button>
      ) : (
        <div className="space-y-1.5">
          {(['cc', 'bcc'] as const).map((f) => (
            <div key={f}>
              <div className="flex items-center gap-2">
                <label htmlFor={`${id}-${f}`} className="w-10 shrink-0 text-muted-foreground">
                  {t(f)}
                </label>
                <input
                  id={`${id}-${f}`}
                  type="text"
                  dir="ltr"
                  inputMode="email"
                  autoComplete="off"
                  data-testid={`email-${f}`}
                  value={value[f]}
                  disabled={disabled}
                  placeholder={t('addressesPlaceholder')}
                  aria-invalid={showProblems && problems[f] !== undefined}
                  onChange={(e) => onChange({ ...value, [f]: e.target.value })}
                  className={input}
                />
              </div>
              {err(f)}
            </div>
          ))}
          <div>
            <div className="flex items-center gap-2">
              <label htmlFor={`${id}-subject`} className="w-10 shrink-0 text-muted-foreground">
                {t('subject')}
              </label>
              <input
                id={`${id}-subject`}
                type="text"
                dir="auto"
                data-testid="email-subject"
                value={value.subject}
                disabled={disabled}
                maxLength={998}
                placeholder={defaultSubject || t('subjectPlaceholder')}
                onChange={(e) => onChange({ ...value, subject: e.target.value })}
                className={input}
              />
            </div>
            {err('subject')}
          </div>
        </div>
      )}
    </div>
  );
}
