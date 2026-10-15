'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import {
  CONSENT_CHANNELS,
  type ConsentAction,
  type ConsentChannel,
  type ConsentEvent,
  type ContactConsent,
} from '@crm/contracts';
import { Alert, Badge, Button, Field, Modal, Select, Spinner, Textarea, useToast } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { KEYS, useContactConsent } from '../api/hooks';
import { consentApi, consentExportUrl } from '../api/service';
import { errorKey } from '../lib/errors';

type Status = 'optedOut' | 'subscribed' | 'none';

/** The one-line status a person reads first: opted out beats subscribed beats nothing recorded. */
export function consentStatus(c: Pick<ContactConsent, 'optedOut' | 'states'>): Status {
  if (c.optedOut) return 'optedOut';
  return c.states.some((s) => s.purpose === 'marketing' && s.state === 'granted')
    ? 'subscribed'
    : 'none';
}

const TONE = { optedOut: 'danger', subscribed: 'success', none: 'neutral' } as const;

/**
 * A grant for SERVICE messages (purpose `utility`: the person agreed to be contacted about their request, BL-171) is not a marketing
 * subscription and must never read like one, so it has its own words beside the marketing ones.
 */
const stateKey = (purpose: string, state: 'granted' | 'withdrawn' | 'unknown') =>
  purpose === 'utility'
    ? (`state.utility${state === 'granted' ? 'Granted' : 'Withdrawn'}` as const)
    : (`state.${state}` as const);
const actionKey = (purpose: string, action: ConsentAction) =>
  purpose === 'utility'
    ? (`action.utility${action === 'granted' ? 'Granted' : 'Withdrawn'}` as const)
    : (`action.${action}` as const);

/**
 * The Consent card of a contact: who agreed or opted out, when, from where, on which channel, with the proof, and the two
 * buttons to record a change (a grant needs a reason). Hidden without `contacts.consent.read`.
 */
