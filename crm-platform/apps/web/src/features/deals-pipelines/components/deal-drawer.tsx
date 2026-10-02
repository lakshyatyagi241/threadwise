'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button, ConfirmDialog, Field, Input, Select, cn, useToast } from '@crm/ui';
import { LinkedSalesDocs } from '@/features/sales-docs';
import { LinkedInvoices } from '@/features/invoicing';
import { LinkedTasks } from '@/features/tasks';
import { KEYS, useDealDetail, useMembers } from '../api/hooks';
import { dealsApi } from '../api/service';
import type { ContactRef, Deal, Pipeline, UpdateDealInput } from '../api/schemas';
import { errorKind } from '../lib/errors';
import { currencyChoices, formatMoney, minorExponent, toMajorInput, toMinor } from '../lib/money';
import { DealActivity } from './deal-activity';
import { ContactPicker } from './contact-picker';
import { Drawer } from './drawer';
import { ErrorLine, StatusChip, useErrorText, useSourceLabel } from './parts';
import { MessageIcon, TrashIcon } from './icons';

export interface DealDrawerProps {
  dealId: string;
  /** The card's copy, shown while the full record loads. */
  seed?: Deal;
  pipelines: readonly Pipeline[];
  /** The board's pipeline currency, so a saved deal lands on the board with the right column value. */
  currency?: string;
  canWrite: boolean;
  canDelete: boolean;
  onClose: () => void;
  /** The deal changed on the server: the board updates its card. */
  onChanged: (deal: Deal) => void;
  onDeleted: (id: string) => void;
  /** Moves the deal (the screen asks for a lost reason when the target is a lost stage). */
  onMoveStage: (deal: Deal, stageId: string) => void;
}

const digits = (phone: string | null | undefined) => (phone ?? '').replace(/\D/g, '');

/** The detail panel (TW-DEAL-010..014): fields that save when you leave them, outcome buttons, customer and timeline. */
export function DealDrawer(p: DealDrawerProps) {
  const t = useTranslations('deals-pipelines.drawer');
  const detail = useDealDetail(p.dealId, p.currency);
  const deal = detail.data ?? p.seed;
  return (
    <Drawer onClose={p.onClose} title={deal?.title ?? t('loading')} closeLabel={t('close')}>
      {!deal && detail.isPending && (
        <div className="space-y-3 p-6" aria-busy="true" aria-label={t('loading')}>
          <div className="h-8 w-2/3 animate-pulse rounded bg-muted" />
          <div className="h-24 animate-pulse rounded bg-muted" />
          <div className="h-40 animate-pulse rounded bg-muted" />
        </div>
      )}
      {!deal && detail.isError && (
        <div className="p-6">
          <ErrorLine error={detail.error} onRetry={() => void detail.refetch()} />
        </div>
      )}
      {deal && <DrawerBody {...p} deal={deal} />}
    </Drawer>
  );
}

