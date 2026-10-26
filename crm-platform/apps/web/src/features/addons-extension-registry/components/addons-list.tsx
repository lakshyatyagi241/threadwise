'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { AddonCard, OwnedAddon, WorkspaceAddonsResponse } from '@crm/contracts';
import { Alert, Badge, Button, Spinner } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { KEYS, enableAddon, fetchWorkspaceAddons } from '../api';
import {
  AddonToggleDialog,
  activationErrorKey,
  useAfterActivationChange,
} from './addon-toggle-dialog';
import { CancelAddonRenewal } from './cancel-addon-renewal';
import { ErrorBlock, LoadingBlock } from './ui';

const NS = 'addons-extension-registry.list';
const KINDS = ['feature', 'capacity'] as const;

/** The message under the list after a switch: the add-on's name is in the sentence, so it reads on its own. */
type Status = { tone: 'success' | 'danger'; text: string } | null;

/**
 * THE add-ons list: one component and one card style for every place a workspace sees add-ons (the Plans page, `/addons` and the Marketplace
 * Add-ons tab). It owns its data (`GET /addons`), so a mount is one line. Visibility is decided by the API, not here:
 * every card is in exactly one state (`AddonCard.state`):
 *   included     the plan already grants everything the add-on gives: "Included in your plan", no buy button. A second chip says Active or
 *                Turned off; a plain add-on (`canToggle`) can be turned off (after a preview of what changes) and on again by a person who
 *                holds `addons.activation.manage`, everyone else sees the state and is told to ask the account owner
 *   active       held: renewal or end date; "Buy again" appears only for stackable limit boosts (state `buy_again`)
 *   buy          price per period and a button (disabled with a reason for a member who may not buy)
 *   unavailable  the workspace is not on an active paid plan: the reason and a link to the plans
 * It works for any workspace on an active paid plan whether or not the plan has the `marketplace` feature (the add-ons list is not
 * part of the paywalled Marketplace). The cards are grouped Feature add-ons / Capacity add-ons (`AddonCard.kind`); an empty group is left out.
 */
export function AddonsList() {
  const q = useQuery({
    queryKey: KEYS.workspace,
    queryFn: ({ signal }) => fetchWorkspaceAddons(signal),
    refetchOnWindowFocus: false,
  });
  if (q.isPending) return <LoadingBlock />;
  if (q.isError) return <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />;
  return <AddonsListView data={q.data} />;
}

