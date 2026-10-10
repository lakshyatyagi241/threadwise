'use client';

import type { PasskeyItem } from '@crm/contracts';
import { useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Spinner } from '@crm/ui';
import { PasswordConfirmModal } from '../../account/security/password-confirm-modal';
import { ErrorNote } from '../error-note';
import { KeyIcon } from '../icons';
import { formatRelative } from '../relative-time';
import { AddPasskeyModal } from './add-passkey-modal';
import type { PasskeyApi } from './passkey-api';
import { usePasskeySupport } from './passkey-browser';
import { classifyPasskeyError } from './passkey-failure';

type Phase = { kind: 'idle' } | { kind: 'add' } | { kind: 'remove'; passkey: PasskeyItem };

/**
 * Passkeys as a second factor, next to the authenticator app: the list (name, when it was added and last used,
 * where it lives), add and remove. Workspace staff and platform operators share it; the caller supplies the API
 * calls, the query key and where "turn on two-factor first" leads. Adding needs two-factor on and, for an old
 * session, the password; removing always asks for the password.
 */
export function PasskeysPanel({
  api,
  queryKey,
  mfaEnabled,
  twoFactorHref,
  onQueryError,
}: {
  api: PasskeyApi;
  queryKey: QueryKey;
  /** Whether two-factor is on; undefined while that is still being fetched. */
  mfaEnabled?: boolean;
  twoFactorHref: string;
  /** Lets the host screen react to a failed load (staff accounts redirect on a gate refusal). */
  onQueryError?: (error: unknown) => void;
}) {
  const t = useTranslations('auth-registration-security.account.passkeys');
  const c = useTranslations('auth-registration-security.account.common');
  const locale = useLocale();
  const format = useFormatter();
  const queryClient = useQueryClient();
  const supported = usePasskeySupport();
  const query = useQuery({ queryKey, queryFn: api.list, staleTime: 0 });
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [notice, setNotice] = useState<string | null>(null);
  // The API said two-factor is off although this screen thought it was on (turned off in another tab).
  const [mfaOffAtApi, setMfaOffAtApi] = useState(false);

  const loadError = query.error;
  useEffect(() => {
    if (loadError) onQueryError?.(loadError);
  }, [loadError, onQueryError]);

  const passkeys = query.data?.data ?? [];
  const needsMfa = mfaEnabled === false || mfaOffAtApi;
  // Relative times are measured from when the list was fetched, so the render stays pure.
  const now = query.dataUpdatedAt;

  function refresh() {
    return queryClient.invalidateQueries({ queryKey });
  }

  return (
    <Card id="passkeys" className="scroll-mt-20 space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <KeyIcon className="mt-1 size-5 text-primary" />
          <div>
            <h2 className="text-lg font-semibold">{t('title')}</h2>
            <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
          </div>
        </div>
        {!needsMfa && (
          <Button
            variant="secondary"
            size="sm"
            disabled={!supported}
            onClick={() => {
              setNotice(null);
              setPhase({ kind: 'add' });
            }}
          >
            {t('add')}
          </Button>
        )}
      </div>

      {notice && <Alert tone="success">{notice}</Alert>}
      {!supported && <Alert tone="warning">{t('unsupported')}</Alert>}
      {needsMfa && (
        <Alert tone="info" className="space-y-1">
          <p>{t('needsMfa')}</p>
          <p>
            <a href={twoFactorHref} className="font-medium underline underline-offset-2">
              {t('needsMfaLink')}
            </a>
          </p>
        </Alert>
      )}

      {query.isPending && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner label={c('loading')} /> {c('loading')}
        </p>
      )}
      {query.isError && (
        <div className="space-y-3">
          <ErrorNote error={query.error} />
          <Button variant="secondary" onClick={() => void query.refetch()}>
            {c('retry')}
          </Button>
        </div>
      )}
      {query.isSuccess && passkeys.length === 0 && !needsMfa && (
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      )}

      {passkeys.length > 0 && (
        <ul
          aria-label={t('title')}
          className="divide-y divide-border overflow-hidden rounded-md border border-border"
        >
          {passkeys.map((passkey) => (
            <li
              key={passkey.id}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <span
                  aria-hidden="true"
                  className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
                >
                  <KeyIcon className="size-4" />
                </span>
                <div className="min-w-0">
                  <p className="truncate font-semibold">{passkey.name}</p>
                  <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    <span>
                      {t('added', {
                        date: format.dateTime(new Date(passkey.createdAt), { dateStyle: 'medium' }),
                      })}
                    </span>
                    <span>
                      {passkey.lastUsedAt
                        ? t('lastUsed', { when: formatRelative(passkey.lastUsedAt, now, locale) })
                        : t('neverUsed')}
                    </span>
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Badge>
                  {passkey.deviceType === 'multiDevice' ? t('synced') : t('deviceOnly')}
                </Badge>
                <button
                  type="button"
                  onClick={() => {
                    setNotice(null);
                    setPhase({ kind: 'remove', passkey });
                  }}
                  className="rounded text-xs font-semibold text-danger hover:underline focus-visible:ring-2 focus-visible:ring-primary"
                >
                  {t('remove')}
                  <span className="sr-only"> {passkey.name}</span>
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {phase.kind === 'add' && (
        <AddPasskeyModal
          api={api}
          onClose={() => setPhase({ kind: 'idle' })}
          onNeedsMfa={() => {
            setMfaOffAtApi(true);
            setPhase({ kind: 'idle' });
          }}
          onAdded={(item) => {
            setPhase({ kind: 'idle' });
            setNotice(t('addedDone', { name: item.name }));
            void refresh();
          }}
        />
      )}
      {phase.kind === 'remove' && (
        <PasswordConfirmModal
          title={t('removeTitle')}
          description={t('removeDescription', { name: phase.passkey.name })}
          confirmLabel={t('removeConfirm')}
          danger
          onClose={() => setPhase({ kind: 'idle' })}
          onConfirm={async (password) => {
            const { passkey } = phase;
            try {
              await api.remove(passkey.id, password);
            } catch (err) {
              // Already gone (removed on another device): the refreshed list tells the truth.
              if (classifyPasskeyError(err) !== 'notFound') throw err;
            }
            setPhase({ kind: 'idle' });
            setNotice(t('removedDone', { name: passkey.name }));
            await refresh();
          }}
        />
      )}
    </Card>
  );
}
