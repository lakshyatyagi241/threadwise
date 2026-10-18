'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import {
  WORKSPACE_VOCAB_NOUNS,
  type VocabNounRow,
  type WorkspaceVocabNoun,
  type WorkspaceVocabularyResponse,
} from '@crm/contracts';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Field,
  Input,
  Spinner,
  ToastProvider,
  useToast,
} from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { LOCALES } from '@/i18n/locales';
import { KEYS, useWorkspaceWords } from '../api/hooks';
import { vocabularyApi } from '../api/service';
import { errorKey, isRowVersionConflict } from '../lib/errors';
import { buildSave, dirtyNouns, formFromResponse, rowProblem, type VocabForm } from '../lib/form';
import { ambiguousNouns, type NounDefaults } from '../lib/localize';

const CARD = 'rounded-xl border border-border bg-background p-4';

/** `/workspace-words`: what this workspace calls a contact, an appointment, a deal and a meeting. Labels only. */
export function WordsScreen() {
  const t = useTranslations('persona-vocabulary');
  return (
    <ToastProvider dismissLabel={t('common.dismiss')}>
      <div className="space-y-4">
        <Loader />
      </div>
    </ToastProvider>
  );
}

function Loader() {
  const t = useTranslations('persona-vocabulary');
  const locale = useLocale();
  const canManage = useCan('admin.settings.manage');
  const q = useWorkspaceWords(locale, canManage);

  if (!canManage) {
    return (
      <Alert tone="warning" role="alert">
        {t('errors.forbidden')}
      </Alert>
    );
  }
  if (q.isError) {
    return (
      <Alert tone="danger" role="alert" className="flex items-center justify-between gap-3">
        <span>{t(`errors.${errorKey(q.error)}`)}</span>
        <Button size="sm" variant="secondary" onClick={() => void q.refetch()}>
          {t('common.retry')}
        </Button>
      </Alert>
    );
  }
  if (!q.data) {
    return (
      <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner /> {t('common.loading')}
      </div>
    );
  }
  return <Body key={`${locale}:${q.data.rev}`} data={q.data} locale={locale} />;
}

function Body({ data, locale }: { data: WorkspaceVocabularyResponse; locale: string }) {
  const t = useTranslations('persona-vocabulary');
  const { toast } = useToast();
  const qc = useQueryClient();
  const router = useRouter();
  const baseline = useMemo(() => formFromResponse(data), [data]);
  const [form, setForm] = useState<VocabForm>(baseline);
  const [applyToAll, setApplyToAll] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [conflict, setConflict] = useState(false);
  const saving = useRef(false);

  const defaults = useMemo(() => {
    const out = {} as NounDefaults;
    for (const n of WORKSPACE_VOCAB_NOUNS) {
      out[n] = { one: t(`defaults.${n}.one`), other: t(`defaults.${n}.other`) };
    }
    return out;
  }, [t]);
  const singleForm = (n: WorkspaceVocabNoun) =>
    defaults[n].one.toLocaleLowerCase(locale) === defaults[n].other.toLocaleLowerCase(locale);
  const shared = useMemo(() => ambiguousNouns(defaults, locale), [defaults, locale]);
  const languageName = useMemo(
    () => new Intl.DisplayNames([locale], { type: 'language' }).of(locale) ?? locale,
    [locale],
  );

  const dirty = dirtyNouns(form, baseline);
  const problems = WORKSPACE_VOCAB_NOUNS.filter((n) => rowProblem(form[n], singleForm(n)) !== null);
  const canSave = dirty.length > 0 && problems.length === 0;

  const save = useMutation({
    mutationFn: () => {
      const body = buildSave(data.rev, baseline, form, {
        locale,
        allLocales: LOCALES,
        applyToAll,
        singleForm,
      });
      if (!body) return Promise.resolve(data);
      return vocabularyApi.save(locale, body);
    },
    onSuccess: (saved) => {
      qc.setQueryData(KEYS.words(locale), saved);
      toast(t('saved'), 'success');
      // The session carries the words, so the menu and every screen pick them up on the next render of the layout.
      router.refresh();
    },
    onError: (e) => {
      if (isRowVersionConflict(e)) {
        setConflict(true);
        void qc.invalidateQueries({ queryKey: KEYS.all });
      } else setError(e);
    },
    onSettled: () => {
      saving.current = false;
    },
  });
  const send = () => {
    if (saving.current || !canSave) return;
    saving.current = true;
    setError(null);
    save.mutate();
  };

  const reset = useMutation({
    mutationFn: (noun: WorkspaceVocabNoun) =>
      vocabularyApi.save(locale, { rev: data.rev, nouns: { [noun]: null } }),
    onSuccess: (saved) => {
      qc.setQueryData(KEYS.words(locale), saved);
      toast(t('resetDone'), 'success');
      router.refresh();
    },
    onError: (e) => {
      if (isRowVersionConflict(e)) {
        setConflict(true);
        void qc.invalidateQueries({ queryKey: KEYS.all });
      } else setError(e);
    },
  });

  return (
    <section className="space-y-4" aria-labelledby="words-title">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 id="words-title" className="text-xl font-bold tracking-tight">
            {t('title')}
          </h1>
          <p className="mt-0.5 max-w-3xl text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            disabled={dirty.length === 0 || save.isPending}
            onClick={() => setForm(baseline)}
          >
            {t('discard')}
          </Button>
          <Button variant="brand" disabled={!canSave || save.isPending} onClick={send}>
            {save.isPending && <Spinner />}
            {t('save')}
          </Button>
        </div>
      </header>

      {conflict && (
        <Alert tone="warning" className="flex flex-wrap items-center justify-between gap-3">
          <span>{t('conflict')}</span>
          <Button size="sm" variant="secondary" onClick={() => setConflict(false)}>
            {t('conflictOk')}
          </Button>
        </Alert>
      )}
      {error !== null && (
        <Alert tone="danger" role="alert">
          {t(`errors.${errorKey(error)}`)}
        </Alert>
      )}

      <Alert tone="info">
        <p>{t('language', { language: languageName })}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t('labelsOnly')}</p>
      </Alert>

      <div className={CARD}>
        <Checkbox
          id="apply-all"
          checked={applyToAll}
          onChange={(e) => setApplyToAll(e.target.checked)}
          label={
            <span>
              <span className="font-medium">{t('applyAll')}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {t('applyAllHint')}
              </span>
            </span>
          }
        />
      </div>

      <ul className="space-y-3">
        {data.nouns.map((row) => (
          <li key={row.noun}>
            <NounCard
              row={row}
              value={form[row.noun]}
              defaults={defaults[row.noun]}
              singleForm={singleForm(row.noun)}
              sharedWord={shared.has(row.noun)}
              disabled={save.isPending || reset.isPending}
              onChange={(v) => setForm((f) => ({ ...f, [row.noun]: v }))}
              onReset={() => reset.mutate(row.noun)}
            />
          </li>
        ))}
      </ul>

      <p className="text-xs text-muted-foreground">{t('grammar')}</p>
    </section>
  );
}

