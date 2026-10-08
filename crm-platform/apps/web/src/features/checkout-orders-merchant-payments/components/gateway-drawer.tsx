'use client';

import { useTranslations } from 'next-intl';
import { useId, useState, type FormEvent } from 'react';
import type { StoreGateway, StoreGatewayDriver, StoreGatewayField } from '@crm/contracts';
import {
  Alert,
  Button,
  Checkbox,
  Field,
  Input,
  PasswordInput,
  Select,
  Spinner,
  Switch,
  Textarea,
  useToast,
} from '@crm/ui';
import { useSaveGateway } from '../api/hooks';
import { fieldErrors } from '../lib/errors';
import {
  buildSaveBody,
  credentialErrorKey,
  initialForm,
  isDirty,
  isSecretField,
  storedCredential,
  validateForm,
  withClear,
  withValue,
  type GatewayFormState,
} from '../lib/gateway-form';
import { Drawer, Eyebrow, useErrorLine } from './parts';

/**
 * The configure panel of one gateway, generated from the driver's fields. Saved secrets are never shown: a stored field shows the
 * server's mask as its placeholder and "leave blank to keep it"; a "clear" box removes it. Only what was typed is sent.
 */
export function GatewayDrawer({
  driver,
  saved,
  storefrontId,
  scopeText,
  onClose,
}: {
  driver: StoreGatewayDriver;
  saved: StoreGateway | undefined;
  /** The shop of an override; undefined is the workspace row. */
  storefrontId: string | undefined;
  scopeText: string;
  onClose: () => void;
}) {
  const t = useTranslations('checkout-orders-merchant-payments.gateways');
  const common = useTranslations('checkout-orders-merchant-payments.common');
  const { toast } = useToast();
  const errorLine = useErrorLine();
  const save = useSaveGateway();
  const formId = useId();
  const [form, setForm] = useState<GatewayFormState>(() => initialForm(driver, saved));
  const [attempted, setAttempted] = useState(false);
  const [serverFields, setServerFields] = useState<Record<string, string>>({});
  const [serverLine, setServerLine] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const problems = validateForm(driver, saved, form);
  const problemByKey = new Map(problems.map((p) => [p.key, p.kind]));
  const dirty = isDirty(driver, saved, form);

  function submit(e: FormEvent) {
    e.preventDefault();
    setAttempted(true);
    setServerFields({});
    setServerLine(null);
    if (problems.length > 0) return;
    save.mutate(
      { slug: driver.slug, body: buildSaveBody(driver, saved, form, storefrontId) },
      {
        onSuccess: () => {
          toast(t('toast.saved'));
          onClose();
        },
        onError: (err) => {
          const raw = fieldErrors(err);
          const mapped: Record<string, string> = {};
          for (const [k, v] of Object.entries(raw)) mapped[credentialErrorKey(k)] = v;
          setServerFields(mapped);
          setServerLine(errorLine(err));
        },
      },
    );
  }

  async function copyWebhook() {
    if (!saved) return;
    try {
      await navigator.clipboard.writeText(saved.webhookUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  function errorFor(f: StoreGatewayField): string | undefined {
    if (attempted) {
      const kind = problemByKey.get(f.key);
      if (kind === 'required') return t('drawer.requiredField', { field: f.label });
      if (kind === 'option') return t('drawer.invalidOption', { field: f.label });
    }
    return serverFields[f.key];
  }

  return (
    <Drawer
      open
      onClose={onClose}
      eyebrow={t('drawer.eyebrow')}
      title={driver.name}
      closeLabel={common('close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
            {common('cancel')}
          </Button>
          <Button type="submit" form={formId} disabled={save.isPending || !dirty}>
            {save.isPending && <Spinner />}
            {save.isPending ? common('saving') : t('drawer.save')}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate autoComplete="off" className="space-y-5">
        <p className="text-sm text-muted-foreground">{driver.description}</p>
        <div className="rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
          {t('drawer.appliesTo', { scope: scopeText })}
        </div>

        {serverLine && <Alert tone="danger">{serverLine}</Alert>}

        <section aria-labelledby={`${formId}-creds`} className="space-y-4">
          <Eyebrow>
            <span id={`${formId}-creds`}>{t('drawer.credentials')}</span>
          </Eyebrow>
          {driver.fields.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('drawer.noFields')}</p>
          ) : (
            <>
              {saved && <p className="text-xs text-muted-foreground">{t('drawer.secretsNote')}</p>}
              {driver.fields.map((f) => (
                <CredentialField
                  key={f.key}
                  field={f}
                  saved={saved}
                  form={form}
                  error={errorFor(f)}
                  onChange={(v) => setForm((cur) => withValue(cur, f.key, v))}
                  onClear={(on) => setForm((cur) => withClear(cur, f.key, on))}
                />
              ))}
            </>
          )}
        </section>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t('drawer.mode')}</legend>
          <div className="flex flex-wrap gap-4">
            {(['test', 'live'] as const).map((m) => (
              <label key={m} className="inline-flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="radio"
                  name={`${formId}-mode`}
                  value={m}
                  checked={form.mode === m}
                  onChange={() => setForm((cur) => ({ ...cur, mode: m }))}
                  className="size-4 accent-[var(--primary)]"
                />
                {m === 'live' ? t('mode.live') : t('mode.test')}
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{t('drawer.modeHint')}</p>
        </fieldset>

        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-sm font-medium" id={`${formId}-active`}>
              {t('drawer.active')}
            </div>
            <p className="text-xs text-muted-foreground">{t('drawer.activeHint')}</p>
          </div>
          <Switch
            checked={form.active}
            onCheckedChange={(v) => setForm((cur) => ({ ...cur, active: v }))}
            label={t('drawer.active')}
          />
        </div>

        <section className="space-y-1.5 rounded-lg border border-border bg-muted/40 p-3">
          <div className="text-sm font-medium">{t('drawer.webhookTitle')}</div>
          {saved ? (
            <>
              <p className="text-xs text-muted-foreground">
                {t('drawer.webhookHint', { name: driver.name })}
              </p>
              <div className="flex items-center gap-2">
                <code
                  className="min-w-0 flex-1 select-all break-all rounded bg-background px-2 py-1.5 font-mono text-xs"
                  dir="ltr"
                >
                  {saved.webhookUrl}
                </code>
                <Button size="sm" variant="secondary" onClick={() => void copyWebhook()}>
                  {copied ? common('copied') : common('copy')}
                </Button>
              </div>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">{t('drawer.webhookAfterSave')}</p>
          )}
        </section>
      </form>
    </Drawer>
  );
}

function CredentialField({
  field,
  saved,
  form,
  error,
  onChange,
  onClear,
}: {
  field: StoreGatewayField;
  saved: StoreGateway | undefined;
  form: GatewayFormState;
  error: string | undefined;
  onChange: (value: string) => void;
  onClear: (on: boolean) => void;
}) {
  const t = useTranslations('checkout-orders-merchant-payments.gateways.drawer');
  const id = useId();
  const stored = storedCredential(saved, field.key);
  const hasValue = stored?.hasValue === true;
  const clearing = form.clear.includes(field.key);
  const value = form.values[field.key] ?? '';
  const secret = isSecretField(field);

  // The mask is a hint about what is saved; it is never put in the box as a value.
  const placeholder = hasValue && stored?.masked ? stored.masked : '';
  const common = {
    id,
    value,
    placeholder,
    disabled: clearing,
    invalid: !!error,
    autoComplete: 'new-password',
    spellCheck: false,
    onChange: (e: { target: { value: string } }) => onChange(e.target.value),
    'aria-required': field.required || undefined,
    dir: 'ltr' as const,
  };

  const hint = hasValue ? (clearing ? t('willClear') : t('keepBlank')) : field.hint;

  return (
    <Field
      htmlFor={id}
      label={
        <span>
          {field.label}
          {field.required && (
            <span className="ms-0.5 text-danger" aria-hidden="true">
              *
            </span>
          )}
          {field.required && <span className="sr-only"> {t('requiredMark')}</span>}
        </span>
      }
      hint={
        <>
          {hasValue && stored?.masked && (
            <span className="block font-mono" dir="ltr">
              {t('stored', { mask: stored.masked })}
            </span>
          )}
          {hint}
        </>
      }
      error={error}
    >
      {field.type === 'textarea' ? (
        <Textarea {...common} rows={4} />
      ) : field.type === 'select' ? (
        <Select
          id={id}
          value={value}
          disabled={clearing}
          invalid={!!error}
          onChange={(e) => onChange(e.target.value)}
          aria-required={field.required || undefined}
        >
          <option value="">{hasValue ? t('keepOption') : t('chooseOption')}</option>
          {(field.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </Select>
      ) : secret || field.type === 'password' ? (
        <PasswordInput {...common} showLabel={t('show')} hideLabel={t('hide')} />
      ) : (
        <Input {...common} />
      )}
      {hasValue && (
        <Checkbox
          id={`${id}-clear`}
          className="mt-1.5 text-xs text-muted-foreground"
          label={t('clear')}
          checked={clearing}
          onChange={(e) => onClear(e.target.checked)}
        />
      )}
    </Field>
  );
}