export function ConsentCard({
  contactId,
  onChanged,
}: {
  contactId: string;
  onChanged?: () => void | Promise<unknown>;
}) {
  const canRead = useCan('contacts.consent.read');
  const canManage = useCan('contacts.consent.manage');
  const t = useTranslations('contact-consent.card');
  const te = useTranslations('contact-consent.errors');
  const q = useContactConsent(contactId, canRead);
  const [asking, setAsking] = useState<ConsentAction | null>(null);
  if (!canRead) return null;

  return (
    <section
      aria-labelledby={`consent-${contactId}`}
      className="rounded-md border border-border bg-background p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={`consent-${contactId}`} className="text-base font-semibold">
          {t('title')}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          {q.data && (
            <Badge tone={TONE[consentStatus(q.data)]}>{t(`status.${consentStatus(q.data)}`)}</Badge>
          )}
          <a
            href={consentExportUrl(contactId)}
            download
            className="text-sm text-primary underline-offset-2 hover:underline"
          >
            {t('export')}
          </a>
          {canManage && (
            <>
              <Button size="sm" variant="secondary" onClick={() => setAsking('granted')}>
                {t('markSubscribed')}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setAsking('withdrawn')}>
                {t('markUnsubscribed')}
              </Button>
            </>
          )}
        </div>
      </div>

      {q.isError && (
        <Alert tone="danger" role="alert" className="mt-3">
          {te(errorKey(q.error))}
        </Alert>
      )}
      {q.isLoading && (
        <p role="status" className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner /> {t('loading')}
        </p>
      )}
      {q.data && (
        <>
          {q.data.states.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">{t('noneRecorded')}</p>
          ) : (
            <ul className="mt-3 flex flex-wrap gap-2" aria-label={t('perChannel')}>
              {q.data.states.map((s) => (
                <li key={`${s.channel}-${s.purpose}`}>
                  <Badge tone={s.state === 'granted' ? 'success' : 'danger'}>
                    {t(`channel.${s.channel}`)}: {t(stateKey(s.purpose, s.state))}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
          {q.data.events.length > 0 && (
            <ol className="mt-4 space-y-3 border-s border-border ps-4" aria-label={t('timeline')}>
              {q.data.events.map((e) => (
                <EventRow key={e.id} event={e} />
              ))}
            </ol>
          )}
        </>
      )}

      {asking && (
        <RecordDialog
          contactId={contactId}
          action={asking}
          onClose={() => setAsking(null)}
          onDone={() => onChanged?.()}
        />
      )}
    </section>
  );
}

function EventRow({ event: e }: { event: ConsentEvent }) {
  const t = useTranslations('contact-consent.card');
  const f = useFormatter();
  const proof = Object.entries(e.evidence)
    .filter(([k]) => k !== 'consentHash')
    .map(([k, v]) => `${t(`evidence.${k}`)}: ${String(v)}`);
  return (
    <li className="text-sm">
      <p className="font-medium">
        {t(actionKey(e.purpose, e.action))} · {t(`channel.${e.channel}`)} ·{' '}
        {t(`source.${e.source}`)}
      </p>
      <p className="text-xs text-muted-foreground">
        <time dateTime={e.occurredAt}>
          {f.dateTime(new Date(e.occurredAt), { dateStyle: 'medium', timeStyle: 'short' })}
        </time>
        {e.actor?.name ? ` · ${t('by', { name: e.actor.name })}` : ''}
      </p>
      {e.note && <p className="mt-0.5 whitespace-pre-line break-words">{e.note}</p>}
      {proof.length > 0 && (
        <p className="mt-0.5 break-words text-xs text-muted-foreground" dir="auto">
          {proof.join(' · ')}
        </p>
      )}
    </li>
  );
}

function RecordDialog({
  contactId,
  action,
  onClose,
  onDone,
}: {
  contactId: string;
  action: ConsentAction;
  onClose: () => void;
  onDone: () => void | Promise<unknown>;
}) {
  const t = useTranslations('contact-consent.card.dialog');
  const tc = useTranslations('contact-consent.card');
  const te = useTranslations('contact-consent.errors');
  const { toast } = useToast();
  const qc = useQueryClient();
  const [channel, setChannel] = useState<ConsentChannel>('whatsapp');
  const [note, setNote] = useState('');
  const [error, setError] = useState<unknown>(null);
  const needsNote = action === 'granted';
  const save = useMutation({
    mutationFn: () =>
      consentApi.record(contactId, {
        action,
        channel,
        source: 'manual',
        note: note.trim() === '' ? undefined : note.trim(),
      }),
    onSuccess: async (saved) => {
      qc.setQueryData(KEYS.contact(contactId), saved);
      await onDone();
      toast(t(action === 'granted' ? 'savedGranted' : 'savedWithdrawn'), 'success');
      onClose();
    },
    onError: (e) => setError(e),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={t(action === 'granted' ? 'titleGranted' : 'titleWithdrawn')}
      closeLabel={t('close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button
            variant="brand"
            disabled={save.isPending || (needsNote && note.trim() === '')}
            onClick={() => {
              setError(null);
              save.mutate();
            }}
          >
            {save.isPending && <Spinner />}
            {t('confirm')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {t(action === 'granted' ? 'introGranted' : 'introWithdrawn')}
        </p>
        <Field label={t('channel')} htmlFor="consent-channel">
          <Select
            id="consent-channel"
            value={channel}
            onChange={(e) => setChannel(e.target.value as ConsentChannel)}
          >
            {CONSENT_CHANNELS.map((c) => (
              <option key={c} value={c}>
                {tc(`channel.${c}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label={needsNote ? t('noteRequired') : t('noteOptional')}
          htmlFor="consent-note"
          hint={needsNote ? t('noteHint') : undefined}
        >
          <Textarea
            id="consent-note"
            rows={3}
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
        {error !== null && (
          <Alert tone="danger" role="alert">
            {te(errorKey(error))}
          </Alert>
        )}
      </div>
    </Modal>
  );
}
