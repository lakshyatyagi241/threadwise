'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  PRIVACY_REQUEST_TYPES,
  PRIVACY_REQUESTER_CHANNELS,
  type PrivacyHistoryMode,
  type PrivacyRequestType,
  type PrivacySubjectInput,
} from '@crm/contracts';
import { Alert, Button, Field, Input, Modal, Select, Spinner, Textarea, useToast } from '@crm/ui';
import { KEYS, useSubjectSearch } from '../api/hooks';
import { privacyApi } from '../api/service';
import { errorKey } from '../lib/errors';
import { identifierKind } from '../lib/model';

interface Picked {
  subject: PrivacySubjectInput;
  label: string;
}

const STEPS = 3;

/** "New request": find the person, pick what they ask for, then the channel, a note and (for erasure) the history choice. */
export function NewRequestWizard({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations('privacy-requests');
  const { toast } = useToast();
  const qc = useQueryClient();
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [term, setTerm] = useState('');
  const [other, setOther] = useState('');
  const [picked, setPicked] = useState<Picked | null>(null);
  const [type, setType] = useState<PrivacyRequestType | null>(null);
  const [channel, setChannel] = useState<(typeof PRIVACY_REQUESTER_CHANNELS)[number]>('staff');
  const [note, setNote] = useState('');
  const [history, setHistory] = useState<PrivacyHistoryMode>('delete');
  const [error, setError] = useState<unknown>(null);
  const search = useSubjectSearch(term, open && step === 1 && !picked);

  const close = () => {
    setStep(1);
    setTerm('');
    setOther('');
    setPicked(null);
    setType(null);
    setChannel('staff');
    setNote('');
    setHistory('delete');
    setError(null);
    onClose();
  };

  const create = useMutation({
    mutationFn: () =>
      privacyApi.create({
        requestType: type!,
        subject: picked!.subject,
        requesterChannel: channel,
        internalNote: note.trim() || undefined,
        historyMode: type === 'erasure' ? history : 'delete',
      }),
    onSuccess: async (made) => {
      await qc.invalidateQueries({ queryKey: KEYS.all });
      toast(t('wizard.created', { reference: made.reference }), 'success');
      close();
      router.push(`/privacy-requests/${made.id}`);
    },
    onError: (e) => setError(e),
  });

  const useOther = () => {
    const value = other.trim();
    if (value.length < 3) return;
    setPicked({
      subject: { kind: 'identifier', identifierKind: identifierKind(value), value },
      label: value,
    });
  };

  const canNext = step === 1 ? picked !== null : step === 2 ? type !== null : true;
  const hits = search.data?.data ?? [];

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!create.isPending) close();
      }}
      size="md"
      title={t('wizard.title')}
      eyebrow={t('wizard.step', { current: step, total: STEPS })}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button
            variant="secondary"
            disabled={create.isPending}
            onClick={() => (step === 1 ? close() : setStep(step - 1))}
          >
            {step === 1 ? t('common.cancel') : t('common.back')}
          </Button>
          {step < STEPS ? (
            <Button disabled={!canNext} onClick={() => setStep(step + 1)}>
              {t('common.next')}
            </Button>
          ) : (
            <Button
              disabled={create.isPending || !picked || !type}
              onClick={() => {
                setError(null);
                create.mutate();
              }}
            >
              {create.isPending && <Spinner />}
              {create.isPending ? t('wizard.creating') : t('wizard.create')}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        {error !== null && (
          <Alert tone="danger" role="alert">
            {t(`errors.${errorKey(error)}`)}
          </Alert>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <h3 className="text-sm font-semibold">{t('wizard.person.title')}</h3>
            {picked ? (
              <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3 text-sm">
                <span>{t('wizard.person.selected', { name: picked.label })}</span>
                <Button size="sm" variant="secondary" onClick={() => setPicked(null)}>
                  {t('wizard.person.clear')}
                </Button>
              </div>
            ) : (
              <>
                <Field
                  label={t('wizard.person.search')}
                  htmlFor="privacy-subject-search"
                  hint={t('wizard.person.searchHint')}
                >
                  <Input
                    id="privacy-subject-search"
                    value={term}
                    onChange={(e) => setTerm(e.target.value)}
                    autoComplete="off"
                  />
                </Field>
                {search.isFetching && (
                  <div
                    role="status"
                    className="flex items-center gap-2 text-sm text-muted-foreground"
                  >
                    <Spinner /> {t('wizard.person.searching')}
                  </div>
                )}
                {term.trim().length >= 2 && !search.isFetching && hits.length === 0 && (
                  <p className="text-sm text-muted-foreground">{t('wizard.person.none')}</p>
                )}
                {hits.length > 0 && (
                  <ul className="divide-y divide-border rounded-md border border-border">
                    {hits.map((h) => {
                      const name = h.name?.trim() || t('wizard.person.unnamed');
                      return (
                        <li key={`${h.kind}:${h.id}`}>
                          <button
                            type="button"
                            aria-label={t('wizard.person.pick', { name })}
                            className="flex w-full items-center justify-between gap-3 px-3 py-2 text-start text-sm hover:bg-muted"
                            onClick={() =>
                              setPicked({ subject: { kind: h.kind, id: h.id }, label: name })
                            }
                          >
                            <span className="min-w-0 truncate font-medium">{name}</span>
                            <span className="shrink-0 text-xs text-muted-foreground">
                              {h.kind === 'lead'
                                ? t('wizard.person.kindLead')
                                : t('wizard.person.kindContact')}{' '}
                              {h.hint}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
                <div className="space-y-2 border-t border-border pt-4">
                  <h4 className="text-sm font-medium">{t('wizard.person.other')}</h4>
                  <Field
                    label={t('wizard.person.otherValue')}
                    htmlFor="privacy-subject-other"
                    hint={t('wizard.person.otherHint')}
                  >
                    <Input
                      id="privacy-subject-other"
                      value={other}
                      onChange={(e) => setOther(e.target.value)}
                      autoComplete="off"
                    />
                  </Field>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={other.trim().length < 3}
                    onClick={useOther}
                  >
                    {t('wizard.person.useOther')}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        {step === 2 && (
          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-semibold">{t('wizard.kind.title')}</legend>
            {PRIVACY_REQUEST_TYPES.map((k) => (
              <label
                key={k}
                htmlFor={`privacy-type-${k}`}
                className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3 text-sm has-[:checked]:border-primary"
              >
                <input
                  id={`privacy-type-${k}`}
                  type="radio"
                  name="privacy-type"
                  className="mt-0.5 accent-[var(--primary)]"
                  checked={type === k}
                  onChange={() => setType(k)}
                />
                <span>
                  <span className="block font-medium">{t(`type.${k}`)}</span>
                  <span className="block text-xs text-muted-foreground">{t(`typeHint.${k}`)}</span>
                </span>
              </label>
            ))}
          </fieldset>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <h3 className="text-sm font-semibold">{t('wizard.details.title')}</h3>
            <Field label={t('wizard.details.channel')} htmlFor="privacy-channel">
              <Select
                id="privacy-channel"
                value={channel}
                onChange={(e) => setChannel(e.target.value as typeof channel)}
              >
                {PRIVACY_REQUESTER_CHANNELS.map((c) => (
                  <option key={c} value={c}>
                    {t(`channel.${c}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label={t('wizard.details.note')}
              htmlFor="privacy-note"
              hint={t('wizard.details.noteHint')}
            >
              <Textarea
                id="privacy-note"
                rows={3}
                maxLength={1000}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </Field>
            {type === 'erasure' && (
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">{t('wizard.details.history')}</legend>
                <p className="text-xs text-muted-foreground">{t('wizard.details.historyHint')}</p>
                {(['delete', 'anonymise'] as const).map((m) => (
                  <label
                    key={m}
                    htmlFor={`privacy-history-${m}`}
                    className="flex cursor-pointer items-start gap-2 text-sm"
                  >
                    <input
                      id={`privacy-history-${m}`}
                      type="radio"
                      name="privacy-history"
                      className="mt-0.5 accent-[var(--primary)]"
                      checked={history === m}
                      onChange={() => setHistory(m)}
                    />
                    <span>
                      {m === 'delete'
                        ? t('wizard.details.historyDelete')
                        : t('wizard.details.historyAnonymise')}
                    </span>
                  </label>
                ))}
              </fieldset>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
