'use client';

import { useTranslations } from 'next-intl';
import { Alert } from '@crm/ui';
import { hubError } from '../lib/errors';

/** A failed action in the operator's language, chosen by the error `code`, with the request id for support. */
export function HubErrorLine({ error }: { error: unknown }) {
  const t = useTranslations('workspaces-hub.errors');
  const info = hubError(error);
  return (
    <Alert tone="danger" className="space-y-1" role="alert">
      <p>{t(info.key)}</p>
    </Alert>
  );
}
