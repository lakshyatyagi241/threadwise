'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import {
  LEGAL_HOLD_REASON_CATEGORIES,
  LEGAL_HOLD_SCOPES,
  LEGAL_HOLD_STATUSES,
  type LegalHold,
  type LegalHoldReasonCategory,
  type LegalHoldScope,
  type LegalHoldStatus,
} from '@crm/contracts';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Drawer,
  EmptyState,
  Field,
  Input,
  Select,
  Spinner,
} from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import {
  legalHoldsExportUrl,
  useLegalHold,
  useLegalHolds,
  type HoldFilters,
} from '../api/legal-holds';
import { errorKey } from '../lib/errors';
import { holdStatusTone, isActive } from '../lib/legal-hold-model';
import {
  ExtendHoldDialog,
  PlaceHoldDialog,
  ReleaseHoldDialog,
  ReviewHoldDialog,
} from './hold-dialogs';

type Action = { kind: 'extend' | 'review' | 'release'; hold: LegalHold } | null;

/**
 * `/privacy-requests/legal-holds` (BL-296): the register of legal holds. Who may read it (`privacy.requests.read`) sees every hold with its
 * category, case reference, review and end dates, and can export it as a CSV for auditors; who may manage data requests can also place a
 * workspace-wide hold and extend, review or release one. A hold on one person is placed from that person's contact page.
 */
