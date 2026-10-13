'use client';

import { useTranslations } from 'next-intl';
import { composerErrorKey } from '../lib/composer-errors';

/** The line above the composer when an email send was refused (a rate limit says when to try again) or the body is too long. */
export function EmailSendProblem({
  problem,
  bodyTooLong,
}: {
  problem: { code: string; retryAfterS?: number } | null;
  bodyTooLong: boolean;
}) {
  const t = useTranslations('email.composer.error');
  if (!bodyTooLong && !problem) return null;
  const key = problem ? composerErrorKey(problem.code) : null;
  return (
    <p role="alert" data-testid="email-send-problem" className="mx-3 mt-2 text-xs text-danger">
      {bodyTooLong
        ? t('bodyTooLong')
        : key
          ? t(key, { seconds: problem?.retryAfterS ?? 0 })
          : t('generic')}
    </p>
  );
}

/** Under the box: switch between rich and plain text, and why Send waits while files upload. */
export function EmailComposerFooter({
  rich,
  onToggle,
  uploading,
  failed,
}: {
  rich: boolean;
  onToggle: () => void;
  uploading: boolean;
  failed: boolean;
}) {
  const t = useTranslations('email.composer');
  return (
    <div className="mx-3 mt-2 flex flex-wrap items-center gap-2 text-xs">
      <button
        type="button"
        data-testid="email-rich-toggle"
        aria-pressed={rich}
        onClick={onToggle}
        className="rounded text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-primary"
      >
        {rich ? t('editor.toPlain') : t('editor.toRich')}
      </button>
      {(uploading || failed) && (
        <span role="status" data-testid="email-send-blocked" className="text-muted-foreground">
          {uploading ? t('attach.waiting') : t('attach.fixFailed')}
        </span>
      )}
    </div>
  );
}

/** The keyboard hint of the rich-text box. */
export function EmailEditorHint() {
  const t = useTranslations('email.composer.editor');
  return <>{t('hint')}</>;
}
