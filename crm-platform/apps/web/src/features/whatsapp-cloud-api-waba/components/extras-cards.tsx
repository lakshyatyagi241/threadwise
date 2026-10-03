'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import type { WabaConversations, WabaHealth } from '@crm/contracts';
import { Alert, Badge, Button, Card, Field, Input, Spinner, StatTile } from '@crm/ui';
import {
  useClaimUsername,
  useCreateQrCode,
  useDeleteQrCode,
  useInboundCheck,
  useWebhookConfig,
  useQrCodes,
  useReleaseUsername,
  useSyncHistory,
  useUsername,
} from '../api/hooks';
import { useErrorText } from './use-error-text';

type Flash = { tone: 'success' | 'danger'; text: string } | null;

/** WD-WABA-023: this month's free service conversations. Drawn only when Meta's analytics answered. */
export function FreeConversationsTile({ conversations }: { conversations: WabaConversations }) {
  const t = useTranslations('whatsapp-cloud-api-waba.extras');
  const format = useFormatter();
  return (
    <StatTile
      label={t('freeTitle')}
      value={
        <span data-testid="waba-free-left">
          {format.number(conversations.freeLeft)}{' '}
          <span className="text-sm font-normal text-muted-foreground">
            / {format.number(conversations.freeTotal)}
          </span>
        </span>
      }
      hint={
        conversations.paid > 0
          ? t('freeHintPaid', { used: conversations.freeUsed, paid: conversations.paid })
          : t('freeHint', { used: conversations.freeUsed })
      }
    />
  );
}

/** WD-WABA-024: whether the number shows the verified badge, and the four things Meta looks at. Informational only. */
export function VerifiedBadgeCard({ health }: { health: WabaHealth }) {
  const t = useTranslations('whatsapp-cloud-api-waba.extras');
  const c = health.connection;
  const d = health.details;
  const checks: Array<[string, boolean | null]> = [
    ['checkBusiness', d.waba?.businessVerificationStatus?.toLowerCase() === 'verified'],
    ['checkName', c.nameStatus?.toUpperCase() === 'APPROVED'],
    ['checkQuality', c.qualityRating ? c.qualityRating.toUpperCase() !== 'RED' : null],
    ['checkPin', d.phone.isPinEnabled],
  ];
  const active = d.phone.isOfficialBusinessAccount === true;
  return (
    <Card className="p-4">
      <h3 className="mb-2 flex items-center gap-2 font-semibold">
        {t('verifiedTitle')}
        <Badge tone={active ? 'success' : 'neutral'}>
          {active ? t('verifiedActive') : t('verifiedNot')}
        </Badge>
      </h3>
      <ul className="space-y-1 text-sm">
        {checks.map(([key, ok]) => (
          <li key={key} className="flex items-center gap-2">
            <span aria-hidden className={ok ? 'text-success' : 'text-muted-foreground'}>
              {ok ? '✓' : '○'}
            </span>
            <span className={ok ? '' : 'text-muted-foreground'}>{t(key)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted-foreground">{t('verifiedHint')}</p>
    </Card>
  );
}

/** WD-WABA-025: claim and release the number's public @handle. Suggestions come from the server. */
export function UsernameCard({ id }: { id: string }) {
  const t = useTranslations('whatsapp-cloud-api-waba.extras');
  const errorText = useErrorText();
  const q = useUsername(id);
  const claim = useClaimUsername(id);
  const release = useReleaseUsername(id);
  const [handle, setHandle] = useState('');
  const [msg, setMsg] = useState<Flash>(null);
  const fail = (e: unknown) => setMsg({ tone: 'danger', text: errorText(e).text });
  const confirmClaim = (name: string) => {
    if (!window.confirm(t('usernameConfirm', { name }))) return;
    setMsg(null);
    claim.mutate(name.trim().toLowerCase(), { onSuccess: () => setHandle(''), onError: fail });
  };
  return (
    <Card className="p-4">
      <h3 className="mb-1 font-semibold">{t('usernameTitle')}</h3>
      <p className="mb-3 text-xs text-muted-foreground">{t('usernameHint')}</p>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {q.isPending ? (
        <Spinner label={t('loading')} />
      ) : q.isError ? (
        <Alert tone="warning">{errorText(q.error).text}</Alert>
      ) : q.data.username ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm" data-testid="waba-username">
              @{q.data.username}
            </span>
            <Badge tone={q.data.status === 'approved' ? 'success' : 'warning'}>
              {q.data.status === 'approved' ? t('usernameApproved') : t('usernameReserved')}
            </Badge>
          </div>
          <Button
            variant="secondary"
            disabled={release.isPending}
            onClick={() => {
              if (window.confirm(t('usernameReleaseConfirm')))
                release.mutate(undefined, { onError: fail });
            }}
          >
            {t('usernameRelease')}
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              confirmClaim(handle);
            }}
          >
            <Field label={t('usernameLabel')} className="flex-1">
              <div className="flex items-center gap-1">
                <span className="text-muted-foreground">@</span>
                <Input
                  value={handle}
                  maxLength={24}
                  onChange={(e) => setHandle(e.target.value.toLowerCase())}
                  placeholder={t('usernamePlaceholder')}
                />
              </div>
            </Field>
            <Button type="submit" disabled={claim.isPending || handle.trim().length < 3}>
              {t('usernameClaim')}
            </Button>
          </form>
          {q.data.suggestions.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {q.data.suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="rounded-full border px-3 py-1 text-xs hover:bg-muted"
                  onClick={() => confirmClaim(s)}
                >
                  @{s}
                </button>
              ))}
            </div>
          )}
          <p className="text-xs text-muted-foreground">{t('usernameRules')}</p>
        </div>
      )}
    </Card>
  );
}

