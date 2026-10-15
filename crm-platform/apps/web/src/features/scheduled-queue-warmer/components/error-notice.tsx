'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { PLAN_UPGRADE_PATH } from '@crm/contracts';
import { Alert } from '@crm/ui';
import type { ErrorText } from './use-error-text';

/** A failed call as a message; a plan or limit refusal gets the upgrade pointer, a permission refusal says so. */
export function ErrorNotice({ error }: { error: ErrorText }) {
  const t = useTranslations('scheduled-queue-warmer.errors');
  return (
    <Alert tone="danger">
      <div>{error.text}</div>
      {error.plan && (
        <Link href={PLAN_UPGRADE_PATH} className="mt-1 inline-block font-semibold underline">
          {t('upgrade')}
        </Link>
      )}
    </Alert>
  );
}
