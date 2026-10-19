'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import type { ContactPrivacy, PrivacyFlagEvent, PrivacyFlagKind } from '@crm/contracts';
import { Alert, Button, Field, Input, Modal, Spinner, Switch, Textarea, useToast } from '@crm/ui';
import { KEYS } from '../api/hooks';
import { consentApi, type RecordPrivacyChange } from '../api/service';
import { errorKey } from '../lib/errors';

/** Which of the three history lines an event is, for its label. */
const eventKey = (kind: PrivacyFlagKind, value: boolean) =>
  `event.${kind}.${value ? 'on' : 'off'}` as const;

/**
 * The privacy flags of a contact on the Consent card (BL-180): minor, parent or guardian consent, and Do Not Sell or Share. A switch
 * writes one append-only history line; guardian consent asks how the guardian agreed. None of it subscribes the contact: the
 * subscription lives in the consent history above.
 */
export function PrivacyFlags({
  contactId,
  privacy,
  canManage,
  onChanged,
}: {
  contactId: string;
  privacy: ContactPrivacy;
  canManage: boolean;
  onChanged?: () => void | Promise<unknown>;
}) {
  const t = useTranslations('contact-consent.card.privacy');
  const tc = useTranslations('contact-consent.card');
  const te = useTranslations('contact-consent.errors');
  const f = useFormatter();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [guardianOpen, setGuardianOpen] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const save = useMutation({
    mutationFn: (change: RecordPrivacyChange) => consentApi.recordPrivacy(contactId, change),
    onSuccess: async (saved) => {
      qc.setQueryData(KEYS.contact(contactId), saved);
      await onChanged?.();
      setError(null);
      toast(t('saved'), 'success');
    },
    onError: (e) => setError(e),
  });

  const date = (iso: string | null) =>
    iso ? f.dateTime(new Date(iso), { dateStyle: 'medium' }) : '';
  /** A calendar day (no time): read as UTC so the day never shifts with the viewer's time zone. */
  const day = (iso: string) =>
    f.dateTime(new Date(`${iso}T00:00:00Z`), { dateStyle: 'medium', timeZone: 'UTC' });
  const showDns = privacy.ccpaUs || privacy.doNotSellShare;

  return (
    <div className="mt-4 border-t border-border pt-3" data-testid="privacy-flags">
      <h3 className="text-sm font-semibold">{t('title')}</h3>
      <ul className="mt-2 space-y-3 text-sm">
        <li>
          <div className="flex items-center justify-between gap-3">
            <span className="font-medium">{t('minorLabel')}</span>
            <Switch
              checked={privacy.isMinor}
              disabled={!canManage || save.isPending}
              label={t('minorLabel')}
              onCheckedChange={(value) => save.mutate({ kind: 'minor', value })}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {privacy.isMinor ? t('minorOn', { date: date(privacy.minorSince) }) : t('minorOff')}
          </p>
          {privacy.isMinor && privacy.minorUntil && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t('minorFrom', { date: day(privacy.minorUntil) })}
            </p>
          )}
          {privacy.isMinor && privacy.minorSource === 'declaration' && (
            <p className="mt-0.5 text-xs text-muted-foreground">{t('minorFromDeclaration')}</p>
          )}
          {privacy.isMinor && (
            <p className="mt-0.5 text-xs text-muted-foreground">{t(`rule.${privacy.minorRule}`)}</p>
          )}
        </li>

        {privacy.isMinor && (
          <li>
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium">{t('guardianLabel')}</span>
              {canManage &&
                (privacy.guardianConsent ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={save.isPending}
                    onClick={() => save.mutate({ kind: 'guardian_consent', value: false })}
                  >
                    {t('clearGuardian')}
                  </Button>
                ) : (
                  <Button size="sm" variant="secondary" onClick={() => setGuardianOpen(true)}>
                    {t('recordGuardian')}
                  </Button>
                ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {privacy.guardianConsent
                ? t('guardianOn', { date: date(privacy.guardianSince) })
                : t('guardianOff')}
            </p>
          </li>
        )}

        {showDns && (
          <li>
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium">{t('dnsLabel')}</span>
              <Switch
                checked={privacy.doNotSellShare}
                disabled={!canManage || save.isPending}
                label={t('dnsLabel')}
                onCheckedChange={(value) => save.mutate({ kind: 'sale_share_opt_out', value })}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {privacy.doNotSellShare
                ? t('dnsOn', {
                    date: date(privacy.doNotSellShareSince),
                    source: privacy.doNotSellShareSource
                      ? tc(`source.${privacy.doNotSellShareSource}`)
                      : '',
                  })
                : t('dnsOff')}
            </p>
          </li>
        )}
      </ul>

      {error !== null && (
        <Alert tone="danger" role="alert" className="mt-3">
          {te(errorKey(error))}
        </Alert>
      )}

      {privacy.events.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-muted-foreground">{t('history')}</summary>
          <ol className="mt-2 space-y-2 border-s border-border ps-4" aria-label={t('history')}>
            {privacy.events.map((e) => (
              <HistoryRow key={e.id} event={e} />
            ))}
          </ol>
        </details>
      )}

      {guardianOpen && (
        <GuardianDialog
          contactId={contactId}
          onClose={() => setGuardianOpen(false)}
          onDone={() => onChanged?.()}
        />
      )}
    </div>
  );
}

