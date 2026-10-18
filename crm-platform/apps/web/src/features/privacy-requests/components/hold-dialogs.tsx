'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import {
  LEGAL_HOLD_CASE_REF_MAX,
  LEGAL_HOLD_NOTE_MAX,
  LEGAL_HOLD_REASON_CATEGORIES,
  type LegalHold,
  type LegalHoldReasonCategory,
  type LegalHoldScope,
} from '@crm/contracts';
import { Alert, Button, Field, Input, Modal, Select, Spinner, Textarea, useToast } from '@crm/ui';
import { KEYS, useSubjectSearch } from '../api/hooks';
import { HOLD_KEYS, legalHoldsApi } from '../api/legal-holds';
import { errorKey } from '../lib/errors';
import { dateInputValue, endOfDayIso, todayInputValue } from '../lib/legal-hold-model';

/** A hold changes what the rights cases, the register and the contact banner show: all of them are refreshed. */
function useRefreshAll() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: HOLD_KEYS.all }),
      qc.invalidateQueries({ queryKey: KEYS.all }),
    ]);
}

function ErrorLine({ error }: { error: unknown }) {
  const t = useTranslations('privacy-requests');
  if (!error) return null;
  return (
    <Alert tone="danger" role="alert">
      {t(`errors.${errorKey(error)}`)}
    </Alert>
  );
}

function Footer({
  onClose,
  onSubmit,
  disabled,
  busy,
  submit,
  busyLabel,
  danger,
}: {
  onClose: () => void;
  onSubmit: () => void;
  disabled: boolean;
  busy: boolean;
  submit: string;
  busyLabel: string;
  danger?: boolean;
}) {
  const t = useTranslations('privacy-requests.common');
  return (
    <>
      <Button variant="secondary" onClick={onClose} disabled={busy}>
        {t('cancel')}
      </Button>
      <Button
        variant={danger ? 'danger' : 'primary'}
        disabled={disabled || busy}
        onClick={onSubmit}
      >
        {busy && <Spinner />}
        {busy ? busyLabel : submit}
      </Button>
    </>
  );
}

/**
 * Place a legal hold on a contact, a lead or the whole workspace. The note is PII-light by rule and the form says so; the case
 * reference is the business's own (a court file, a ticket, a regulator's letter). From the register (`chooseTarget`) the person is
 * found by name, phone or email (masked) or the whole workspace is chosen; from a contact's page the subject is already known.
 */
