'use client';

import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import type { WabaHealth } from '@crm/contracts';
import { Alert, Badge, Button, Card, Field, PasswordInput, Spinner, StatTile } from '@crm/ui';
import { useHealth, useRenewToken, useResubscribe, useSetToken } from '../api/hooks';
import { metaManagerUrl, qualityTone, tierLabel } from '../lib/display';
import { BusinessProfileCard } from './business-profile-card';
import { InboundBadge } from './inbound-badge';
import { useErrorText } from './use-error-text';

const OVERALL = {
  ok: { tone: 'success', title: 'overallOk', hint: 'overallOkHint' },
  warning: { tone: 'warning', title: 'overallWarning', hint: 'overallWarningHint' },
  error: { tone: 'danger', title: 'overallError', hint: 'overallErrorHint' },
} as const;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-end">{children}</dd>
    </div>
  );
}

/** TW-WABA-021 / 022: live diagnostics for one number. Issues are derived by the server; this only draws them. */
export function HealthScreen({ id }: { id: string }) {
  const t = useTranslations('whatsapp-cloud-api-waba.health');
  const tn = useTranslations('whatsapp-cloud-api-waba.numbers');
  const none = useTranslations('whatsapp-cloud-api-waba.common')('unknown');
  const format = useFormatter();
  const errorText = useErrorText();
  const q = useHealth(id);
  const setToken = useSetToken();
  const renew = useRenewToken();
  const fixInbound = useResubscribe();
  const [token, setTokenValue] = useState('');
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  if (q.isPending)
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Spinner /> {t('loading')}
      </div>
    );
  if (q.isError)
    return (
      <div className="mx-auto max-w-3xl space-y-3 p-6">
        <Alert tone="danger">
          {errorText(q.error).text} <span className="opacity-70">{t('loadFailed')}</span>
        </Alert>
        <Link href="/channels/whatsapp" className="text-sm underline">
          {t('crumbDevices')}
        </Link>
      </div>
    );

  const h: WabaHealth = q.data;
  const c = h.connection;
  const d = h.details;
  const o = OVERALL[h.overall];
  const tier = tierLabel(c.messagingLimitTier);
  const quality = c.qualityRating?.toUpperCase() ?? null;
  const done = (text: string) => ({
    onSuccess: () => {
      setTokenValue('');
      setMsg({ tone: 'success', text });
    },
    onError: (e: unknown) => setMsg({ tone: 'danger', text: errorText(e).text }),
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <nav className="text-xs text-muted-foreground">
            <Link href="/channels/whatsapp" className="hover:underline">
              {t('crumbDevices')}
            </Link>{' '}
            / {t('crumb')} /{' '}
            {t('checked', { when: format.relativeTime(new Date(h.checkedAt), new Date()) })}
          </nav>
          <h1 className="text-2xl font-semibold">
            {c.verifiedName || c.displayLabel || c.phoneNumber || tn('title')}
          </h1>
          <p className="text-sm text-muted-foreground" dir="ltr">
            {c.phoneNumber ?? none}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => q.refetch()} disabled={q.isFetching}>
            {t('recheck')}
          </Button>
          {c.wabaId && (
            <a
              href={metaManagerUrl(c.wabaId)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-muted"
            >
              {t('openMeta')}
            </a>
          )}
        </div>
      </header>

      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}

      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile
          label={t('overall')}
          value={<span data-testid="waba-overall">{t(o.title)}</span>}
          hint={t(o.hint)}
          tone={h.overall === 'ok' ? 'default' : 'warning'}
        />
        <StatTile
          label={t('quality')}
          value={quality ? quality.charAt(0) + quality.slice(1).toLowerCase() : '—'}
          hint={t('qualityHint')}
        />
        <StatTile label={t('limit')} value={tier ?? '—'} hint={t('limitHint')} />
      </div>

      <section aria-labelledby="waba-issues">
        <h2 id="waba-issues" className="mb-2 text-lg font-semibold">
          {t('issues', { count: h.issues.length })}
        </h2>
        {h.issues.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noIssues')}</p>
        ) : (
          <ul className="space-y-2">
            {h.issues.map((i) => (
              <li key={i.key}>
                <Alert tone={i.severity === 'error' ? 'danger' : 'warning'}>
                  <div className="font-medium">{i.title}</div>
                  <div className="text-xs">{t('fix', { solution: i.solution })}</div>
                </Alert>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="p-4">
          <h3 className="mb-2 font-semibold">{t('phoneCard')}</h3>
          <dl className="divide-y divide-border">
            <Row label={t('verifiedName')}>{c.verifiedName ?? none}</Row>
            <Row label={t('connection')}>
              <Badge tone={c.status === 'connected' ? 'success' : 'danger'}>{c.status}</Badge>
            </Row>
            <Row label={t('quality')}>
              <Badge tone={qualityTone(quality)}>{quality ?? none}</Badge>
            </Row>
            <Row label={t('nameStatus')}>{c.nameStatus ?? none}</Row>
            <Row label={t('verification')}>{c.codeVerificationStatus ?? none}</Row>
            <Row label={t('platform')}>{c.platformType ?? none}</Row>
            <Row label={t('provider')}>
              {c.provider === 'interakt' ? t('providerInterakt') : t('providerMeta')}
            </Row>
          </dl>
        </Card>

        <Card className="p-4">
          <h3 className="mb-2 font-semibold">{t('accessCard')}</h3>
          <dl className="divide-y divide-border">
            <Row label={t('token')}>
              <span className="font-mono text-xs" dir="ltr">
                {h.tokenHint ?? t('tokenNone')}
              </span>
            </Row>
            <Row label={t('tokenExpires')}>
              {c.tokenExpiresAt
                ? format.dateTime(new Date(c.tokenExpiresAt), {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })
                : c.hasToken
                  ? t('tokenNever')
                  : none}
            </Row>
          </dl>
          <form
            className="mt-3 space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (token.trim())
                setToken.mutate({ id, accessToken: token.trim() }, done(t('tokenSaved')));
            }}
          >
            <Field label={t('replaceToken')} htmlFor="waba-new-token" hint={t('replaceTokenHint')}>
              <PasswordInput
                id="waba-new-token"
                autoComplete="new-password"
                value={token}
                onChange={(e) => setTokenValue(e.target.value)}
              />
            </Field>
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={setToken.isPending || !token.trim()}>
                {t('replaceSubmit')}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={renew.isPending || !c.hasToken}
                onClick={() => renew.mutate(id, done(t('tokenRenewed')))}
              >
                {t('renew')}
              </Button>
            </div>
          </form>
        </Card>

        <Card className="p-4">
          <h3 className="mb-2 font-semibold">{t('businessCard')}</h3>
          {d.waba ? (
            <dl className="divide-y divide-border">
              <Row label={t('wabaName')}>{d.waba.name ?? none}</Row>
              <Row label={t('accountReview')}>{d.waba.accountReviewStatus ?? none}</Row>
              <Row label={t('businessVerification')}>
                {d.waba.businessVerificationStatus?.replace(/_/g, ' ') ?? none}
              </Row>
              <Row label={t('ownerBusiness')}>{d.waba.ownerBusinessName ?? none}</Row>
              <Row label={t('currency')}>{d.waba.currency ?? none}</Row>
              <Row label={t('timezone')}>{d.waba.timezoneId ?? none}</Row>
              <Row label={t('ownership')}>{d.waba.ownershipType ?? none}</Row>
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">{t('notRead')}</p>
          )}
        </Card>

        <Card className="p-4">
          <h3 className="mb-2 font-semibold">{t('tokenCard')}</h3>
          <dl className="divide-y divide-border">
            <Row label={t('tokenValid')}>
              {d.token.valid === null ? t('tokenUnknown') : d.token.valid ? t('yes') : t('no')}
            </Row>
            <Row label={t('tokenApp')}>{d.token.appId ?? none}</Row>
            <Row label={t('tokenScopes')}>
              {d.token.scopes.length ? (
                <span className="flex flex-wrap justify-end gap-1">
                  {d.token.scopes
                    .filter((x) => x.startsWith('whatsapp'))
                    .map((x) => (
                      <Badge key={x} tone="neutral">
                        {x.replace('whatsapp_business_', '')}
                      </Badge>
                    ))}
                </span>
              ) : (
                t('noScopes')
              )}
            </Row>
          </dl>
        </Card>

        <Card className="p-4">
          <h3 className="mb-2 font-semibold">{t('templatesCard')}</h3>
          {d.templates ? (
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge tone="neutral">{t('templatesSampled', { count: d.templates.sampled })}</Badge>
              {Object.entries(d.templates.byStatus).map(([status, n]) => (
                <Badge
                  key={status}
                  tone={
                    status === 'APPROVED' ? 'success' : status === 'REJECTED' ? 'danger' : 'warning'
                  }
                >
                  {status.toLowerCase()} {n}
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t('notRead')}</p>
          )}
        </Card>

        <Card className="p-4">
          <h3 className="mb-2 font-semibold">{t('phoneMore')}</h3>
          <dl className="divide-y divide-border">
            <Row label={t('accountMode')}>{d.phone.accountMode ?? none}</Row>
            <Row label={t('officialBusiness')}>
              {d.phone.isOfficialBusinessAccount === null
                ? none
                : d.phone.isOfficialBusinessAccount
                  ? t('yes')
                  : t('no')}
            </Row>
            <Row label={t('twoStepPin')}>
              {d.phone.isPinEnabled === null ? none : d.phone.isPinEnabled ? t('yes') : t('no')}
            </Row>
          </dl>
        </Card>

        <BusinessProfileCard id={id} />

        <Card className="p-4 md:col-span-2">
          <h3 className="mb-2 font-semibold">{t('deliveryCard')}</h3>
          <dl className="grid gap-x-8 sm:grid-cols-2">
            <Row label={t('inbound')}>
              <span className="inline-flex items-center gap-2">
                <InboundBadge wired={c.inboundWired} />
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={fixInbound.isPending}
                  onClick={() =>
                    fixInbound.mutate(id, {
                      onSuccess: (r) =>
                        setMsg({
                          tone: 'success',
                          text:
                            r.warnings[0] ??
                            tn('notice.resubscribed', { name: c.verifiedName ?? '' }),
                        }),
                      onError: (e) => setMsg({ tone: 'danger', text: errorText(e).text }),
                    })
                  }
                >
                  {t('fixInbound')}
                </Button>
              </span>
            </Row>
            <Row label={t('subscribedApps')}>
              {d.webhook
                ? d.webhook.subscribedApps.length
                  ? d.webhook.subscribedApps.join(', ')
                  : t('noApps')
                : none}
            </Row>
            <Row label={t('phoneId')}>
              <span className="font-mono text-xs" dir="ltr">
                {c.phoneNumberId ?? none}
              </span>
            </Row>
            <Row label={t('wabaId')}>
              <span className="font-mono text-xs" dir="ltr">
                {c.wabaId ?? none}
              </span>
            </Row>
            <Row label={t('businessId')}>
              <span className="font-mono text-xs" dir="ltr">
                {c.businessId ?? none}
              </span>
            </Row>
          </dl>
        </Card>
      </div>
      {d.errors.length > 0 && (
        <section aria-labelledby="waba-read-errors">
          <h2 id="waba-read-errors" className="mb-2 text-lg font-semibold">
            {t('readErrors')}
          </h2>
          <ul className="list-disc space-y-1 ps-5 text-sm text-muted-foreground">
            {d.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
