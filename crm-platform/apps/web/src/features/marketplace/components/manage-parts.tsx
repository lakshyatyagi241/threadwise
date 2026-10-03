'use client';

import { useTranslations } from 'next-intl';
import { Alert, Button } from '@crm/ui';
import { isRowVersionConflict, mktError } from '../lib/errors';
import { ErrorLine } from './ui';

/**
 * What a failed action on an installation says. A stale row version (409) or a permission list that moved on is "reload and look
 * again", never a retry of the same call. A missing permission key is named. Everything else is the plain error line.
 */
export function ProblemNotice({ error, onReload }: { error: unknown; onReload: () => void }) {
  const t = useTranslations('marketplace.manage.problem');
  if (!error) return null;
  const view = mktError(error);
  if (isRowVersionConflict(error) || view.kind === 'conflict') {
    return (
      <Alert tone="warning" data-testid="conflict">
        <p className="font-medium">{t('conflictTitle')}</p>
        <p>{t('conflictMessage')}</p>
        <Button variant="secondary" size="sm" className="mt-2" onClick={onReload}>
          {t('reload')}
        </Button>
      </Alert>
    );
  }
  if (view.kind === 'consentRequired' || view.kind === 'reconsentRequired') {
    return (
      <Alert tone="warning" data-testid="consent-moved">
        <p className="font-medium">{t('consentTitle')}</p>
        <p>{t('consentMessage')}</p>
        <Button variant="secondary" size="sm" className="mt-2" onClick={onReload}>
          {t('reload')}
        </Button>
      </Alert>
    );
  }
  return (
    <div className="space-y-2">
      <ErrorLine error={error} />
      {view.kind === 'scopeExceeds' && view.missingPermissions.length > 0 && (
        <ul className="list-disc space-y-0.5 ps-5 font-mono text-xs" dir="ltr">
          {view.missingPermissions.map((k) => (
            <li key={k}>{k}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