export function PlaceHoldDialog({
  open,
  onClose,
  scope: fixedScope,
  subjectId: fixedSubject,
  chooseTarget = false,
}: {
  open: boolean;
  onClose: () => void;
  scope?: LegalHoldScope;
  subjectId?: string;
  chooseTarget?: boolean;
}) {
  const t = useTranslations('privacy-requests.legalHold');
  const { toast } = useToast();
  const refresh = useRefreshAll();
  const [category, setCategory] = useState<LegalHoldReasonCategory | ''>('');
  const [caseRef, setCaseRef] = useState('');
  const [note, setNote] = useState('');
  const [reviewAt, setReviewAt] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [target, setTarget] = useState<'person' | 'workspace'>('person');
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<{
    kind: 'contact' | 'lead';
    id: string;
    label: string;
  } | null>(null);
  const search = useSubjectSearch(query, open && chooseTarget && target === 'person' && !picked);
  const scope: LegalHoldScope = chooseTarget
    ? target === 'workspace'
      ? 'workspace'
      : (picked?.kind ?? 'contact')
    : (fixedScope ?? 'contact');
  const subjectId = chooseTarget ? (target === 'workspace' ? undefined : picked?.id) : fixedSubject;
  const reset = () => {
    setTarget('person');
    setQuery('');
    setPicked(null);
    setCategory('');
    setCaseRef('');
    setNote('');
    setReviewAt('');
    setExpiresAt('');
  };
  const close = () => {
    reset();
    place.reset();
    onClose();
  };
  const place = useMutation({
    mutationFn: () =>
      legalHoldsApi.place({
        scope,
        ...(subjectId ? { subjectId } : {}),
        reasonCategory: category as LegalHoldReasonCategory,
        caseRef: caseRef.trim(),
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(endOfDayIso(reviewAt) ? { reviewAt: endOfDayIso(reviewAt) } : {}),
        ...(endOfDayIso(expiresAt) ? { expiresAt: endOfDayIso(expiresAt) } : {}),
      }),
    onSuccess: async () => {
      await refresh();
      toast(t('place.done'), 'success');
      close();
    },
  });
  const valid =
    category !== '' &&
    caseRef.trim().length > 0 &&
    (scope === 'workspace' || subjectId !== undefined);

  return (
    <Modal
      open={open}
      onClose={close}
      size="md"
      title={scope === 'workspace' ? t('place.workspaceTitle') : t('place.title')}
      closeLabel={t('close')}
      footer={
        <Footer
          onClose={close}
          onSubmit={() => place.mutate()}
          disabled={!valid}
          busy={place.isPending}
          submit={t('place.submit')}
          busyLabel={t('place.submitting')}
        />
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {scope === 'workspace' ? t('place.workspaceIntro') : t('place.intro')}
        </p>
        {chooseTarget && (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t('place.target')}</legend>
            <div className="flex flex-wrap gap-4 text-sm">
              {(['person', 'workspace'] as const).map((v) => (
                <label key={v} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="lh-target"
                    checked={target === v}
                    onChange={() => setTarget(v)}
                  />
                  {t(v === 'person' ? 'place.targetPerson' : 'place.targetWorkspace')}
                </label>
              ))}
            </div>
            {target === 'person' &&
              (picked ? (
                <div className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm">
                  <span>{picked.label}</span>
                  <Button size="sm" variant="secondary" onClick={() => setPicked(null)}>
                    {t('place.change')}
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <Field label={t('place.search')} htmlFor="lh-search" hint={t('place.searchHint')}>
                    <Input
                      id="lh-search"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      autoComplete="off"
                    />
                  </Field>
                  {search.data && search.data.data.length === 0 && (
                    <p className="text-xs text-muted-foreground">{t('place.noResults')}</p>
                  )}
                  <ul className="space-y-1">
                    {search.data?.data.map((h) => (
                      <li key={`${h.kind}-${h.id}`}>
                        <button
                          type="button"
                          className="w-full rounded-md border border-border px-3 py-1.5 text-start text-sm hover:bg-muted"
                          onClick={() =>
                            setPicked({
                              kind: h.kind,
                              id: h.id,
                              label: `${h.name ?? ''} ${h.hint}`.trim(),
                            })
                          }
                        >
                          {h.name ?? h.hint}{' '}
                          <span className="text-xs text-muted-foreground">
                            {t(`scope.${h.kind}`)} - {h.hint}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
          </fieldset>
        )}
        <Field label={t('place.category')} htmlFor="lh-category">
          <Select
            id="lh-category"
            value={category}
            onChange={(e) => setCategory(e.target.value as LegalHoldReasonCategory | '')}
          >
            <option value="">{t('place.categoryPick')}</option>
            {LEGAL_HOLD_REASON_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t(`category.${c}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('place.caseRef')} htmlFor="lh-case-ref" hint={t('place.caseRefHint')}>
          <Input
            id="lh-case-ref"
            value={caseRef}
            maxLength={LEGAL_HOLD_CASE_REF_MAX}
            onChange={(e) => setCaseRef(e.target.value)}
            autoComplete="off"
          />
        </Field>
        <Field label={t('place.note')} htmlFor="lh-note" hint={t('place.noteHint')}>
          <Textarea
            id="lh-note"
            rows={3}
            maxLength={LEGAL_HOLD_NOTE_MAX}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('place.reviewAt')} htmlFor="lh-review" hint={t('place.reviewHint')}>
            <Input
              id="lh-review"
              type="date"
              min={todayInputValue()}
              value={reviewAt}
              onChange={(e) => setReviewAt(e.target.value)}
            />
          </Field>
          <Field label={t('place.expiresAt')} htmlFor="lh-expires" hint={t('place.expiresHint')}>
            <Input
              id="lh-expires"
              type="date"
              min={todayInputValue()}
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
            />
          </Field>
        </div>
        <ErrorLine error={place.error} />
      </div>
    </Modal>
  );
}

/** Release a hold: what happens next is said before the button, because an erasure someone already confirmed then runs by itself. */
export function ReleaseHoldDialog({
  open,
  onClose,
  hold,
}: {
  open: boolean;
  onClose: () => void;
  hold: Pick<LegalHold, 'id' | 'restrictedCases'>;
}) {
  const t = useTranslations('privacy-requests.legalHold');
  const { toast } = useToast();
  const refresh = useRefreshAll();
  const [reason, setReason] = useState('');
  const close = () => {
    setReason('');
    release.reset();
    onClose();
  };
  const release = useMutation({
    mutationFn: () =>
      legalHoldsApi.release(hold.id, reason.trim() ? { reason: reason.trim() } : {}),
    onSuccess: async (out) => {
      await refresh();
      toast(
        out.erasuresResuming > 0
          ? t('release.doneResuming', { count: out.erasuresResuming })
          : t('release.done'),
        'success',
      );
      close();
    },
  });
  return (
    <Modal
      open={open}
      onClose={close}
      title={t('release.title')}
      closeLabel={t('close')}
      footer={
        <Footer
          onClose={close}
          onSubmit={() => release.mutate()}
          disabled={false}
          busy={release.isPending}
          submit={t('release.submit')}
          busyLabel={t('release.submitting')}
          danger
        />
      }
    >
      <div className="space-y-4">
        <p className="text-sm">{t('release.message')}</p>
        {hold.restrictedCases > 0 && (
          <Alert tone="warning">{t('release.cases', { count: hold.restrictedCases })}</Alert>
        )}
        <Field
          label={t('release.reason')}
          htmlFor="lh-release-reason"
          hint={t('release.reasonHint')}
        >
          <Textarea
            id="lh-release-reason"
            rows={2}
            maxLength={LEGAL_HOLD_NOTE_MAX}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        <ErrorLine error={release.error} />
      </div>
    </Modal>
  );
}

/** Change the review date or the end date, add a further case reference, or edit the note. Only what changed is sent. */
export function ExtendHoldDialog({
  open,
  onClose,
  hold,
}: {
  open: boolean;
  onClose: () => void;
  hold: LegalHold;
}) {
  const t = useTranslations('privacy-requests.legalHold');
  const { toast } = useToast();
  const refresh = useRefreshAll();
  const initialReview = dateInputValue(hold.reviewAt);
  const initialExpiry = dateInputValue(hold.expiresAt);
  const [reviewAt, setReviewAt] = useState(initialReview);
  const [expiresAt, setExpiresAt] = useState(initialExpiry);
  const [addRef, setAddRef] = useState('');
  const [note, setNote] = useState(hold.note ?? '');
  const close = () => {
    extend.reset();
    onClose();
  };
  const body = () => ({
    ...(reviewAt !== initialReview ? { reviewAt: endOfDayIso(reviewAt) ?? null } : {}),
    ...(expiresAt !== initialExpiry ? { expiresAt: endOfDayIso(expiresAt) ?? null } : {}),
    ...(addRef.trim() ? { addCaseRef: addRef.trim() } : {}),
    ...(note !== (hold.note ?? '') ? { note: note.trim() || null } : {}),
  });
  const changed = Object.keys(body()).length > 0;
  const extend = useMutation({
    mutationFn: () => legalHoldsApi.extend(hold.id, body()),
    onSuccess: async () => {
      await refresh();
      toast(t('extend.done'), 'success');
      close();
    },
  });
  return (
    <Modal
      open={open}
      onClose={close}
      size="md"
      title={t('extend.title')}
      closeLabel={t('close')}
      footer={
        <Footer
          onClose={close}
          onSubmit={() => extend.mutate()}
          disabled={!changed}
          busy={extend.isPending}
          submit={t('extend.submit')}
          busyLabel={t('extend.submitting')}
        />
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {t('extend.caseRefNow', { caseRef: hold.caseRef })}
        </p>
        <Field
          label={t('extend.addCaseRef')}
          htmlFor="lh-add-ref"
          hint={t('extend.addCaseRefHint')}
        >
          <Input
            id="lh-add-ref"
            value={addRef}
            maxLength={LEGAL_HOLD_CASE_REF_MAX}
            onChange={(e) => setAddRef(e.target.value)}
            autoComplete="off"
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('place.reviewAt')} htmlFor="lh-ext-review" hint={t('extend.clearHint')}>
            <Input
              id="lh-ext-review"
              type="date"
              min={todayInputValue()}
              value={reviewAt}
              onChange={(e) => setReviewAt(e.target.value)}
            />
          </Field>
          <Field label={t('place.expiresAt')} htmlFor="lh-ext-expires" hint={t('extend.clearHint')}>
            <Input
              id="lh-ext-expires"
              type="date"
              min={todayInputValue()}
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
            />
          </Field>
        </div>
        <Field label={t('place.note')} htmlFor="lh-ext-note" hint={t('place.noteHint')}>
          <Textarea
            id="lh-ext-note"
            rows={3}
            maxLength={LEGAL_HOLD_NOTE_MAX}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
        <ErrorLine error={extend.error} />
      </div>
    </Modal>
  );
}

/** Record that the hold was looked at again (who and when), and when it is due next. */
export function ReviewHoldDialog({
  open,
  onClose,
  hold,
}: {
  open: boolean;
  onClose: () => void;
  hold: LegalHold;
}) {
  const t = useTranslations('privacy-requests.legalHold');
  const { toast } = useToast();
  const refresh = useRefreshAll();
  const [next, setNext] = useState('');
  const close = () => {
    setNext('');
    review.reset();
    onClose();
  };
  const review = useMutation({
    mutationFn: () =>
      legalHoldsApi.review(hold.id, next ? { nextReviewAt: endOfDayIso(next) ?? null } : {}),
    onSuccess: async () => {
      await refresh();
      toast(t('review.done'), 'success');
      close();
    },
  });
  return (
    <Modal
      open={open}
      onClose={close}
      title={t('review.title')}
      closeLabel={t('close')}
      footer={
        <Footer
          onClose={close}
          onSubmit={() => review.mutate()}
          disabled={false}
          busy={review.isPending}
          submit={t('review.submit')}
          busyLabel={t('review.submitting')}
        />
      }
    >
      <div className="space-y-4">
        <p className="text-sm">{t('review.message')}</p>
        <Field label={t('review.next')} htmlFor="lh-review-next" hint={t('review.nextHint')}>
          <Input
            id="lh-review-next"
            type="date"
            min={todayInputValue()}
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </Field>
        <ErrorLine error={review.error} />
      </div>
    </Modal>
  );
}
