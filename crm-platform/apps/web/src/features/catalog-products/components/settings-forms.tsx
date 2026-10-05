'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Checkbox, Field, Input, Spinner, cn, useToast } from '@crm/ui';
import type { CatalogSummary } from '@crm/contracts';
import { KEYS, saveAutomation, saveCommerce } from '../api/catalog';
import { fieldErrors } from '../lib/errors';
import {
  automationForm,
  automationProblems,
  buildAutomation,
  type AutomationField,
  type AutomationForm as AutoForm,
} from '../lib/setup-forms';
import { CARD, ErrorLine, KICKER } from './parts';
import { useErrorText } from './use-error-text';

/** The two commerce switches pushed to Meta for the bound phone number (WD-CAT-005). */
export function CommerceForm({
  catalog,
  canManage,
}: {
  catalog: CatalogSummary;
  canManage: boolean;
}) {
  const t = useTranslations('catalogProducts.commerce');
  const errorText = useErrorText();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [visible, setVisible] = useState(catalog.isCatalogVisible);
  const [cart, setCart] = useState(catalog.isCartEnabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await saveCommerce({ isCatalogVisible: visible, isCartEnabled: cart });
      toast(t('saved'), 'success');
      await qc.invalidateQueries({ queryKey: KEYS.overview });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className={cn(CARD, 'p-5')}>
      <h3 className={`${KICKER} mb-3 font-normal`}>{t('title')}</h3>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Checkbox
          id="cat-visible"
          checked={visible}
          disabled={!canManage}
          onChange={(e) => setVisible(e.target.checked)}
          label={
            <span>
              <span className="block font-semibold">{t('visible')}</span>
              <span className="text-[10.5px] text-muted-foreground">{t('visibleHint')}</span>
            </span>
          }
        />
        <Checkbox
          id="cat-cart"
          checked={cart}
          disabled={!canManage}
          onChange={(e) => setCart(e.target.checked)}
          label={
            <span>
              <span className="block font-semibold">{t('cart')}</span>
              <span className="text-[10.5px] text-muted-foreground">{t('cartHint')}</span>
            </span>
          }
        />
      </div>
      {error ? <ErrorLine className="mt-3">{errorText(error)}</ErrorLine> : null}
      {canManage && (
        <div className="mt-4 flex justify-end border-t border-border pt-3">
          <Button type="submit" variant="brand" className="rounded-full px-4" disabled={busy}>
            {busy && <Spinner />}
            {t('save')}
          </Button>
        </div>
      )}
    </form>
  );
}

const SMALL_LABEL =
  'font-mono text-[10.5px] font-normal uppercase tracking-[0.12em] text-muted-foreground';

