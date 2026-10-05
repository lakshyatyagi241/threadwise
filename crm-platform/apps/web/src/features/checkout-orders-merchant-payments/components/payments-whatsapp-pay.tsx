'use client';

import { useTranslations } from 'next-intl';
import { useId, useState, type FormEvent } from 'react';
import type { WhatsappPayConfig } from '@crm/contracts';
import {
  Alert,
  Button,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  Select,
  Spinner,
  Switch,
  useToast,
} from '@crm/ui';
import { useDeleteWhatsappPay, useSaveWhatsappPay, useWhatsappPayConfigs } from '../api/hooks';
import { fieldErrors } from '../lib/errors';
import {
  CONFIG_NAME_MAX,
  WA_PAY_TYPES,
  buildWaPayBody,
  emptyWaPayForm,
  formFromConfig,
  isExistingName,
  isWaPayType,
  validateWaPay,
  type WaPayForm,
} from '../lib/payments-whatsapp';
import { ToneBadge, ErrorPanel, Eyebrow, Skeleton, useErrorLine } from './parts';

/**
 * WhatsApp Pay (Reference's whole /store/payments page): the names of the Direct Pay Methods the merchant made in WhatsApp Manager and
 * the gateway behind each. Only India is supported by Meta, so country and currency are fixed and said so.
 */
export function PaymentsWhatsappPay({ canManage }: { canManage: boolean }) {
  const t = useTranslations('checkout-orders-merchant-payments.payments.wa');
  const configs = useWhatsappPayConfigs();
  const [editing, setEditing] = useState<WhatsappPayConfig | null>(null);
  const [removing, setRemoving] = useState<WhatsappPayConfig | null>(null);

  return (
    <section aria-labelledby="wa-pay-title" className="space-y-4" id="whatsapp-pay">
      <div>
        <h2 id="wa-pay-title" className="text-lg font-semibold">
          {t('title')}
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{t('intro')}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t('indiaOnly')}</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {canManage ? (
          <WaPayForm
            // A new form per edited row, so the fields start from it.
            key={editing?.id ?? 'new'}
            editing={editing}
            configs={configs.data?.data ?? []}
            onDone={() => setEditing(null)}
          />
        ) : (
          <Alert tone="info" className="lg:col-span-1">
            {t('viewOnly')}
          </Alert>
        )}
        <div className="rounded-xl border border-border bg-muted/40 p-4 text-sm">
          <h3 className="font-semibold">{t('howTitle')}</h3>
          <ol className="mt-2 list-decimal space-y-1.5 ps-5 text-muted-foreground">
            <li>{t('how1')}</li>
            <li>{t('how2')}</li>
            <li>{t('how3')}</li>
            <li>{t('how4')}</li>
          </ol>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-background">
        <div className="border-b border-border px-4 py-2.5">
          <Eyebrow>{t('listTitle')}</Eyebrow>
        </div>
        {configs.isPending ? (
          <div role="status" aria-label={t('loading')} className="space-y-2 p-4">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        ) : configs.isError ? (
          <div className="p-4">
            <ErrorPanel error={configs.error} onRetry={() => void configs.refetch()} />
          </div>
        ) : configs.data.data.length === 0 ? (
          <EmptyState
            className="m-4"
            title={t('emptyTitle')}
            message={canManage ? t('emptyMessage') : t('emptyMessageReadOnly')}
          />
        ) : (
          <ul className="divide-y divide-border" data-testid="wa-pay-list">
            {configs.data.data.map((c) => (
              <WaPayRow
                key={c.id}
                config={c}
                canManage={canManage}
                onEdit={() => setEditing(c)}
                onRemove={() => setRemoving(c)}
              />
            ))}
          </ul>
        )}
      </div>

      {removing && <RemoveConfirm config={removing} onClose={() => setRemoving(null)} />}
    </section>
  );
}

function WaPayRow({
  config,
  canManage,
  onEdit,
  onRemove,
}: {
  config: WhatsappPayConfig;
  canManage: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const t = useTranslations('checkout-orders-merchant-payments.payments.wa');
  const common = useTranslations('checkout-orders-merchant-payments.common');
  const typeLabel = isWaPayType(config.paymentType)
    ? typeName(t, config.paymentType)
    : config.paymentType;
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3" data-testid="wa-pay-row">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{config.configName}</div>
        <div className="text-xs text-muted-foreground">
          {typeLabel} · {t('market')}
          {config.autoCharge ? ` · ${t('autoChargeOn')}` : ''}
        </div>
      </div>
      <ToneBadge tone={config.isActive ? 'success' : 'neutral'}>
        {config.isActive ? t('active') : t('off')}
      </ToneBadge>
      {canManage && (
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={onEdit}>
            {common('edit')}
          </Button>
          <Button size="sm" variant="ghost" className="text-danger" onClick={onRemove}>
            {common('remove')}
          </Button>
        </div>
      )}
    </li>
  );
}

/** The four gateway names as written on the form and the list. */
function typeName(
  t: ReturnType<typeof useTranslations>,
  type: (typeof WA_PAY_TYPES)[number],
): string {
  switch (type) {
    case 'razorpay':
      return t('types.razorpay');
    case 'payu':
      return t('types.payu');
    case 'billdesk':
      return t('types.billdesk');
    case 'zaakpay':
      return t('types.zaakpay');
  }
}

