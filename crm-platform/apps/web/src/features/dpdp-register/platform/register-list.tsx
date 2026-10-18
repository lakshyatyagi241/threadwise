'use client';

import { useId, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Badge, Button, EmptyState, cn } from '@crm/ui';
import type {
  DpdpCheckKey,
  DpdpCheckView,
  DpdpItemView,
  DpdpRegisterResponse,
  OperatorRole,
} from '@crm/contracts';
import {
  AlertIcon,
  CheckIcon,
  CloseIcon,
} from '@/features/auth-registration-security/platform/ui/icons';
import { AttestDialog } from './attest-dialog';
import { HistoryDialog } from './history-list';
import {
  STATUS_FILTERS,
  canAttest,
  canViewHistory,
  checkMessageKey,
  detailMessage,
  filterGroups,
  isLapsed,
  safeHttpsUrl,
  statusTone,
  type StatusFilter,
  type StatusTone,
} from './logic';

const NS = 'dpdp-register-admin';

const STATUS_BADGE: Record<StatusTone, 'success' | 'warning' | 'danger' | 'neutral'> = {
  good: 'success',
  warn: 'warning',
  bad: 'danger',
  neutral: 'neutral',
};
const RESULT_BADGE = { pass: 'success', fail: 'danger', unknown: 'neutral' } as const;

/** The filter chips and the obligations under them, grouped A to I. The server's order is kept: worst first inside each group. */
export function RegisterList({
  register,
  role,
}: {
  register: DpdpRegisterResponse;
  role: OperatorRole;
}) {
  const t = useTranslations(NS);
  const id = useId();
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [attesting, setAttesting] = useState<DpdpCheckKey | null>(null);
  const [viewing, setViewing] = useState<DpdpCheckKey | null>(null);

  const groups = filterGroups(register.groups, filter);
  const shown = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <div className="space-y-5">
      <div role="group" aria-label={t('filters.label')} className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
            className={cn(
              'h-8 rounded-full border px-3 text-xs font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-primary',
              filter === f
                ? 'border-brand bg-brand text-brand-foreground'
                : 'border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {f === 'all' ? t('filters.all') : t(`status.${f}`)}
          </button>
        ))}
      </div>
      <p role="status" className="sr-only">
        {t('filters.shown', { count: shown })}
      </p>

      {groups.length === 0 ? (
        <EmptyState
          title={t('filters.empty.title')}
          message={t('filters.empty.message')}
          actions={
            <Button variant="secondary" onClick={() => setFilter('all')}>
              {t('filters.empty.reset')}
            </Button>
          }
        />
      ) : (
        groups.map((group) => (
          <section key={group.id} aria-labelledby={`${id}-${group.id}`} className="space-y-3">
            <h2 id={`${id}-${group.id}`} className="text-base font-semibold">
              {t(`groups.${group.id}`)}
            </h2>
            <ul className="space-y-3">
              {group.items.map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  role={role}
                  onAttest={setAttesting}
                  onHistory={setViewing}
                />
              ))}
            </ul>
          </section>
        ))
      )}

      <AttestDialog checkKey={attesting} onClose={() => setAttesting(null)} />
      <HistoryDialog checkKey={viewing} onClose={() => setViewing(null)} />
    </div>
  );
}

