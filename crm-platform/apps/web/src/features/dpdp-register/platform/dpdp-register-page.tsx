'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@crm/ui';
import { useOperator } from '@/features/auth-registration-security/platform/operator-context';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';
import { PageHeader } from '@/features/auth-registration-security/platform/ui/page-header';
import { ErrorBlock, LoadingBlock } from '@/features/auth-registration-security/platform/ui/state';
import { REGISTER_KEY, registerSchema } from './queries';
import { RegisterList } from './register-list';
import { SummaryStrip } from './summary-strip';

const NS = 'dpdp-register-admin';

/**
 * The platform operator's DPDP register: which obligations of the DPDP Act and Rules the platform follows today, with the evidence
 * for each. Every operator role reads it; only a super admin sees the Attest action. The API enforces both.
 */
export function DpdpRegisterPage() {
  const t = useTranslations(NS);
  const format = useFormatter();
  const { operator } = useOperator();
  const q = useQuery({
    queryKey: REGISTER_KEY,
    queryFn: ({ signal }) => operatorFetch('/dpdp-register', { schema: registerSchema, signal }),
    // The live checks read configuration at request time, so the page offers a Refresh instead of reloading on every focus.
    refetchOnWindowFocus: false,
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        eyebrow={t('page.eyebrow')}
        title={t('page.title')}
        description={t('page.disclaimer')}
        actions={
          q.data && (
            <>
              <span className="text-xs text-muted-foreground">
                {t('page.checkedAt', {
                  time: format.dateTime(new Date(q.data.generatedAt), {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  }),
                })}
              </span>
              <Button
                variant="secondary"
                size="sm"
                aria-busy={q.isFetching}
                onClick={() => void q.refetch({ cancelRefetch: false })}
              >
                {t('page.refresh')}
              </Button>
            </>
          )
        }
      />
      {q.isPending ? (
        <LoadingBlock />
      ) : q.isError && !q.data ? (
        <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />
      ) : q.data ? (
        <>
          {q.isError && <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />}
          <SummaryStrip register={q.data} />
          <RegisterList register={q.data} role={operator.role} />
        </>
      ) : null}
    </div>
  );
}
