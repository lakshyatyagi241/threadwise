'use client';

import { useTranslations } from 'next-intl';
import type { StoreGatewayDriver, StoreGatewayTestResult } from '@crm/contracts';
import { Alert, Button } from '@crm/ui';
import { testOutcome } from '../lib/gateway-form';

/**
 * The answer of "Test connection", said honestly. Only a `verified` result means the provider accepted the keys; a gateway with no
 * cheap check call passes at the `fields` level, which only proves the required fields are filled in, and the screen says that.
 */
export function GatewayTestResult({
  result,
  driver,
  onDismiss,
}: {
  result: StoreGatewayTestResult;
  driver: StoreGatewayDriver | undefined;
  onDismiss: () => void;
}) {
  const t = useTranslations('checkout-orders-merchant-payments.gateways.test');
  const common = useTranslations('checkout-orders-merchant-payments.common');
  const outcome = testOutcome(result, driver);

  const tone =
    outcome.kind === 'verified' ? 'success' : outcome.kind === 'fieldsOnly' ? 'info' : 'danger';
  return (
    <Alert
      tone={tone}
      className="space-y-1.5"
      data-testid="gateway-test-result"
      data-outcome={outcome.kind}
    >
      {outcome.kind === 'verified' && <p className="font-medium">{t('verified')}</p>}
      {outcome.kind === 'fieldsOnly' && (
        <>
          <p className="font-medium">{t('fieldsTitle')}</p>
          <p>{t('fieldsOnly')}</p>
        </>
      )}
      {outcome.kind === 'missing' && (
        <>
          <p className="font-medium">{t('missingTitle')}</p>
          <p>{t('missing', { fields: outcome.fields.join(', ') })}</p>
        </>
      )}
      {outcome.kind === 'rejected' && (
        <>
          <p className="font-medium">{t('rejected')}</p>
          {outcome.detail && (
            <p className="break-words text-xs">{t('providerSaid', { message: outcome.detail })}</p>
          )}
        </>
      )}
      <Button variant="ghost" size="sm" onClick={onDismiss} className="-ms-2">
        {common('dismiss')}
      </Button>
    </Alert>
  );
}
