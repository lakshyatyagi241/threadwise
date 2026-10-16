'use client';

import { useTranslations } from 'next-intl';
import type { MailConnectionTestResponse, MailTestSide } from '@crm/contracts';
import { Alert } from '@crm/ui';
import { sideView } from '../lib/test-view';

/**
 * The outcome of "Test credentials" (IMAP/SMTP): one line for each server, so a person sees at once which of the two is wrong and why.
 * The wording is ours and translated from the reason code; the server's own sentence is never shown (it may be English).
 */
export function ConnectionTestResult({ result }: { result: MailConnectionTestResponse }) {
  const t = useTranslations('email.imap.test');
  const line = (label: string, side: MailTestSide, okText: string) => {
    const view = sideView(side);
    return (
      <li data-testid={`email-test-${label}`} data-ok={view.ok} className="flex gap-2">
        <span className="font-medium">{t(label === 'imap' ? 'imap' : 'smtp')}</span>
        <span>{view.ok ? okText : t(`reasons.${view.reason}`)}</span>
      </li>
    );
  };
  return (
    <Alert tone={result.ok ? 'success' : 'danger'} data-testid="email-test-result">
      <ul className="space-y-1 text-xs">
        {line(
          'imap',
          result.imap,
          result.imap.inboxMessages === null
            ? t('ok')
            : t('inbox', { count: result.imap.inboxMessages }),
        )}
        {line('smtp', result.smtp, t('smtpOk'))}
      </ul>
      {result.ok && <p className="mt-2 text-xs">{t('note')}</p>}
    </Alert>
  );
}
