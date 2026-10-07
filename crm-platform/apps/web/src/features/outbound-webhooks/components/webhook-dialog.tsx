'use client';

import { useId, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import {
  WEBHOOK_ALL,
  WEBHOOK_NAME_MAX,
  WEBHOOK_SECRET_MAX,
  WEBHOOK_URL_MAX,
  type WebhookResponse,
} from '@crm/contracts';
import {
  Alert,
  Button,
  Checkbox,
  Field,
  Input,
  Modal,
  PasswordInput,
  Spinner,
  Switch,
} from '@crm/ui';
import { webhooksApi } from '../api/webhooks';
import { eventsForSave, urlProblem } from '../lib/model';

/** Add or change an endpoint. The secret is write-only: an existing one is shown as "set" and replaced or removed, never displayed. */
export function WebhookDialog({
  open,
  webhook,
  events,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** The endpoint being changed; absent for a new one. */
  webhook?: WebhookResponse;
  events: readonly string[];
  onClose: () => void;
  onSaved: (saved: WebhookResponse, created: boolean) => void;
}) {
  const t = useTranslations('outbound-webhooks.dialog');
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={webhook ? t('editTitle') : t('addTitle')}
      closeLabel={t('close')}
    >
      {open && (
        <Form
          key={webhook?.id ?? 'new'}
          webhook={webhook}
          events={events}
          onClose={onClose}
          onSaved={onSaved}
        />
      )}
    </Modal>
  );
}

function Form({
  webhook,
  events,
  onClose,
  onSaved,
}: {
  webhook?: WebhookResponse;
  events: readonly string[];
  onClose: () => void;
  onSaved: (saved: WebhookResponse, created: boolean) => void;
}) {
  const t = useTranslations('outbound-webhooks.dialog');
  const te = useTranslations('outbound-webhooks.events');
  const uid = useId();
  const [name, setName] = useState(webhook?.name ?? '');
  const [url, setUrl] = useState(webhook?.url ?? '');
  const [secret, setSecret] = useState('');
  const [removeSecret, setRemoveSecret] = useState(false);
  const [active, setActive] = useState(webhook?.active ?? true);
  const [all, setAll] = useState(!webhook || webhook.events.includes(WEBHOOK_ALL));
  const [picked, setPicked] = useState<string[]>(
    webhook && !webhook.events.includes(WEBHOOK_ALL) ? [...webhook.events] : [],
  );
  const [showProblems, setShowProblems] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const problem = urlProblem(url);
  const noEvents = !all && picked.length === 0;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setShowProblems(true);
    setServerError(null);
    if (problem || noEvents) return;
    setBusy(true);
    try {
      const evs = all ? [WEBHOOK_ALL] : eventsForSave(picked, events);
      const saved = webhook
        ? await webhooksApi.update(webhook.id, {
            name: name.trim() === '' ? null : name.trim(),
            url: url.trim(),
            events: evs as never,
            active,
            ...(secret ? { secret } : {}),
            ...(removeSecret && !secret ? { clearSecret: true } : {}),
          })
        : await webhooksApi.create({
            ...(name.trim() ? { name: name.trim() } : {}),
            url: url.trim(),
            events: evs as never,
            active,
            ...(secret ? { secret } : {}),
          });
      onSaved(saved, !webhook);
      onClose();
    } catch (err) {
      setServerError(describe(err, t('failed')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-4" noValidate>
      {serverError && <Alert tone="danger">{serverError}</Alert>}
      <Field label={t('name')} htmlFor={`${uid}-name`} hint={t('nameHint')}>
        <Input
          id={`${uid}-name`}
          value={name}
          maxLength={WEBHOOK_NAME_MAX}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field
        label={`${t('url')} *`}
        htmlFor={`${uid}-url`}
        hint={t('urlHint')}
        error={showProblems && problem ? t(`urlProblem.${problem}`) : undefined}
      >
        <Input
          id={`${uid}-url`}
          type="url"
          inputMode="url"
          dir="ltr"
          value={url}
          maxLength={WEBHOOK_URL_MAX}
          placeholder="https://example.com/webhooks/geta"
          invalid={showProblems && problem !== null}
          onChange={(e) => setUrl(e.target.value)}
        />
      </Field>
      <Field
        label={t('secret')}
        htmlFor={`${uid}-secret`}
        hint={webhook?.hasSecret && !removeSecret ? t('secretSetHint') : t('secretHint')}
      >
        <PasswordInput
          id={`${uid}-secret`}
          value={secret}
          maxLength={WEBHOOK_SECRET_MAX}
          autoComplete="off"
          placeholder={webhook?.hasSecret && !removeSecret ? t('secretKeep') : ''}
          onChange={(e) => setSecret(e.target.value)}
        />
      </Field>
      {webhook?.hasSecret && (
        <Checkbox
          id={`${uid}-rm`}
          label={t('removeSecret')}
          checked={removeSecret}
          onChange={(e) => setRemoveSecret(e.target.checked)}
        />
      )}

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t('events')}</legend>
        <Checkbox
          id={`${uid}-all`}
          label={t('allEvents')}
          checked={all}
          onChange={(e) => setAll(e.target.checked)}
        />
        {!all && (
          <div className="grid gap-2 ps-6 sm:grid-cols-2">
            {events.map((ev) => (
              <Checkbox
                key={ev}
                id={`${uid}-${ev}`}
                label={te(ev)}
                checked={picked.includes(ev)}
                onChange={(e) =>
                  setPicked((p) => (e.target.checked ? [...p, ev] : p.filter((x) => x !== ev)))
                }
              />
            ))}
          </div>
        )}
        {showProblems && noEvents && (
          <p role="alert" className="text-xs text-danger">
            {t('pickEvents')}
          </p>
        )}
      </fieldset>

      <div className="flex items-center gap-3">
        <Switch checked={active} onCheckedChange={setActive} label={t('active')} />
        <span className="text-sm">{t('active')}</span>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="secondary" onClick={onClose}>
          {t('cancel')}
        </Button>
        <Button type="submit" disabled={busy}>
          {busy && <Spinner />}
          {webhook ? t('save') : t('create')}
        </Button>
      </div>
    </form>
  );
}

/** The API's own sentence when it sent one (a refused address, a plan limit), else the generic one. */
function describe(err: unknown, fallback: string): string {
  const e = err as { detail?: string; message?: string; problem?: { detail?: string } };
  return e?.problem?.detail ?? e?.detail ?? fallback;
}