/** WD-WABA-027: click-to-chat QR codes with a prefilled message (up to 140 characters). */
export function QrCodesCard({ id }: { id: string }) {
  const t = useTranslations('whatsapp-cloud-api-waba.extras');
  const errorText = useErrorText();
  const q = useQrCodes(id);
  const create = useCreateQrCode(id);
  const remove = useDeleteQrCode(id);
  const [text, setText] = useState('');
  const [msg, setMsg] = useState<Flash>(null);
  const fail = (e: unknown) => setMsg({ tone: 'danger', text: errorText(e).text });
  return (
    <Card className="p-4">
      <h3 className="mb-1 font-semibold">{t('qrTitle')}</h3>
      <p className="mb-3 text-xs text-muted-foreground">{t('qrHint')}</p>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <form
        className="mb-3 flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setMsg(null);
          create.mutate(text.trim(), {
            onSuccess: () => {
              setText('');
              setMsg({ tone: 'success', text: t('qrCreated') });
            },
            onError: fail,
          });
        }}
      >
        <Field label={t('qrMessage')} className="flex-1">
          <Input
            value={text}
            maxLength={140}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('qrPlaceholder')}
          />
        </Field>
        <Button type="submit" disabled={create.isPending || text.trim().length === 0}>
          {t('qrCreate')}
        </Button>
      </form>
      {q.isPending ? (
        <Spinner label={t('loading')} />
      ) : q.isError ? (
        <Alert tone="warning">{errorText(q.error).text}</Alert>
      ) : q.data.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('qrNone')}</p>
      ) : (
        <ul className="space-y-3">
          {q.data.items.map((code) => (
            <li key={code.code} className="flex items-center gap-3 text-sm">
              {code.qrImageUrl && (
                <img src={code.qrImageUrl} alt={t('qrAlt')} className="h-16 w-16 rounded border" />
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate">{code.prefilledMessage}</div>
                {code.deepLinkUrl && (
                  <a
                    href={code.deepLinkUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs underline"
                  >
                    {code.deepLinkUrl}
                  </a>
                )}
              </div>
              <Button
                variant="secondary"
                disabled={remove.isPending && remove.variables === code.code}
                onClick={() => {
                  if (window.confirm(t('qrDeleteConfirm')))
                    remove.mutate(code.code, { onError: fail });
                }}
              >
                {t('qrDelete')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** WD-WABA-028: the manual fallback that asks Meta to push the coexistence history again. Shown for coexistence numbers only. */
export function SyncHistoryCard({ id }: { id: string }) {
  const t = useTranslations('whatsapp-cloud-api-waba.extras');
  const errorText = useErrorText();
  const sync = useSyncHistory();
  const [msg, setMsg] = useState<Flash>(null);
  return (
    <Card className="p-4">
      <h3 className="mb-1 font-semibold">{t('syncTitle')}</h3>
      <p className="mb-3 text-xs text-muted-foreground">{t('syncHint')}</p>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <Button
        variant="secondary"
        disabled={sync.isPending}
        onClick={() => {
          if (!window.confirm(t('syncConfirm'))) return;
          setMsg(null);
          sync.mutate(id, {
            onSuccess: (r) =>
              setMsg({
                tone: 'success',
                text:
                  r.importedMessages > 0
                    ? t('syncDoneCount', { count: r.importedMessages })
                    : t('syncDone'),
              }),
            onError: (e) => setMsg({ tone: 'danger', text: errorText(e).text }),
          });
        }}
      >
        {t('syncButton')}
      </Button>
    </Card>
  );
}

const VERDICT_TONE = {
  delivering_here: 'success',
  subscribed_default: 'warning',
  wrong_url: 'danger',
  not_subscribed: 'danger',
} as const;

/**
 * WD-WABA-015: asks Meta where this number's webhooks are delivered right now and says what to do. While inbound is not confirmed
 * it also lists the callback URL and verify token to paste into a customer's own Meta app.
 */
export function InboundCheckCard({
  id,
  inboundWired,
}: {
  id: string;
  inboundWired: boolean | null;
}) {
  const t = useTranslations('whatsapp-cloud-api-waba.extras');
  const errorText = useErrorText();
  const check = useInboundCheck();
  const config = useWebhookConfig(inboundWired !== true);
  const [error, setError] = useState<string | null>(null);
  return (
    <Card className="p-4">
      <h3 className="mb-1 font-semibold">{t('inboundTitle')}</h3>
      <p className="mb-3 text-xs text-muted-foreground">{t('inboundHint')}</p>
      <Button
        variant="secondary"
        disabled={check.isPending}
        onClick={() => {
          setError(null);
          check.mutate(id, { onError: (e) => setError(errorText(e).text) });
        }}
      >
        {check.isPending ? t('inboundChecking') : t('inboundCheck')}
      </Button>
      {error && (
        <div className="mt-3">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}
      {check.data && (
        <div className="mt-3 space-y-2">
          <Alert tone={VERDICT_TONE[check.data.verdict]}>
            <span data-testid="waba-inbound-verdict">{t(`verdict_${check.data.verdict}`)}</span>
          </Alert>
          {check.data.apps.length > 0 && (
            <ul className="text-xs text-muted-foreground">
              {check.data.apps.map((a, i) => (
                <li key={i}>
                  {a.name ?? t('inboundApp')}
                  {a.callbackUrl ? ` → ${a.callbackUrl}` : ` (${t('inboundDefaultCallback')})`}
                </li>
              ))}
            </ul>
          )}
          {check.data.notes.includes('no_secret') && <Alert tone="warning">{t('noSecret')}</Alert>}
          <p className="text-xs text-muted-foreground">{t('inboundConfirm')}</p>
        </div>
      )}
      {inboundWired !== true && config.data && (
        <div className="mt-4 space-y-2 border-t pt-3">
          <h4 className="text-sm font-medium">{t('ownAppTitle')}</h4>
          <p className="text-xs text-muted-foreground">{t('ownAppHint')}</p>
          <dl className="space-y-2 text-xs">
            <div>
              <dt className="text-muted-foreground">{t('ownAppUrl')}</dt>
              <dd className="break-all font-mono" dir="ltr">
                {config.data.webhookUrl ?? '—'}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t('ownAppToken')}</dt>
              <dd className="break-all font-mono" dir="ltr">
                {config.data.verifyToken}
              </dd>
            </div>
          </dl>
        </div>
      )}
    </Card>
  );
}