function ItemRow({
  item,
  role,
  onAttest,
  onHistory,
}: {
  item: DpdpItemView;
  role: OperatorRole;
  onAttest: (key: DpdpCheckKey) => void;
  onHistory: (key: DpdpCheckKey) => void;
}) {
  const t = useTranslations(NS);
  const titleKey = `items.${item.id}.title`;

  return (
    <li
      id={item.id}
      data-status={item.status}
      className="scroll-mt-4 space-y-3 rounded-md border border-border bg-background p-4"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <Badge data-status-chip tone={STATUS_BADGE[statusTone(item.status)]}>
          {t(`status.${item.status}`)}
        </Badge>
        <span className="font-mono text-xs text-muted-foreground" dir="ltr">
          {item.id}
        </span>
        {item.conditional && <Badge>{t('item.conditional')}</Badge>}
      </div>
      <h3 className="text-base font-medium">{t.has(titleKey) ? t(titleKey) : item.id}</h3>

      <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
        <div className="flex gap-1.5">
          <dt>{t('item.citation')}</dt>
          <dd dir="ltr" className="text-foreground">
            {item.citation}
          </dd>
        </div>
        <div className="flex gap-1.5">
          <dt>{t('item.owner')}</dt>
          <dd className="text-foreground">{t(`owners.${item.owner}`)}</dd>
        </div>
        {item.penaltyTier !== 'none' && (
          <div className="flex gap-1.5">
            <dt>{t('item.penalty')}</dt>
            <dd className="text-foreground">{t(`tiers.${item.penaltyTier}`)}</dd>
          </div>
        )}
        {item.planItems.length > 0 && (
          <div className="flex gap-1.5">
            <dt>{t('item.plan')}</dt>
            <dd dir="ltr" className="text-foreground">
              {item.planItems.join(', ')}
            </dd>
          </div>
        )}
      </dl>

      {item.checks.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('item.noChecks')}</p>
      ) : (
        <ul
          aria-label={t('item.checks')}
          className="divide-y divide-border rounded-md border border-border"
        >
          {item.checks.map((check) => (
            <CheckRow
              key={check.key}
              check={check}
              role={role}
              onAttest={onAttest}
              onHistory={onHistory}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function ResultMark({ result }: { result: DpdpCheckView['result'] }) {
  const t = useTranslations(NS);
  return (
    <Badge tone={RESULT_BADGE[result]} className="gap-1">
      <span aria-hidden="true" className="inline-flex w-4 justify-center">
        {result === 'pass' ? (
          <CheckIcon className="size-3.5" />
        ) : result === 'fail' ? (
          <CloseIcon className="size-3.5" />
        ) : (
          <AlertIcon className="size-3.5" />
        )}
      </span>
      {t(`result.${result}`)}
    </Badge>
  );
}

function CheckRow({
  check,
  role,
  onAttest,
  onHistory,
}: {
  check: DpdpCheckView;
  role: OperatorRole;
  onAttest: (key: DpdpCheckKey) => void;
  onHistory: (key: DpdpCheckKey) => void;
}) {
  const t = useTranslations(NS);
  const format = useFormatter();
  const title = t(`checks.${checkMessageKey(check.key)}.title`);
  const { attestation } = check;
  const link = safeHttpsUrl(attestation?.evidenceUrl);
  const mayAttest = canAttest(role, check.source);
  const mayViewHistory = canViewHistory(check.source);

  // The attested texts name who recorded the statement and when; the dates are formatted here, in the viewer's language.
  const { key, values } = detailMessage(check);
  const day = (iso: string) => format.dateTime(new Date(iso), { dateStyle: 'medium' });
  const detail = t(
    key,
    attestation
      ? {
          ...values,
          name: attestation.byName,
          date: day(attestation.at),
          expires: day(attestation.expiresAt),
        }
      : values,
  );

  return (
    <li
      data-check={check.key}
      className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 p-3"
    >
      <div className="min-w-0 flex-1 basis-64 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <ResultMark result={check.result} />
          <span className="text-sm font-medium">{title}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{t(`source.${check.source}`)}</Badge>
          {isLapsed(check) && <Badge tone="warning">{t('check.lapsed')}</Badge>}
        </div>
        <p className="break-words text-sm text-muted-foreground">{detail}</p>
        {attestation && (
          <div className="space-y-1 border-s-2 border-border ps-3 text-sm">
            <p className="whitespace-pre-line break-words">
              <span className="font-medium">{t('check.note')}</span> {attestation.note}
            </p>
            {link && (
              <a
                href={link}
                target="_blank"
                rel="noopener noreferrer"
                dir="ltr"
                className="inline-block break-all font-medium text-primary underline underline-offset-2"
              >
                {t('check.evidence')}
              </a>
            )}
          </div>
        )}
      </div>
      {(mayAttest || mayViewHistory) && (
        <div className="flex shrink-0 flex-wrap gap-2">
          {mayAttest && (
            <Button
              size="sm"
              variant="secondary"
              aria-label={t('attest.actionFor', { check: title })}
              onClick={() => onAttest(check.key)}
            >
              {t('attest.action')}
            </Button>
          )}
          {mayViewHistory && (
            <Button
              size="sm"
              variant="ghost"
              aria-label={t('history.actionFor', { check: title })}
              onClick={() => onHistory(check.key)}
            >
              {t('history.action')}
            </Button>
          )}
        </div>
      )}
    </li>
  );
}
