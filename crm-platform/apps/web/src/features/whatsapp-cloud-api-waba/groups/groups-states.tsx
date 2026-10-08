'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Button, Card } from '@crm/ui';
import type { WabaGroupsState } from '@crm/contracts';
import { useRecheckGroupsState } from '../api/groups-hooks';
import { useErrorText } from '../components/use-error-text';

/** WaDesk: "No WhatsApp Business number connected" with a hint to connect one. */
export function NoNumberState() {
  const t = useTranslations('whatsapp-cloud-api-waba.groups.state.noNumber');
  return (
    <Card className="p-6 text-center" data-testid="groups-state-noNumber">
      <p className="text-xl font-semibold">{t('title')}</p>
      <p className="mt-2 text-sm text-muted-foreground">{t('message')}</p>
      <p className="mt-3 text-xs text-muted-foreground">{t('hint')}</p>
      <Link href="/channels/whatsapp" className="mt-3 inline-block text-sm underline">
        {t('connect')}
      </Link>
    </Card>
  );
}

/**
 * "Not eligible" is a normal view, not an error (WaDesk): nothing on the page can work, so it says why plainly instead of drawing
 * controls that will fail. "Check again" asks Meta once more, bypassing the hour's cache.
 */
export function BlockedState({
  kind,
  number,
}: {
  kind: 'notEligible' | 'providerUnsupported' | 'missingCredentials';
  number: string;
}) {
  const t = useTranslations(`whatsapp-cloud-api-waba.groups.state.${kind}`);
  const recheck = useRecheckGroupsState(number);
  const errorText = useErrorText();
  return (
    <Card className="p-6" data-testid={`groups-state-${kind}`}>
      <p className="text-xl font-semibold">{t('title')}</p>
      <p className="mt-2 max-w-xl text-sm text-muted-foreground">{t('message')}</p>
      <p className="mt-3 text-xs text-muted-foreground">{t('hint')}</p>
      {kind === 'notEligible' && (
        <div className="mt-4 flex items-center gap-3">
          <Button
            variant="secondary"
            size="sm"
            disabled={recheck.isPending}
            onClick={() => recheck.mutate()}
          >
            {recheck.isPending ? t('checking') : t('reload')}
          </Button>
          {recheck.isError && (
            <span className="text-xs text-danger">{errorText(recheck.error).text}</span>
          )}
        </div>
      )}
    </Card>
  );
}

/** Meta could not be asked right now: the controls stay, with a line saying so. */
export function CheckFailedNote({ state }: { state: WabaGroupsState }) {
  const t = useTranslations('whatsapp-cloud-api-waba.groups.state');
  if (state.reason !== 'check_failed') return null;
  return (
    <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
      {t('checkFailed')}
    </p>
  );
}
