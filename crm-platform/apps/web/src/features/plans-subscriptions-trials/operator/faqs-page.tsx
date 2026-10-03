'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FAQ_PLACEMENTS, type FaqPlacement, type PricingFaq } from '@crm/contracts';
import {
  Alert,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Input,
  Select,
  Switch,
  Textarea,
} from '@crm/ui';
import { useCanEdit } from '@/features/auth-registration-security/platform/operator-context';
import { PageHeader } from '@/features/auth-registration-security/platform/ui/page-header';
import { ReadOnlyNotice } from '@/features/auth-registration-security/platform/ui/read-only-notice';
import { ErrorBlock, LoadingBlock } from '@/features/auth-registration-security/platform/ui/state';
import { ApiError } from '@/lib/api/errors';
import {
  FAQS_KEY,
  createPricingFaq,
  deletePricingFaq,
  fetchPricingFaqs,
  updatePricingFaq,
} from '../api';

const NS = 'plans-subscriptions-trials.operator.faqs';
const Q_MAX = 255;
const A_MAX = 5000;

interface Draft {
  question: string;
  answer: string;
  sortOrder: string;
  placement: FaqPlacement;
  isActive: boolean;
}
const blank: Draft = {
  question: '',
  answer: '',
  sortOrder: '',
  placement: 'pricing',
  isActive: true,
};
const toDraft = (f: PricingFaq): Draft => ({
  question: f.question,
  answer: f.answer,
  sortOrder: String(f.sortOrder),
  placement: f.placement,
  isActive: f.isActive,
});

/** Pricing FAQs (TW-PLAN-009): add form, one editable row per FAQ with save, switch and delete. Lowest sort order shows first. */
export function FaqsPage() {
  const t = useTranslations(NS);
  const canEdit = useCanEdit('plans');
  const q = useQuery({
    queryKey: FAQS_KEY,
    queryFn: ({ signal }) => fetchPricingFaqs(signal),
    refetchOnWindowFocus: false,
  });

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('description')} />
      {!canEdit && <ReadOnlyNotice section="plans" />}
      {canEdit && <FaqForm />}
      {q.isPending ? (
        <LoadingBlock />
      ) : q.isError ? (
        <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />
      ) : q.data.data.length === 0 ? (
        <EmptyState title={t('title')} message={t('empty')} />
      ) : (
        <div className="space-y-3" data-testid="faq-rows">
          {q.data.data.map((f) => (
            <FaqRow key={`${f.id}-${f.rowVersion}`} faq={f} canEdit={canEdit} />
          ))}
        </div>
      )}
    </div>
  );
}

function useFaqErrors() {
  const t = useTranslations(NS);
  return (e: unknown) =>
    e instanceof ApiError && e.isRowVersionConflict
      ? t('conflict')
      : e instanceof ApiError && e.status === 422
        ? t('invalid')
        : t('failed');
}

function Fields({
  draft,
  set,
  idp,
}: {
  draft: Draft;
  set: (p: Partial<Draft>) => void;
  idp: string;
}) {
  const t = useTranslations(NS);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="space-y-1 sm:col-span-2">
        <span className="text-sm font-medium">{t('question')}</span>
        <Input
          id={`${idp}-q`}
          value={draft.question}
          maxLength={Q_MAX}
          onChange={(e) => set({ question: e.target.value })}
        />
      </label>
      <label className="space-y-1 sm:col-span-2">
        <span className="text-sm font-medium">{t('answer')}</span>
        <Textarea
          id={`${idp}-a`}
          rows={3}
          value={draft.answer}
          maxLength={A_MAX}
          onChange={(e) => set({ answer: e.target.value })}
        />
        <span className="text-xs text-muted-foreground">{t('answerHint')}</span>
      </label>
      <label className="space-y-1">
        <span className="text-sm font-medium">{t('sortOrder')}</span>
        <Input
          inputMode="numeric"
          value={draft.sortOrder}
          placeholder={t('auto')}
          onChange={(e) => set({ sortOrder: e.target.value })}
        />
      </label>
      <label className="space-y-1">
        <span className="text-sm font-medium">{t('placement')}</span>
        <Select
          value={draft.placement}
          onChange={(e) => set({ placement: e.target.value as FaqPlacement })}
        >
          {FAQ_PLACEMENTS.map((p) => (
            <option key={p} value={p}>
              {t(`placements.${p}`)}
            </option>
          ))}
        </Select>
      </label>
      <label className="flex items-center gap-2 text-sm">
        <Switch
          checked={draft.isActive}
          onCheckedChange={(v) => set({ isActive: v })}
          label={t('active')}
        />
        {t('active')}
      </label>
    </div>
  );
}

