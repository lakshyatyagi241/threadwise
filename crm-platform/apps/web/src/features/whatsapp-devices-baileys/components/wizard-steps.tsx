'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Alert, Checkbox, Field, Input, Spinner, cn } from '@crm/ui';
import {
  PhoneField,
  type PhoneValue,
} from '@/features/auth-registration-security/shared/phone-field';
import type { PairingMethod } from '@crm/contracts';
import { RiskNotice } from './risk-notice';
import { ErrorNotice } from './error-notice';
import type { ErrorText } from './use-error-text';
import type { failureKind } from '../lib/pairing-model';
import {
  allAcknowledged,
  numberProblems,
  tick,
  type Acks,
  type WizardDraft,
} from '../lib/wizard-model';

const NS = 'whatsapp-devices-baileys.wizard';

/** Step 1: the risk notice and the three acknowledgements (spec 6.1). The button stays disabled until all three are ticked. */
export function NoticeStep({
  version,
  acks,
  onAcks,
  busy,
  error,
}: {
  version: string;
  acks: Acks;
  onAcks: (acks: Acks) => void;
  busy: boolean;
  error: ErrorText | null;
}) {
  const t = useTranslations('whatsapp-devices-baileys.notice');
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold">{t('title')}</h3>
        <p className="text-sm text-muted-foreground">{t('intro')}</p>
      </div>
      <RiskNotice version={version} acks={acks} onTick={(i, v) => onAcks(tick(acks, i, v))} />
      {!allAcknowledged(acks) && !busy && (
        <p className="text-xs text-muted-foreground" data-testid="must-tick">
          {t('mustTick')}
        </p>
      )}
      {error && <ErrorNotice error={error} />}
    </div>
  );
}