function sourceLabel(row: VocabNounRow, t: ReturnType<typeof useTranslations>): ReactNode {
  switch (row.source) {
    case 'workspace':
      return <Badge tone="success">{t('source.workspace')}</Badge>;
    case 'operator':
      return <Badge tone="neutral">{t('source.operator')}</Badge>;
    case 'persona':
      return <Badge tone="neutral">{t('source.persona')}</Badge>;
    default:
      return <Badge tone="neutral">{t('source.default')}</Badge>;
  }
}

function NounCard({
  row,
  value,
  defaults,
  singleForm,
  sharedWord,
  disabled,
  onChange,
  onReset,
}: {
  row: VocabNounRow;
  value: { one: string; other: string };
  defaults: { one: string; other: string };
  singleForm: boolean;
  sharedWord: boolean;
  disabled: boolean;
  onChange: (v: { one: string; other: string }) => void;
  onReset: () => void;
}) {
  const t = useTranslations('persona-vocabulary');
  const problem = rowProblem(value, singleForm);
  const id = `noun-${row.noun}`;
  const problemText =
    problem === 'incomplete'
      ? t('problems.incomplete')
      : problem === 'invalid'
        ? t('problems.invalid')
        : undefined;
  return (
    <div className={CARD}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{defaults.other}</h2>
          <p className="text-sm text-muted-foreground">{t(`nouns.${row.noun}.hint`)}</p>
        </div>
        <div className="flex items-center gap-2">
          {sourceLabel(row, t)}
          {row.workspaceLocales.length > 0 && (
            <Button size="sm" variant="secondary" disabled={disabled} onClick={onReset}>
              {t('reset')}
            </Button>
          )}
        </div>
      </div>
      {sharedWord && (
        <Alert tone="warning" className="mt-3">
          {t('sharedWord')}
        </Alert>
      )}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field
          label={singleForm ? t('fields.name') : t('fields.singular')}
          htmlFor={`${id}-one`}
          hint={t('fields.placeholderHint', { word: defaults.one })}
          error={problemText}
        >
          <Input
            id={`${id}-one`}
            value={value.one}
            maxLength={40}
            placeholder={defaults.one}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, one: e.target.value })}
          />
        </Field>
        {!singleForm && (
          <Field
            label={t('fields.plural')}
            htmlFor={`${id}-other`}
            hint={t('fields.placeholderHint', { word: defaults.other })}
          >
            <Input
              id={`${id}-other`}
              value={value.other}
              maxLength={40}
              placeholder={defaults.other}
              disabled={disabled}
              onChange={(e) => onChange({ ...value, other: e.target.value })}
            />
          </Field>
        )}
      </div>
    </div>
  );
}