function sortOf(raw: string): number | null | undefined {
  const v = raw.trim();
  if (v === '') return null;
  return /^\d{1,4}$/.test(v) ? Number(v) : undefined;
}

function FaqForm() {
  const t = useTranslations(NS);
  const qc = useQueryClient();
  const errorOf = useFaqErrors();
  const [draft, setDraft] = useState<Draft>(blank);
  const [error, setError] = useState<string | null>(null);
  const add = useMutation({
    mutationFn: (d: Draft) =>
      createPricingFaq({
        question: d.question,
        answer: d.answer,
        sortOrder: sortOf(d.sortOrder) ?? null,
        placement: d.placement,
        isActive: d.isActive,
      }),
    onSuccess: () => {
      setDraft(blank);
      setError(null);
      void qc.invalidateQueries({ queryKey: FAQS_KEY });
    },
    onError: (e) => setError(errorOf(e)),
  });
  const bad = sortOf(draft.sortOrder) === undefined;
  return (
    <Card className="space-y-3 p-5">
      <h2 className="font-semibold">{t('newFaq')}</h2>
      <Fields draft={draft} set={(p) => setDraft((d) => ({ ...d, ...p }))} idp="new" />
      {error && <Alert tone="danger">{error}</Alert>}
      <Button
        disabled={add.isPending || bad || !draft.question.trim() || !draft.answer.trim()}
        onClick={() => add.mutate(draft)}
      >
        {t('add')}
      </Button>
    </Card>
  );
}

function FaqRow({ faq, canEdit }: { faq: PricingFaq; canEdit: boolean }) {
  const t = useTranslations(NS);
  const qc = useQueryClient();
  const errorOf = useFaqErrors();
  const [draft, setDraft] = useState<Draft>(toDraft(faq));
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: FAQS_KEY });

  const save = useMutation({
    mutationFn: (d: Draft) =>
      updatePricingFaq(faq.id, {
        question: d.question,
        answer: d.answer,
        sortOrder: sortOf(d.sortOrder) ?? faq.sortOrder,
        placement: d.placement,
        isActive: d.isActive,
        rowVersion: faq.rowVersion,
      }),
    onSuccess: () => void refresh(),
    onError: (e) => setError(errorOf(e)),
  });
  const remove = useMutation({
    mutationFn: () => deletePricingFaq(faq.id),
    onSuccess: () => void refresh(),
    onError: (e) => {
      setConfirm(false);
      setError(errorOf(e));
    },
  });

  return (
    <Card className="space-y-3 p-5" data-testid={`faq-${faq.id}`}>
      <fieldset disabled={!canEdit} className="space-y-3">
        <Fields draft={draft} set={(p) => setDraft((d) => ({ ...d, ...p }))} idp={faq.id} />
      </fieldset>
      {error && <Alert tone="danger">{error}</Alert>}
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={save.isPending || sortOf(draft.sortOrder) === undefined}
            onClick={() => save.mutate(draft)}
          >
            {t('save')}
          </Button>
          <Button size="sm" variant="danger" onClick={() => setConfirm(true)}>
            {t('delete')}
          </Button>
        </div>
      )}
      <ConfirmDialog
        open={confirm}
        title={t('deleteTitle')}
        message={t('deleteBody')}
        confirmLabel={t('deleteConfirm')}
        cancelLabel={t('cancel')}
        tone="danger"
        busy={remove.isPending}
        onConfirm={() => remove.mutate()}
        onClose={() => setConfirm(false)}
      />
    </Card>
  );
}