/** The list for already-loaded data (what the screen tests render). */
export function AddonsListView({ data }: { data: WorkspaceAddonsResponse }) {
  const t = useTranslations(NS);
  const [status, setStatus] = useState<Status>(null);
  return (
    <div className="space-y-4" data-testid="addons-list">
      {/* Always in the page, so the sentence is announced when it appears. */}
      <div aria-live="polite" data-testid="addons-status">
        {status && <Alert tone={status.tone}>{status.text}</Alert>}
      </div>
      {!data.eligible && <UnavailableNotice reason={data.unavailableReason} />}
      {data.owned.length > 0 && <OwnedList owned={data.owned} />}
      {data.catalog.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-6 text-center">
          <p className="text-sm font-medium">{t('empty.title')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t('empty.body')}</p>
        </div>
      ) : (
        KINDS.map((kind) => {
          // Anything not marked capacity is a feature add-on (the contract's default), so no card can fall out of both groups.
          const cards = data.catalog.filter(
            (c) => (c.kind === 'capacity' ? 'capacity' : 'feature') === kind,
          );
          if (cards.length === 0) return null;
          const headingId = `addons-group-${kind}`;
          return (
            <section
              key={kind}
              aria-labelledby={headingId}
              className="space-y-2"
              data-testid={`addons-group-${kind}`}
            >
              <h3 id={headingId} className="text-sm font-semibold">
                {t(`groups.${kind}`)}
              </h3>
              <ul
                aria-label={t('listLabel')}
                className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3"
              >
                {cards.map((c) => (
                  <li key={c.id} className="flex min-w-0">
                    <AddonCardView card={c} canBuy={data.canBuy} onStatus={setStatus} />
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}
      <p className="text-xs text-muted-foreground">
        {t('walletNote')}{' '}
        <Link href="/billing/wallet" className="font-medium text-primary underline">
          {t('walletLink')}
        </Link>
      </p>
    </div>
  );
}

function UnavailableNotice({ reason }: { reason: WorkspaceAddonsResponse['unavailableReason'] }) {
  const t = useTranslations(NS);
  return (
    <Alert tone="info" data-testid="addons-unavailable">
      <div className="space-y-2">
        <p className="font-medium">{t('unavailable.title')}</p>
        <p>{t(`unavailable.${reason ?? 'no_plan'}`)}</p>
        <Link
          href="/account/plans"
          className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary"
        >
          {t('unavailable.cta')}
        </Link>
      </div>
    </Alert>
  );
}

function OwnedList({ owned }: { owned: readonly OwnedAddon[] }) {
  const t = useTranslations(NS);
  const fmt = useFormatter();
  const date = (iso: string) => fmt.dateTime(new Date(iso), { dateStyle: 'medium' });
  return (
    <section aria-label={t('owned.title')} className="space-y-2" data-testid="addons-owned">
      <h3 className="text-sm font-semibold">{t('owned.title')}</h3>
      <ul className="divide-y divide-border rounded-xl border border-border">
        {owned.map((o) => (
          <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            <div className="min-w-0">
              <p className="break-words text-sm font-medium">{o.name}</p>
              <p className="text-xs text-muted-foreground">
                {o.endsAt === null
                  ? t('owned.lifetime')
                  : o.renews
                    ? t('owned.renews', { date: date(o.endsAt) })
                    : t('owned.ends', { date: date(o.endsAt) })}
              </p>
            </div>
            {o.renews && <CancelAddonRenewal addonId={o.id} name={o.name} />}
          </li>
        ))}
      </ul>
    </section>
  );
}

function AddonCardView({
  card,
  canBuy,
  onStatus,
}: {
  card: AddonCard;
  canBuy: boolean;
  onStatus: (status: Status) => void;
}) {
  const t = useTranslations(NS);
  const fmt = useFormatter();
  const headingId = `addon-${card.slug}-title`;
  const hintId = `addon-${card.slug}-hint`;
  const date = (iso: string) => fmt.dateTime(new Date(iso), { dateStyle: 'medium' });

  const priceValue = card.offerAmount ?? card.amount;
  const price =
    card.isFree || Number(card.amount) === 0
      ? t('price.free')
      : fmt.number(Number(priceValue), { style: 'currency', currency: card.currency });
  const period = card.isLifetime
    ? t('price.oneTime')
    : card.billingMode === 'one_time'
      ? t('price.oneTime')
      : t(`price.per.${card.billingUnit}`, { count: card.billingDuration });
  const bullets = card.grantBullets.map((b) =>
    b.kind === 'feature'
      ? b.label
      : b.kind === 'limit_unlimited'
        ? t('bullets.unlimited', { name: b.label })
        : t('bullets.add', { amount: b.amount ?? 0, name: b.label }),
  );

  return (
    <article
      aria-labelledby={headingId}
      data-testid={`addon-${card.slug}`}
      data-state={card.state}
      className="flex w-full min-w-0 flex-col gap-3 rounded-xl border border-border bg-background p-5"
    >
      <div>
        {/* Under its group's heading. */}
        <h4 id={headingId} className="break-words font-semibold">
          {card.name}
        </h4>
        {card.subtitle && (
          <p className="break-words text-sm text-muted-foreground">{card.subtitle}</p>
        )}
      </div>

      {card.state !== 'included' && (
        <div>
          <p className="text-2xl font-semibold">
            {card.offerAmount && card.state !== 'active' && (
              <span className="me-2 text-sm font-normal text-muted-foreground line-through">
                {fmt.number(Number(card.amount), { style: 'currency', currency: card.currency })}
              </span>
            )}
            {price} <span className="text-sm font-normal text-muted-foreground">{period}</span>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {card.isLifetime || card.billingMode === 'one_time'
              ? t('renewal.oneTime')
              : t('renewal.recurring')}
          </p>
        </div>
      )}

      {bullets.length > 0 && (
        <ul className="space-y-1 text-sm">
          {bullets.slice(0, 6).map((b, i) => (
            <li key={i} className="flex gap-2">
              <span aria-hidden="true" className="text-success">
                ✓
              </span>
              <span className="min-w-0 break-words">{b}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-auto space-y-1.5">
        {card.state === 'included' && (
          <div data-testid={`addon-${card.slug}-included`} className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="success">{t('state.included')}</Badge>
              <Badge
                tone={card.activation === 'disabled' ? 'warning' : 'success'}
                data-testid={`addon-${card.slug}-activation`}
              >
                {card.activation === 'disabled' ? t('state.turnedOff') : t('state.active')}
              </Badge>
            </div>
            {card.activation === 'disabled' && (
              <p className="text-xs text-muted-foreground">{t('activation.turnedOffNote')}</p>
            )}
            {card.includedVia === 'support' && (
              <p className="text-xs text-muted-foreground">{t('state.includedSupport')}</p>
            )}
            {card.ownedCount > 0 && (
              <p className="text-xs text-muted-foreground" data-testid={`addon-${card.slug}-note`}>
                {!card.ownedRenews && card.ownedEndsAt
                  ? t('state.includedEnds', { date: date(card.ownedEndsAt) })
                  : t('state.includedOwned')}
              </p>
            )}
            {card.canToggle && (
              <ActivationControl card={card} titleId={headingId} onStatus={onStatus} />
            )}
          </div>
        )}

        {card.state === 'active' && (
          <div className="space-y-1" data-testid={`addon-${card.slug}-active`}>
            <Badge tone="success">{t('state.active')}</Badge>
            <p className="text-xs text-muted-foreground">
              {card.ownedEndsAt === null
                ? t('owned.lifetime')
                : card.ownedRenews
                  ? t('owned.renews', { date: date(card.ownedEndsAt) })
                  : t('owned.ends', { date: date(card.ownedEndsAt) })}
            </p>
          </div>
        )}

        {card.state === 'unavailable' && (
          <p
            className="text-sm text-muted-foreground"
            data-testid={`addon-${card.slug}-unavailable`}
          >
            {t('unavailableCard')}
          </p>
        )}

        {(card.state === 'buy' || card.state === 'buy_again') &&
          (canBuy ? (
            <Link
              href={`/billing/checkout/${card.slug}`}
              className="inline-flex h-10 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary"
            >
              {card.state === 'buy_again' ? t('buyAgain') : t('buy')}
            </Link>
          ) : (
            <>
              <Button type="button" disabled className="w-full" aria-describedby={hintId}>
                {card.state === 'buy_again' ? t('buyAgain') : t('buy')}
              </Button>
              <p id={hintId} className="text-xs text-muted-foreground">
                {t('cannotBuyHint')}
              </p>
            </>
          ))}

        {card.state === 'buy_again' && (
          <p className="text-xs text-muted-foreground">
            {t('state.ownedCount', { count: card.ownedCount })}
          </p>
        )}
      </div>
    </article>
  );
}

/**
 * Turn off / Turn on for an included plain add-on. A person without `addons.activation.manage` sees only the state and the way to
 * get it changed. Turning off goes through the preview dialog; turning on is one action with nothing to confirm.
 */
function ActivationControl({
  card,
  titleId,
  onStatus,
}: {
  card: AddonCard;
  titleId: string;
  onStatus: (status: Status) => void;
}) {
  const t = useTranslations(NS);
  const can = useCan('addons.activation.manage');
  if (!can) {
    return (
      <p className="text-xs text-muted-foreground" data-testid={`addon-${card.slug}-ask-owner`}>
        {t('activation.askOwner')}
      </p>
    );
  }
  return <ActivationButtons card={card} titleId={titleId} onStatus={onStatus} />;
}

function ActivationButtons({
  card,
  titleId,
  onStatus,
}: {
  card: AddonCard;
  titleId: string;
  onStatus: (status: Status) => void;
}) {
  const t = useTranslations(NS);
  const after = useAfterActivationChange();
  const [open, setOpen] = useState(false);
  const turnOn = useMutation({
    mutationFn: () => enableAddon(card.id),
    onSuccess: async () => {
      await after();
      onStatus({ tone: 'success', text: t('activation.doneOn', { name: card.name }) });
    },
    onError: (e) =>
      onStatus({
        tone: 'danger',
        text: t(`activation.errors.${activationErrorKey(e)}`, { name: card.name }),
      }),
  });

  if (card.activation === 'disabled') {
    return (
      <Button
        size="sm"
        aria-describedby={titleId}
        disabled={turnOn.isPending}
        data-testid={`addon-${card.slug}-turn-on`}
        onClick={() => {
          onStatus(null);
          turnOn.mutate();
        }}
      >
        {turnOn.isPending && <Spinner />}
        {t('activation.turnOn')}
      </Button>
    );
  }
  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        aria-describedby={titleId}
        data-testid={`addon-${card.slug}-turn-off`}
        onClick={() => {
          onStatus(null);
          setOpen(true);
        }}
      >
        {t('activation.turnOff')}
      </Button>
      <AddonToggleDialog
        card={card}
        open={open}
        onClose={() => setOpen(false)}
        onDone={(text) => onStatus({ tone: 'success', text })}
      />
    </>
  );
}
