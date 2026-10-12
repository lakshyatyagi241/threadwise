'use client';

import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { smsPlatformStateSchema } from '@crm/contracts';
import { Alert, Button, Spinner } from '@crm/ui';
import { useOperator } from '@/features/auth-registration-security/platform/operator-context';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';
import { errorKind } from '@/features/node-bridge-runtime/lib/errors';
import { SMS_PLATFORM_QUERY_KEY } from './queries';
import { SmsPlatformCard } from './sms-platform-card';

const NS = 'sms.operator';

/** The operator console's SMS page: the one platform switch. Every operator reads it, a super admin changes it. */
export function SmsPlatformPage() {
  const t = useTranslations(NS);
  const { operator } = useOperator();
  const canEdit = operator.role === 'super_admin';
  const q = useQuery({
    queryKey: SMS_PLATFORM_QUERY_KEY,
    queryFn: ({ signal }) => operatorFetch('/sms', { schema: smsPlatformStateSchema, signal }),
    refetchOnWindowFocus: false,
  });

  if (q.isPending) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
        <Spinner /> {t('loading')}
      </div>
    );
  }
  if (q.isError) {
    return (
      <Alert tone="danger" role="alert">
        <p>{t(`errors.${errorKind(q.error)}`)}</p>
        <Button variant="secondary" size="sm" className="mt-2" onClick={() => void q.refetch()}>
          {t('retry')}
        </Button>
      </Alert>
    );
  }
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {!canEdit && <Alert tone="info">{t('superOnly')}</Alert>}
      <SmsPlatformCard enabled={q.data.enabled} canEdit={canEdit} />
    </div>
  );
}