function WaPayForm({
  editing,
  configs,
  onDone,
}: {
  editing: WhatsappPayConfig | null;
  configs: readonly WhatsappPayConfig[];
  onDone: () => void;
}) {
  const t = useTranslations('checkout-orders-merchant-payments.payments.wa');
  const common = useTranslations('checkout-orders-merchant-payments.common');
  const { toast } = useToast();
  const errorLine = useErrorLine();
  const save = useSaveWhatsappPay();
  const id = useId();
  const [form, setForm] = useState<WaPayForm>(() =>
    editing ? formFromConfig(editing) : emptyWaPayForm(),
  );
  const [attempted, setAttempted] = useState(false);
  const [serverName, setServerName] = useState<string | null>(null);
  const [serverLine, setServerLine] = useState<string | null>(null);

  const nameProblem = validateWaPay(form);
  const updatesExisting = !editing && isExistingName(configs, form.configName);

  function submit(e: FormEvent) {
    e.preventDefault();
    setAttempted(true);
    setServerName(null);
    setServerLine(null);
    if (nameProblem) return;
    save.mutate(buildWaPayBody(form), {
      onSuccess: () => {
        toast(t('toast.saved'));
        setForm(emptyWaPayForm());
        setAttempted(false);
        onDone();
      },
      onError: (err) => {
        setServerName(fieldErrors(err).configName ?? null);
        setServerLine(errorLine(err));
      },
    });
  }

  return (
    <form
      onSubmit={submit}
      noValidate
      className="space-y-4 rounded-xl border border-border bg-background p-4"
      aria-label={editing ? t('editTitle', { name: editing.configName }) : t('addTitle')}
    >
      <h3 className="font-semibold">
        {editing ? t('editTitle', { name: editing.configName }) : t('addTitle')}
      </h3>
      {serverLine && <Alert tone="danger">{serverLine}</Alert>}
      <Field
        label={t('name')}
        htmlFor={`${id}-name`}
        hint={editing ? t('nameLocked') : updatesExisting ? t('updatesExisting') : t('nameHint')}
        error={
          attempted && nameProblem
            ? t('nameInvalid', { max: CONFIG_NAME_MAX })
            : (serverName ?? undefined)
        }
      >
        <Input
          id={`${id}-name`}
          value={form.configName}
          maxLength={CONFIG_NAME_MAX}
          readOnly={!!editing}
          placeholder={t('namePlaceholder')}
          invalid={attempted && !!nameProblem}
          autoComplete="off"
          dir="ltr"
          onChange={(e) => setForm((f) => ({ ...f, configName: e.target.value }))}
        />
      </Field>
      <Field label={t('gateway')} htmlFor={`${id}-type`}>
        <Select
          id={`${id}-type`}
          value={form.paymentType}
          onChange={(e) =>
            setForm((f) => ({ ...f, paymentType: e.target.value as WaPayForm['paymentType'] }))
          }
        >
          {WA_PAY_TYPES.map((p) => (
            <option key={p} value={p}>
              {typeName(t, p)}
            </option>
          ))}
        </Select>
      </Field>
      <div className="flex items-center justify-between gap-4">
        <span className="text-sm font-medium">{t('activeLabel')}</span>
        <Switch
          checked={form.isActive}
          onCheckedChange={(v) => setForm((f) => ({ ...f, isActive: v }))}
          label={t('activeLabel')}
        />
      </div>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm font-medium">{t('autoCharge')}</div>
          <p className="text-xs text-muted-foreground">{t('autoChargeHint')}</p>
        </div>
        <Switch
          checked={form.autoCharge}
          onCheckedChange={(v) => setForm((f) => ({ ...f, autoCharge: v }))}
          label={t('autoCharge')}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={save.isPending}>
          {save.isPending && <Spinner />}
          {save.isPending ? common('saving') : t('save')}
        </Button>
        {editing && (
          <Button variant="secondary" onClick={onDone} disabled={save.isPending}>
            {t('cancelEdit')}
          </Button>
        )}
      </div>
    </form>
  );
}

function RemoveConfirm({ config, onClose }: { config: WhatsappPayConfig; onClose: () => void }) {
  const t = useTranslations('checkout-orders-merchant-payments.payments.wa');
  const common = useTranslations('checkout-orders-merchant-payments.common');
  const { toast } = useToast();
  const errorLine = useErrorLine();
  const del = useDeleteWhatsappPay();
  return (
    <ConfirmDialog
      open
      tone="danger"
      title={t('removeTitle', { name: config.configName })}
      message={t('removeMessage')}
      confirmLabel={t('removeConfirm')}
      cancelLabel={common('cancel')}
      busy={del.isPending}
      onClose={onClose}
      onConfirm={() =>
        del.mutate(config.id, {
          onSuccess: () => {
            toast(t('toast.removed'));
            onClose();
          },
          onError: (e) => {
            toast(errorLine(e), 'danger');
            onClose();
          },
        })
      }
    />
  );
}