export function LegalHoldsScreen() {
  const t = useTranslations('privacy-requests.legalHold');
  const tc = useTranslations('privacy-requests.common');
  const te = useTranslations('privacy-requests');
  const f = useFormatter();
  const canRead = useCan('privacy.requests.read');
  const canManage = useCan('privacy.requests.manage');
  const [status, setStatus] = useState<LegalHoldStatus | ''>('active');
  const [category, setCategory] = useState<LegalHoldReasonCategory | ''>('');
  const [scope, setScope] = useState<LegalHoldScope | ''>('');
  const [reviewDue, setReviewDue] = useState(false);
  const [q, setQ] = useState('');
  const [placing, setPlacing] = useState(false);
  const [action, setAction] = useState<Action>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const filters: HoldFilters = {
    status: status || undefined,
    reasonCategory: category || undefined,
    scope: scope || undefined,
    reviewDue: reviewDue || undefined,
    q: q.trim() || undefined,
  };
  const list = useLegalHolds(filters, canRead);
  const detail = useLegalHold(openId, canRead);

  if (!canRead) {
    return (
      <Alert tone="warning" role="alert">
        {te('errors.forbidden')}
      </Alert>
    );
  }

  const rows = list.data?.pages.flatMap((p) => p.data) ?? [];
  const filtered = status !== '' || category !== '' || scope !== '' || reviewDue || q.trim() !== '';
  const day = (iso: string | null) =>
    iso ? f.dateTime(new Date(iso), { dateStyle: 'medium' }) : t('register.none');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h1 className="text-xl font-semibold">{t('register.title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('register.subtitle')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href={legalHoldsExportUrl(filters)}
            download
            className="inline-flex h-10 items-center justify-center rounded-md border border-border bg-background px-4 text-sm font-medium hover:bg-muted"
          >
            {t('register.export')}
          </a>
          {canManage && <Button onClick={() => setPlacing(true)}>{t('register.place')}</Button>}
        </div>
      </div>

      <div
        role="group"
        aria-label={t('register.filters.label')}
        className="flex flex-wrap items-end gap-3"
      >
        <Field label={t('register.filters.status')} htmlFor="lh-f-status">
          <Select
            id="lh-f-status"
            value={status}
            onChange={(e) => setStatus(e.target.value as LegalHoldStatus | '')}
          >
            <option value="">{t('register.filters.any')}</option>
            {LEGAL_HOLD_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`status.${s}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('register.filters.category')} htmlFor="lh-f-category">
          <Select
            id="lh-f-category"
            value={category}
            onChange={(e) => setCategory(e.target.value as LegalHoldReasonCategory | '')}
          >
            <option value="">{t('register.filters.any')}</option>
            {LEGAL_HOLD_REASON_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t(`category.${c}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('register.filters.scope')} htmlFor="lh-f-scope">
          <Select
            id="lh-f-scope"
            value={scope}
            onChange={(e) => setScope(e.target.value as LegalHoldScope | '')}
          >
            <option value="">{t('register.filters.any')}</option>
            {LEGAL_HOLD_SCOPES.map((s) => (
              <option key={s} value={s}>
                {t(`scope.${s}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('register.filters.caseRef')} htmlFor="lh-f-ref">
          <Input
            id="lh-f-ref"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoComplete="off"
            className="w-48"
          />
        </Field>
        <Checkbox
          id="lh-f-due"
          label={t('register.filters.reviewDue')}
          checked={reviewDue}
          onChange={(e) => setReviewDue(e.target.checked)}
          className="pb-2"
        />
      </div>

      {list.isError ? (
        <Alert tone="danger" role="alert" className="flex items-center justify-between gap-3">
          <span>{te(`errors.${errorKey(list.error)}`)}</span>
          <Button size="sm" variant="secondary" onClick={() => void list.refetch()}>
            {tc('retry')}
          </Button>
        </Alert>
      ) : list.isPending ? (
        <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner /> {tc('loading')}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState title={filtered ? t('register.emptyFiltered') : t('register.empty')} />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-xs text-muted-foreground">
              <tr>
                {(
                  [
                    'subject',
                    'category',
                    'caseRef',
                    'placed',
                    'review',
                    'expires',
                    'status',
                  ] as const
                ).map((c) => (
                  <th key={c} scope="col" className="px-3 py-2 text-start font-medium">
                    {t(`register.columns.${c}`)}
                  </th>
                ))}
                <th scope="col" className="px-3 py-2 text-start font-medium">
                  <span className="sr-only">{t('register.columns.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((h) => (
                <tr key={h.id} className="hover:bg-muted/50">
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      className="text-start text-primary hover:underline"
                      onClick={() => setOpenId(h.id)}
                      aria-label={t('register.open', { caseRef: h.caseRef })}
                    >
                      {h.scope === 'workspace' ? t('scope.workspace') : h.subjectLabel}
                    </button>
                    <span className="block text-xs text-muted-foreground">
                      {t(`scope.${h.scope}`)}
                      {h.restrictedCases > 0
                        ? ` - ${t('register.cases', { count: h.restrictedCases })}`
                        : ''}
                    </span>
                  </td>
                  <td className="px-3 py-2">{t(`category.${h.reasonCategory}`)}</td>
                  <td className="px-3 py-2 font-mono text-xs">{h.caseRef}</td>
                  <td className="px-3 py-2">
                    {day(h.placedAt)}
                    {h.placedBy && (
                      <span className="block text-xs text-muted-foreground">{h.placedBy}</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {day(h.reviewAt)}
                    {h.reviewDue && (
                      <Badge tone="danger" className="ms-1">
                        {t('register.overdue')}
                      </Badge>
                    )}
                  </td>
                  <td className="px-3 py-2">{day(h.expiresAt)}</td>
                  <td className="px-3 py-2">
                    <Badge tone={holdStatusTone(h)}>{t(`status.${h.status}`)}</Badge>
                  </td>
                  <td className="px-3 py-2">
                    {canManage && isActive(h) && (
                      <div className="flex flex-wrap gap-1">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setAction({ kind: 'review', hold: h })}
                        >
                          {t('actions.review')}
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setAction({ kind: 'extend', hold: h })}
                        >
                          {t('actions.extend')}
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setAction({ kind: 'release', hold: h })}
                        >
                          {t('actions.release')}
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {list.hasNextPage && (
        <div className="flex justify-center">
          <Button
            variant="secondary"
            disabled={list.isFetchingNextPage}
            onClick={() => void list.fetchNextPage()}
          >
            {list.isFetchingNextPage ? t('register.loadingMore') : t('register.loadMore')}
          </Button>
        </div>
      )}

      {canManage && (
        <PlaceHoldDialog open={placing} onClose={() => setPlacing(false)} chooseTarget />
      )}
      {canManage && action?.kind === 'extend' && (
        <ExtendHoldDialog open hold={action.hold} onClose={() => setAction(null)} />
      )}
      {canManage && action?.kind === 'review' && (
        <ReviewHoldDialog open hold={action.hold} onClose={() => setAction(null)} />
      )}
      {canManage && action?.kind === 'release' && (
        <ReleaseHoldDialog open hold={action.hold} onClose={() => setAction(null)} />
      )}

      <Drawer
        open={openId !== null}
        onClose={() => setOpenId(null)}
        title={t('detail.title')}
        closeLabel={t('close')}
      >
        {detail.isPending ? (
          <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner /> {tc('loading')}
          </div>
        ) : detail.isError ? (
          <Alert tone="danger" role="alert">
            {te(`errors.${errorKey(detail.error)}`)}
          </Alert>
        ) : (
          <div className="space-y-4 text-sm">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <dt className="text-muted-foreground">{t('register.columns.subject')}</dt>
              <dd>{detail.data.hold.subjectLabel}</dd>
              <dt className="text-muted-foreground">{t('register.columns.category')}</dt>
              <dd>{t(`category.${detail.data.hold.reasonCategory}`)}</dd>
              <dt className="text-muted-foreground">{t('register.columns.caseRef')}</dt>
              <dd className="font-mono text-xs">{detail.data.hold.caseRef}</dd>
              <dt className="text-muted-foreground">{t('register.columns.review')}</dt>
              <dd>{day(detail.data.hold.reviewAt)}</dd>
              <dt className="text-muted-foreground">{t('register.columns.expires')}</dt>
              <dd>{day(detail.data.hold.expiresAt)}</dd>
              <dt className="text-muted-foreground">{t('register.columns.status')}</dt>
              <dd>{t(`status.${detail.data.hold.status}`)}</dd>
              {detail.data.hold.releasedAt && (
                <>
                  <dt className="text-muted-foreground">{t('detail.releasedAt')}</dt>
                  <dd>
                    {day(detail.data.hold.releasedAt)}
                    {detail.data.hold.releasedBy ? ` - ${detail.data.hold.releasedBy}` : ''}
                  </dd>
                </>
              )}
            </dl>
            {detail.data.hold.note && (
              <p>
                <span className="font-medium">{t('place.note')}:</span> {detail.data.hold.note}
              </p>
            )}
            {detail.data.hold.releaseNote && (
              <p>
                <span className="font-medium">{t('release.reason')}:</span>{' '}
                {detail.data.hold.releaseNote}
              </p>
            )}
            <section className="space-y-2">
              <h3 className="font-semibold">{t('detail.history')}</h3>
              <ol className="space-y-2 border-s border-border ps-4">
                {detail.data.history.map((e, i) => (
                  <li key={`${e.at}-${i}`}>
                    <span className="font-medium">
                      {t(`detail.action.${historyKey(e.action)}`)}
                    </span>{' '}
                    <span className="text-xs text-muted-foreground">
                      {e.actor ? t('detail.by', { actor: e.actor }) : t('detail.system')}
                      {' - '}
                      {f.dateTime(new Date(e.at), { dateStyle: 'medium', timeStyle: 'short' })}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          </div>
        )}
      </Drawer>
    </div>
  );
}

/** The audit action behind a history line, as the key of its text. */
function historyKey(action: string): 'insert' | 'update' | 'delete' | 'other' {
  return action === 'insert' || action === 'update' || action === 'delete' ? action : 'other';
}
