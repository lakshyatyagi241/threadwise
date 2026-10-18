'use client';

import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useMemo } from 'react';
import { Alert, Checkbox, Field, Select } from '@crm/ui';
import { useSession } from '@/features/auth-registration-security/shared/session-context';
import { useCalendarConnection, useCalendarOptions, useSpreadsheetOptions } from '../api/hooks';
import { DEPOSIT_MODES, type DepositMode } from '../api/schemas';
import { currencyChoices, draftPrice } from '../lib/editor';
import { formatMoney, minorToInput } from '../lib/money';
import { SectionCard, TextField, useEditor } from './editor-shared';

/** Step 4: the fee and what is taken at booking, the cancellation terms, and the optional Google Calendar link. */
export function PricingStep() {
  const t = useTranslations('appointments.editor.pricing');
  const tc = useTranslations('appointments.editor.calendar');
  const locale = useLocale();
  const session = useSession();
  const connection = useCalendarConnection();
  const { draft, set, fid, disabled } = useEditor();

  const currency = draft.currency.toUpperCase();
  const choices = useMemo(
    () => currencyChoices(currency, session.org.currency),
    [currency, session.org.currency],
  );
  const price = draftPrice(draft);
  const money = (minor: number) => formatMoney(minor, currency, locale);
  const calendarOff = connection.data?.status === 'unavailable';
  // The calendar and the sheet are chosen from the connected Google account's own lists; nothing is typed in by hand.
  const connected = connection.data?.status === 'connected';
  const calendars = useCalendarOptions(connected);
  const sheets = useSpreadsheetOptions(connected);
  const listed = calendars.data ?? null;
  const sheetList = sheets.data ?? null;
  const connectFirst = (
    <p className="text-xs text-muted-foreground">
      {tc.rich('connectFirst', {
        link: (c) => (
          <Link href="/google-account" className="text-primary underline">
            {c}
          </Link>
        ),
      })}
    </p>
  );

  return (
    <div className="space-y-4">
      <SectionCard title={t('title')} hint={t('hint')}>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t('currency')} htmlFor={fid('currency')} hint={t('currencyHint')}>
            <Select
              id={fid('currency')}
              value={currency}
              disabled={disabled}
              onChange={(e) => set('currency', e.target.value)}
              dir="ltr"
              className="font-mono"
            >
              {choices.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          <TextField
            name="fee"
            numeric
            label={t('fee', { currency })}
            hint={t('feeHint', { example: minorToInput(15000, currency) })}
            placeholder="0"
          />
          <TextField name="taxPct" numeric label={t('tax')} hint={t('taxHint')} placeholder="0" />
          <Field label={t('deposit')} htmlFor={fid('depositMode')}>
            <Select
              id={fid('depositMode')}
              value={draft.depositMode}
              disabled={disabled}
              onChange={(e) => set('depositMode', e.target.value as DepositMode)}
            >
              {DEPOSIT_MODES.map((m) => (
                <option key={m} value={m}>
                  {t(`depositModes.${m}`)}
                </option>
              ))}
            </Select>
          </Field>
          {draft.depositMode === 'partial' && (
            <TextField
              name="deposit"
              numeric
              label={t('depositAmount', { currency })}
              placeholder="0"
            />
          )}
        </div>
        <Alert tone="info" className="mt-3 text-xs">
          {t('paymentNote')}
        </Alert>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <TextField
            name="cancelFee"
            numeric
            label={t('cancelFee', { currency })}
            placeholder="0"
          />
          <TextField
            name="noShowFee"
            numeric
            label={t('noShowFee', { currency })}
            placeholder="0"
          />
          <TextField
            name="cancelWindow"
            numeric
            label={t('cancelWindow')}
            hint={t('cancelWindowHint')}
          />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{t('recordedOnly')}</p>

        <dl
          className="mt-4 space-y-1.5 rounded-lg border border-border bg-muted/40 p-3 text-sm"
          aria-label={t('totalsLabel')}
          aria-live="polite"
        >
          <Row label={t('totalFee')} value={money(price.feeMinor)} />
          <Row label={t('totalTax')} value={money(price.taxMinor)} />
          <div className="flex items-baseline justify-between gap-4 border-t border-border pt-1.5 font-semibold">
            <dt>{t('totalSum')}</dt>
            <dd className="tabular-nums" dir="ltr">
              {money(price.totalMinor)}
            </dd>
          </div>
          <Row label={t('totalDue')} value={money(price.dueNowMinor)} />
        </dl>
      </SectionCard>

      <SectionCard title={tc('title')} hint={tc('hint')}>
        {calendarOff && (
          <Alert tone="info" className="mb-3 text-xs">
            {tc('unavailable')}
          </Alert>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={tc('calendarId')} htmlFor={fid('calendarId')}>
            {listed ? (
              <Select
                id={fid('calendarId')}
                value={draft.calendarId}
                disabled={disabled}
                onChange={(e) => set('calendarId', e.target.value)}
              >
                <option value="">{tc('calendarDefault')}</option>
                {draft.calendarId && !listed.some((c) => c.id === draft.calendarId) && (
                  <option value={draft.calendarId}>{draft.calendarId}</option>
                )}
                {listed.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            ) : connected ? null : (
              connectFirst
            )}
          </Field>
          <Field label={tc('spreadsheetId')} htmlFor={fid('spreadsheetId')}>
            {sheetList ? (
              <Select
                id={fid('spreadsheetId')}
                value={draft.spreadsheetId}
                disabled={disabled || calendarOff}
                onChange={(e) => set('spreadsheetId', e.target.value)}
              >
                <option value="">{tc('spreadsheetNone')}</option>
                {draft.spreadsheetId && !sheetList.some((f) => f.id === draft.spreadsheetId) && (
                  <option value={draft.spreadsheetId}>{draft.spreadsheetId}</option>
                )}
                {sheetList.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </Select>
            ) : sheets.isError ? (
              <p className="text-xs text-muted-foreground">{tc('spreadsheetNoListing')}</p>
            ) : connected ? null : (
              connectFirst
            )}
          </Field>
          <Checkbox
            id={fid('createMeet')}
            checked={draft.createMeet}
            disabled={disabled || calendarOff}
            onChange={(e) => set('createMeet', e.target.checked)}
            label={tc('createMeet')}
            className="sm:col-span-2"
          />
        </div>
      </SectionCard>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums" dir="ltr">
        {value}
      </dd>
    </div>
  );
}