function DrawerBody({
  deal,
  pipelines,
  currency,
  canWrite,
  canDelete,
  onChanged,
  onDeleted,
  onMoveStage,
}: DealDrawerProps & { deal: Deal }) {
  const t = useTranslations('deals-pipelines.drawer');
  const locale = useLocale();
  const qc = useQueryClient();
  const { toast } = useToast();
  const members = useMembers();
  const errorText = useErrorText();
  const sourceLabel = useSourceLabel();
  const pipeline = pipelines.find((x) => x.id === deal.pipelineId);
  const stages = pipeline?.stages ?? [];
  const stage = stages.find((s) => s.id === deal.stageId);
  const firstOpen = stages.find((s) => s.kind === 'open');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [titleError, setTitleError] = useState(false);
  const [valueError, setValueError] = useState(false);

  async function save(patch: UpdateDealInput) {
    try {
      const next = await dealsApi.updateDeal(deal, patch, currency);
      qc.setQueryData(KEYS.deal(deal.id), next);
      onChanged(next);
      toast(t('saved'), 'success');
    } catch (e) {
      const kind = errorKind(e);
      toast(kind === 'conflict' ? t('conflict') : `${t('saveFailed')} ${errorText(e)}`, 'danger');
      if (kind === 'conflict') void qc.invalidateQueries({ queryKey: KEYS.deal(deal.id) });
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await dealsApi.deleteDeal(deal.id);
      onDeleted(deal.id);
      toast(t('deleted'), 'success');
    } catch (e) {
      toast(`${t('deleteFailed')} ${errorText(e)}`, 'danger');
      setBusy(false);
      setConfirmDelete(false);
    }
  }

  const phone = digits(deal.contact?.phone);
  const lostStage = stages.find((s) => s.kind === 'lost');
  const wonStage = stages.find((s) => s.kind === 'won');

  return (
    <>
      <div className="space-y-5 border-b border-border p-5 pe-14">
        <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {t('eyebrow', { source: sourceLabel(deal.source) })}
        </div>
        <Field label={t('name')} htmlFor="drawer-title" error={titleError ? t('titleRequired') : undefined}>
          <Input
            key={deal.title}
            id="drawer-title"
            defaultValue={deal.title}
            maxLength={191}
            readOnly={!canWrite}
            invalid={titleError}
            className="h-11 text-base font-semibold"
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v === deal.title) return setTitleError(false);
              if (v === '') {
                setTitleError(true);
                return;
              }
              setTitleError(false);
              void save({ title: v });
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
          />
        </Field>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-2xl font-semibold tabular-nums">
            {formatMoney(deal.valueMinor, deal.currency, locale)}
          </span>
          <StatusChip status={deal.status} />
          {stage && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
              <span aria-hidden="true" className="size-2 rounded-full" style={{ backgroundColor: stage.color }} />
              {stage.name}
            </span>
          )}
        </div>
        {canWrite && (
          <div className="flex flex-wrap items-center gap-2">
            {deal.status === 'open' && wonStage && (
              <Button variant="brand" onClick={() => onMoveStage(deal, wonStage.id)}>
                {t('markWon')}
              </Button>
            )}
            {deal.status === 'open' && lostStage && (
              <Button variant="secondary" onClick={() => onMoveStage(deal, lostStage.id)}>
                {t('markLost')}
              </Button>
            )}
            {deal.status !== 'open' && firstOpen && (
              <Button variant="secondary" onClick={() => onMoveStage(deal, firstOpen.id)}>
                {t('reopen')}
              </Button>
            )}
            {canDelete && (
              <Button variant="ghost" className="ms-auto text-danger" onClick={() => setConfirmDelete(true)}>
                <TrashIcon /> {t('delete')}
              </Button>
            )}
          </div>
        )}
        {deal.status === 'lost' && deal.lostReason && (
          <p className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
            {t('lostReason', { reason: deal.lostReason })}
          </p>
        )}
      </div>

      <div className="space-y-6 p-5">
        <section aria-labelledby="drawer-customer" className="space-y-2">
          <h3 id="drawer-customer" className="text-sm font-semibold">
            {t('customer')}
          </h3>
          <ContactPicker
            value={deal.contact}
            disabled={!canWrite}
            onChange={(c: ContactRef | null) => void save({ contactId: c?.id ?? null })}
          />
          {!deal.contact && <p className="text-xs text-muted-foreground">{t('noContact')}</p>}
          {deal.company && (
            <p className="text-xs text-muted-foreground">{t('company', { name: deal.company.name })}</p>
          )}
          {deal.contact && (
            <div className="flex flex-wrap gap-2">
              {phone && (
                <a
                  href={`https://wa.me/${phone}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-8 items-center gap-1.5 rounded-md bg-brand px-3 text-xs font-medium text-brand-foreground hover:opacity-90"
                >
                  <MessageIcon /> {t('message')}
                </a>
              )}
            </div>
          )}
        </section>

        <section aria-labelledby="drawer-details" className="space-y-3">
          <h3 id="drawer-details" className="text-sm font-semibold">
            {t('details')}
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('value')} htmlFor="drawer-value" error={valueError ? t('valueInvalid') : undefined}>
              <Input
                key={`${deal.valueMinor}:${deal.currency}`}
                id="drawer-value"
                inputMode="decimal"
                readOnly={!canWrite}
                invalid={valueError}
                defaultValue={toMajorInput(deal.valueMinor, deal.currency)}
                onBlur={(e) => {
                  const minor = toMinor(e.target.value, deal.currency);
                  if (Number.isNaN(minor) || minor > 9_999_999_999) return setValueError(true);
                  setValueError(false);
                  if (minor !== deal.valueMinor) void save({ value: toMajorInput(minor, deal.currency) });
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                }}
              />
            </Field>
            <Field label={t('currency')} htmlFor="drawer-currency">
              <Select
                id="drawer-currency"
                disabled={!canWrite}
                value={deal.currency}
                onChange={(e) => {
                  const next = e.target.value;
                  // a new currency travels with the value, relabelled (the amount is not converted)
                  const major = deal.valueMinor / 10 ** minorExponent(deal.currency);
                  void save({ currency: next, value: major.toFixed(minorExponent(next)) });
                }}
              >
                {currencyChoices(deal.currency).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('stage')} htmlFor="drawer-stage">
              <Select
                id="drawer-stage"
                disabled={!canWrite}
                value={deal.stageId}
                onChange={(e) => onMoveStage(deal, e.target.value)}
              >
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('owner')} htmlFor="drawer-owner">
              <Select
                id="drawer-owner"
                disabled={!canWrite}
                value={deal.owner?.id ?? ''}
                onChange={(e) => void save({ ownerId: e.target.value || null })}
              >
                <option value="">{t('unassigned')}</option>
                {deal.owner && !(members.data ?? []).some((m) => m.id === deal.owner?.id) && (
                  <option value={deal.owner.id}>{deal.owner.name}</option>
                )}
                {(members.data ?? []).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.fullName}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('expectedClose')} htmlFor="drawer-close" className="sm:col-span-2">
              <Input
                id="drawer-close"
                type="date"
                readOnly={!canWrite}
                value={deal.expectedCloseDate?.slice(0, 10) ?? ''}
                onChange={(e) => void save({ expectedCloseDate: e.target.value || null })}
              />
            </Field>
          </div>
        </section>

        <LinkedTasks
          kind="deal"
          id={deal.id}
          compact
          className="border-t border-border pt-5"
          onChanged={() => void qc.invalidateQueries({ queryKey: KEYS.activities(deal.id) })}
        />
        <LinkedInvoices kind="deal" id={deal.id} compact className="border-t border-border pt-5" />

        <LinkedSalesDocs kind="deal" id={deal.id} compact className="border-t border-border pt-5" />

        <div className={cn('border-t border-border pt-5')}>
          <DealActivity deal={deal} canWrite={canWrite} />
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title={t('deleteTitle')}
        message={t('deleteMessage', { title: deal.title })}
        confirmLabel={t('delete')}
        cancelLabel={t('cancel')}
        tone="danger"
        busy={busy}
        onConfirm={() => void remove()}
        onClose={() => setConfirmDelete(false)}
      />
    </>
  );
}
