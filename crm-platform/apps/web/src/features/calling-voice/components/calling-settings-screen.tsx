'use client';

import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Alert, Badge, Button, EmptyState, Spinner, useToast } from '@crm/ui';
import type { CallingNumber } from '@crm/contracts';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { useCallingNumbers, useToggleCalling } from '../api/calling';
import { useErrorText } from './use-error-text';
import { PhoneIcon } from './icons';
import { RecordingSettingsPanel } from './recording-settings-panel';

/**
 * `/calling` (TW-CALL-003, 004): the workspace's WhatsApp numbers with their calling switch. Turning it on or off asks Meta,
 * which can take a few seconds; the numbers change only after Meta accepts, and when it refuses the reason is shown in full.
 */
export function CallingSettingsScreen() {
  const t = useTranslations('calling-voice.settings');
  const errorText = useErrorText();
  const canManage = useCan('call.calling.manage');
  const numbers = useCallingNumbers();
  const rows = numbers.data?.rows ?? [];

  return (
    <main className="mx-auto max-w-3xl px-4 py-7 sm:px-6">
      <h1 className="text-3xl font-normal tracking-tight">{t('title')}</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t('intro')}</p>
      {!canManage && (
        <Alert className="mt-4" tone="info">
          {t('viewOnly')}
        </Alert>
      )}

      <div className="mt-6 space-y-3">
        {numbers.isPending && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner label={t('loading')} /> {t('loading')}
          </div>
        )}
        {numbers.isError && (
          <Alert tone="danger" className="flex flex-wrap items-center justify-between gap-3">
            <span>
              {t('loadFailed')} {errorText(numbers.error)}
            </span>
            <Button size="sm" variant="secondary" onClick={() => void numbers.refetch()}>
              {t('retry')}
            </Button>
          </Alert>
        )}
        {numbers.isSuccess && rows.length === 0 && (
          <EmptyState title={t('emptyTitle')} message={t('emptyMessage')} />
        )}
        {rows.map((n) => (
          <NumberCard key={n.id} number={n} canManage={canManage} />
        ))}
      </div>

      <RecordingSettingsPanel />
    </main>
  );
}

function NumberCard({ number: n, canManage }: { number: CallingNumber; canManage: boolean }) {
  const t = useTranslations('calling-voice.settings');
  const format = useFormatter();
  const { toast } = useToast();
  const errorText = useErrorText();
  const toggle = useToggleCalling();
  const [refusal, setRefusal] = useState<string | null>(null);
  const on = n.callingEnabled;

  const flip = () => {
    setRefusal(null);
    toggle.mutate(
      { id: n.id, enable: !on },
      {
        onSuccess: () => toast(on ? t('disabledDone') : t('enabledDone'), 'success'),
        // Meta's reasons are long and worded for a person: shown in full, and kept until the next attempt.
        onError: (e) => setRefusal(errorText(e)),
      },
    );
  };

  return (
    <section className="rounded-xl border border-border bg-background p-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={`grid size-9 shrink-0 place-items-center rounded-full ${on ? 'bg-success/15 text-success' : 'bg-muted text-muted-foreground'}`}
          >
            <PhoneIcon className="size-4" />
          </span>
          <div className="min-w-0">
            <div className="truncate text-lg leading-tight">{t('cardTitle')}</div>
            <div className="truncate text-sm font-medium">
              {n.displayLabel || n.phoneNumber || t('numberFallback')}
              {n.displayLabel && n.phoneNumber ? ` · ${n.phoneNumber}` : ''}
            </div>
            <div className={`text-xs ${on ? 'text-success' : 'text-muted-foreground'}`}>
              {on ? t('enabledStatus') : t('offStatus')}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge>{t('connection', { status: n.connectionStatus })}</Badge>
              {on && n.callingEnabledAt && (
                <span>
                  {t('enabledSince', {
                    date: format.dateTime(new Date(n.callingEnabledAt), { dateStyle: 'medium' }),
                  })}
                </span>
              )}
            </div>
          </div>
        </div>
        {canManage && (
          <Button
            variant={on ? 'secondary' : 'brand'}
            className="rounded-full"
            disabled={toggle.isPending}
            aria-busy={toggle.isPending}
            onClick={flip}
          >
            {toggle.isPending && <Spinner label={t('asking')} />}
            {toggle.isPending ? t('asking') : on ? t('disable') : t('enable')}
          </Button>
        )}
      </div>
      {refusal && (
        <Alert tone="danger" className="mt-3 whitespace-pre-line">
          {refusal}
        </Alert>
      )}
    </section>
  );
}

/**
 * The calling card of one number on the WhatsApp health page (TW-WABA-024): the same switch as `/calling`, for the number the page is
 * about. Nothing is drawn while the list loads or when the number is not in it (calling is not available to this workspace); a
 * refusal to load is shown, so a plan without calling says so instead of hiding the card.
 */
export function CallingToggleCard({ numberId }: { numberId: string }) {
  const t = useTranslations('calling-voice.settings');
  const errorText = useErrorText();
  const canManage = useCan('call.calling.manage');
  const numbers = useCallingNumbers();
  if (numbers.isError) {
    return (
      <Alert tone="info" data-testid="calling-toggle-unavailable">
        {t('loadFailed')} {errorText(numbers.error)}
      </Alert>
    );
  }
  const n = numbers.data?.rows.find((r) => r.id === numberId);
  return n ? <NumberCard number={n} canManage={canManage} /> : null;
}