/** Cart-order acknowledgement and the inbound concierge (WD-CAT-006). The settings are replaced wholesale on each save. */
export function AutomationForm({
  catalog,
  canManage,
}: {
  catalog: CatalogSummary;
  canManage: boolean;
}) {
  const t = useTranslations('catalogProducts.automation');
  const errorText = useErrorText();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState<AutoForm>(() => automationForm(catalog.automation));
  const [picked, setPicked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const patch = (p: Partial<AutoForm>) => setForm((f) => ({ ...f, ...p }));

  const problems = automationProblems(form);
  const server = fieldErrors(error);
  const fieldError = (k: AutomationField): string | undefined =>
    picked && problems[k] ? t(`problem.${problems[k]}`) : server[k];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPicked(true);
    setError(null);
    if (Object.keys(problems).length > 0) return;
    setBusy(true);
    try {
      await saveAutomation(buildAutomation(form));
      toast(t('saved'), 'success');
      await qc.invalidateQueries({ queryKey: KEYS.overview });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className={cn(CARD, 'p-5')}>
      <h3 className={`${KICKER} mb-3 font-normal`}>{t('title')}</h3>

      <fieldset disabled={!canManage} className="space-y-3">
        <div className="rounded-xl border border-border p-4">
          <Checkbox
            id="cat-ack"
            checked={form.orderAckEnabled}
            onChange={(e) => patch({ orderAckEnabled: e.target.checked })}
            label={
              <span>
                <span className="block font-semibold">{t('ack')}</span>
                <span className="text-[10.5px] text-muted-foreground">{t('ackHint')}</span>
              </span>
            }
          />
          <Field
            className="mt-3"
            label={<span className={SMALL_LABEL}>{t('payUrl')}</span>}
            htmlFor="cat-pay-url"
            hint={t('payUrlHint')}
            error={fieldError('orderAckPayUrl')}
          >
            <Input
              id="cat-pay-url"
              type="url"
              value={form.orderAckPayUrl}
              placeholder="https://pay.example.com/checkout"
              invalid={Boolean(fieldError('orderAckPayUrl'))}
              className="text-[12.5px]"
              onChange={(e) => patch({ orderAckPayUrl: e.target.value })}
            />
          </Field>
        </div>

        <div className="rounded-xl border border-border p-4">
          <Checkbox
            id="cat-concierge"
            checked={form.conciergeEnabled}
            onChange={(e) => patch({ conciergeEnabled: e.target.checked })}
            label={
              <span>
                <span className="block font-semibold">{t('concierge')}</span>
                <span className="text-[10.5px] text-muted-foreground">{t('conciergeHint')}</span>
              </span>
            }
          />
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field
              className="sm:col-span-2"
              label={<span className={SMALL_LABEL}>{t('header')}</span>}
              htmlFor="cat-concierge-header"
              error={fieldError('conciergeHeader')}
            >
              <Input
                id="cat-concierge-header"
                value={form.conciergeHeader}
                maxLength={60}
                placeholder={t('headerPlaceholder')}
                className="text-[12.5px]"
                onChange={(e) => patch({ conciergeHeader: e.target.value })}
              />
            </Field>
            <Field
              label={<span className={SMALL_LABEL}>{t('max')}</span>}
              htmlFor="cat-concierge-max"
              error={fieldError('conciergeMax')}
            >
              <Input
                id="cat-concierge-max"
                type="number"
                min={1}
                max={30}
                value={form.conciergeMax}
                invalid={Boolean(fieldError('conciergeMax'))}
                className="text-[12.5px]"
                onChange={(e) => patch({ conciergeMax: e.target.value })}
              />
            </Field>
          </div>
          <Checkbox
            id="cat-concierge-empty"
            className="mt-3"
            checked={form.conciergeReplyOnEmpty}
            onChange={(e) => patch({ conciergeReplyOnEmpty: e.target.checked })}
            label={
              <span>
                <span className="block font-semibold">{t('replyOnEmpty')}</span>
                <span className="text-[10.5px] text-muted-foreground">{t('replyOnEmptyHint')}</span>
              </span>
            }
          />
          <Field
            className="mt-3"
            label={<span className={SMALL_LABEL}>{t('emptyText')}</span>}
            htmlFor="cat-concierge-empty-text"
            error={fieldError('conciergeEmptyText')}
          >
            <Input
              id="cat-concierge-empty-text"
              value={form.conciergeEmptyText}
              maxLength={1024}
              placeholder={t('emptyTextPlaceholder')}
              className="text-[12.5px]"
              onChange={(e) => patch({ conciergeEmptyText: e.target.value })}
            />
          </Field>
        </div>
      </fieldset>

      {error && Object.keys(server).length === 0 ? (
        <ErrorLine className="mt-3">{errorText(error)}</ErrorLine>
      ) : null}
      {canManage && (
        <div className="mt-4 flex justify-end border-t border-border pt-3">
          <Button type="submit" variant="brand" className="rounded-full px-4" disabled={busy}>
            {busy && <Spinner />}
            {t('save')}
          </Button>
        </div>
      )}
    </form>
  );
}