/** Step 2: name and number. The number is typed first because the link is checked against it (spec 8.4). */
export function NumberStep({
  draft,
  onDraft,
  showProblems,
  error,
  existingHref,
}: {
  draft: WizardDraft;
  onDraft: (patch: Partial<WizardDraft>) => void;
  /** Show the field messages (after the first Continue, or once a field was touched). */
  showProblems: boolean;
  error: ErrorText | null;
  /** When the server says the number already exists: where the existing one is. */
  existingHref: string | null;
}) {
  const t = useTranslations(`${NS}.number`);
  const tw = useTranslations(NS);
  const p = numberProblems(draft);
  const onPhone = (v: PhoneValue) =>
    onDraft({ e164: v.e164, phoneInvalid: !v.empty && v.problem !== null });
  return (
    <div className="space-y-4">
      <h3 className="text-base font-semibold">{t('title')}</h3>
      <Field
        label={t('name')}
        htmlFor="wadev-name"
        hint={t('nameHelp')}
        error={showProblems && p.name ? t(`nameError.${p.name}`) : undefined}
      >
        <Input
          id="wadev-name"
          value={draft.name}
          maxLength={191}
          placeholder={t('namePlaceholder')}
          invalid={showProblems && p.name !== null}
          onChange={(e) => onDraft({ name: e.target.value })}
          autoComplete="off"
        />
      </Field>
      <Field
        label={t('phone')}
        htmlFor="wadev-phone"
        hint={t('phoneHelp')}
        error={showProblems && p.phone ? t(`phoneError.${p.phone}`) : undefined}
      >
        <PhoneField
          id="wadev-phone"
          onChange={onPhone}
          invalid={showProblems && p.phone !== null}
        />
      </Field>
      <div>
        <Checkbox
          id="wadev-activate"
          checked={draft.activateAfterPairing}
          onChange={(e) => onDraft({ activateAfterPairing: e.target.checked })}
          label={t('activate')}
        />
        <p className="ms-6 mt-1 text-xs text-muted-foreground">{t('activateHelp')}</p>
      </div>
      {error && (
        <div className="space-y-1">
          <ErrorNotice error={error} />
          {existingHref && (
            <Link href={existingHref} className="text-sm underline">
              {tw('number.openExisting')}
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

/** Step 3, before the start: pick QR or pairing code. The code needs the country code and carries the take-over warning. */
export function MethodChoice({
  phoneLabel,
  method,
  onMethod,
  codeAllowed,
}: {
  phoneLabel: string;
  method: PairingMethod;
  onMethod: (m: PairingMethod) => void;
  codeAllowed: boolean;
}) {
  const t = useTranslations(`${NS}.link`);
  const options: Array<{ id: PairingMethod; title: string; help: string; disabled: boolean }> = [
    { id: 'qr', title: t('qr'), help: t('qrHelp'), disabled: false },
    { id: 'code', title: t('code'), help: t('codeHelp'), disabled: !codeAllowed },
  ];
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold">{t('title')}</h3>
        <p className="text-sm text-muted-foreground" dir="auto">
          {t('numberLine', { phone: phoneLabel })}
        </p>
      </div>
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium">{t('choose')}</legend>
        <div role="radiogroup" aria-label={t('methodLabel')} className="grid gap-2 sm:grid-cols-2">
          {options.map((o) => (
            <label
              key={o.id}
              className={cn(
                'flex cursor-pointer items-start gap-2 rounded-md border p-3 text-sm',
                method === o.id ? 'border-primary bg-primary/5' : 'border-border',
                o.disabled && 'cursor-not-allowed opacity-60',
              )}
            >
              <input
                type="radio"
                name="wadev-method"
                className="mt-0.5 size-4 accent-[var(--primary)]"
                checked={method === o.id}
                disabled={o.disabled}
                onChange={() => onMethod(o.id)}
              />
              <span>
                <span className="block font-medium">{o.title}</span>
                <span className="block text-xs text-muted-foreground">{o.help}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {!codeAllowed && (
        <p className="text-xs text-muted-foreground" data-testid="need-country-code">
          {t('needCountryCode')}
        </p>
      )}
      {method === 'code' && (
        <Alert tone="warning" data-testid="code-warning">
          {t('someoneElse')}
        </Alert>
      )}
    </div>
  );
}

type Failure = ReturnType<typeof failureKind>;
export type Outcome =
  { kind: 'connected' } | { kind: 'failure'; failure: Failure; reason: string | null };

/** Step 4: connected, or the ending in words (timed out, phone offline, logged out, session replaced...). Never says "banned". */
export function ResultStep({
  outcome,
  phoneLabel,
  warmerHref,
  inboxHref,
  importHref = null,
}: {
  outcome: Outcome;
  phoneLabel: string;
  warmerHref: string;
  inboxHref: string;
  /** Where the import's progress is shown; set only when the person chose to import. */
  importHref?: string | null;
}) {
  const t = useTranslations(`${NS}.result`);
  const th = useTranslations('whatsapp-devices-baileys.history.result');
  if (outcome.kind === 'connected') {
    return (
      <div className="space-y-3" data-testid="result-connected" role="status">
        <h3 className="text-base font-semibold text-success">{t('connectedTitle')}</h3>
        <p className="text-sm" dir="auto">
          {t('connectedBody', { phone: phoneLabel })}
        </p>
        {importHref && (
          <p className="text-sm" data-testid="result-import">
            {th('note')}{' '}
            <Link href={importHref} className="font-medium underline">
              {th('link')}
            </Link>
          </p>
        )}
        <div className="flex flex-wrap gap-3 text-sm">
          <Link href={warmerHref} className="font-medium underline">
            {t('warmer')}
          </Link>
          <Link href={inboxHref} className="font-medium underline">
            {t('inbox')}
          </Link>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-3" data-testid={`result-${outcome.failure}`} role="alert">
      <h3 className="text-base font-semibold">{t(`${outcome.failure}Title`)}</h3>
      <p className="text-sm text-muted-foreground">{t(`${outcome.failure}Body`)}</p>
      {outcome.failure === 'timedOut' && (
        <p className="text-sm text-muted-foreground">{t('phoneOfflineBody')}</p>
      )}
    </div>
  );
}

/** A busy line used while the start call waits for WhatsApp's first QR (up to about 35 seconds). */
export function Starting({ label }: { label: string }) {
  return (
    <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
      <Spinner label={label} /> {label}
    </p>
  );
}