function HistoryRow({ event: e }: { event: PrivacyFlagEvent }) {
  const t = useTranslations('contact-consent.card.privacy');
  const tc = useTranslations('contact-consent.card');
  const f = useFormatter();
  const proof = Object.entries(e.evidence).map(([k, v]) => `${tc(`evidence.${k}`)}: ${String(v)}`);
  return (
    <li className="text-xs">
      <p className="font-medium">
        {t(eventKey(e.kind, e.value))} · {tc(`source.${e.source}`)}
      </p>
      <p className="text-muted-foreground">
        <time dateTime={e.occurredAt}>
          {f.dateTime(new Date(e.occurredAt), { dateStyle: 'medium', timeStyle: 'short' })}
        </time>
        {e.actor?.name ? ` · ${tc('by', { name: e.actor.name })}` : ''}
      </p>
      {e.note && <p className="mt-0.5 whitespace-pre-line break-words">{e.note}</p>}
      {proof.length > 0 && (
        <p className="mt-0.5 break-words text-muted-foreground" dir="auto">
          {proof.join(' · ')}
        </p>
      )}
    </li>
  );
}

function GuardianDialog({
  contactId,
  onClose,
  onDone,
}: {
  contactId: string;
  onClose: () => void;
  onDone: () => void | Promise<unknown>;
}) {
  const t = useTranslations('contact-consent.card.privacy.dialog');
  const tb = useTranslations('contact-consent.card.dialog');
  const ts = useTranslations('contact-consent.card.privacy');
  const te = useTranslations('contact-consent.errors');
  const { toast } = useToast();
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const [ref, setRef] = useState('');
  const [error, setError] = useState<unknown>(null);
  const save = useMutation({
    mutationFn: () =>
      consentApi.recordPrivacy(contactId, {
        kind: 'guardian_consent',
        value: true,
        note: note.trim(),
        ...(ref.trim() === '' ? {} : { evidence: { guardianConsentRef: ref.trim() } }),
      }),
    onSuccess: async (saved) => {
      qc.setQueryData(KEYS.contact(contactId), saved);
      await onDone();
      toast(ts('saved'), 'success');
      onClose();
    },
    onError: (e) => setError(e),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={t('title')}
      closeLabel={tb('close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {tb('cancel')}
          </Button>
          <Button
            variant="brand"
            disabled={save.isPending || note.trim() === ''}
            onClick={() => {
              setError(null);
              save.mutate();
            }}
          >
            {save.isPending && <Spinner />}
            {tb('confirm')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{t('intro')}</p>
        <Field label={t('note')} htmlFor="guardian-note" hint={t('noteHint')}>
          <Textarea
            id="guardian-note"
            rows={3}
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
        <Field label={t('ref')} htmlFor="guardian-ref" hint={t('refHint')}>
          <Input
            id="guardian-ref"
            maxLength={300}
            value={ref}
            onChange={(e) => setRef(e.target.value)}
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
