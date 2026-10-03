'use client';

import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { Card } from '@crm/ui';
import { PROVIDER_INFO_KEY, fetchProviderInfo } from '../api';

const NS = 'whatsapp-providers.workspaceNote';

/**
 * A small read-only note for workspace admins on the WhatsApp numbers screen: which provider carries WhatsApp for the workspace,
 * whose credential is used and whether a file upload is supported. It names the provider only (no address, header or secret
 * ever reaches the browser, `GET /v2/waba/provider-info`). Quiet while loading or when it cannot be read: the screen it sits on
 * works without it.
 */
export function WorkspaceProviderNote() {
  const t = useTranslations(NS);
  const q = useQuery({
    queryKey: PROVIDER_INFO_KEY,
    queryFn: ({ signal }) => fetchProviderInfo(signal),
    staleTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
  if (!q.data) return null;
  const { newNumbers, numbers } = q.data;
  const elsewhere = newNumbers
    ? numbers.filter((n) => n.providerKey !== newNumbers.providerKey)
    : numbers;

  return (
    <Card
      className="space-y-1.5 text-sm"
      aria-labelledby="provider-note-title"
      data-testid="provider-note"
    >
      <h2 id="provider-note-title" className="font-semibold">
        {t('title')}
      </h2>
      {newNumbers ? (
        <>
          <p>{t('newNumbers', { provider: newNumbers.providerLabel })}</p>
          <p className="text-xs text-muted-foreground">
            {newNumbers.credentialMode === 'channel_token' ? t('ownToken') : t('platformToken')}{' '}
            {newNumbers.capabilities.mediaUpload ? t('mediaYes') : t('mediaNo')}
          </p>
        </>
      ) : (
        <p>{t('none')}</p>
      )}
      {elsewhere.length > 0 && (
        <ul className="list-disc ps-5 text-xs text-muted-foreground">
          {elsewhere.map((n) => (
            <li key={n.id}>
              {t('numberOn', {
                name: n.label ?? n.phoneNumber ?? '',
                provider: n.providerLabel,
              })}
              {!n.capabilities.mediaUpload ? ` ${t('numberNoMedia')}` : ''}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
