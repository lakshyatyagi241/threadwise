'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Field, Spinner, Textarea } from '@crm/ui';
import { PageHeader } from '@/features/auth-registration-security/platform/ui/page-header';
import { useToast } from '@/features/auth-registration-security/platform/ui/toast';
import { useUnsavedGuard } from '@/features/auth-registration-security/platform/ui/use-unsaved-guard';
import { createApp, fetchCategories, marketKeys } from '../api';
import { marketError, type MarketError } from '../lib/errors';
import {
  checkDocs,
  docProblemsFromError,
  isBlankRecipe,
  mergeProblems,
  parseJsonText,
  type DocProblem,
} from '../lib/json-docs';
import {
  changelogProblem,
  createFields,
  emptyListingDraft,
  isDirty,
  listingProblems,
  serverFieldKey,
  LISTING_LIMITS,
  type FieldProblems,
  type ListingDraft,
} from '../lib/listing-form';
import { CATALOGUE_PATH, listingHref } from '../lib/paths';
import { DocsEditors, type DocsText } from './docs-editors';
import { ErrorSummary } from './error-summary';
import { ListingFields, useFieldError } from './listing-fields';
import { useDocsCheck } from './use-docs-check';
import { MarketGate, Section, linkClass } from './ui';

const NS = 'marketplace.operator.new';

/** Operator console: create a listing (listing fields, the manifest and, for an integration, the recipe). Needs `platform.market.manage`. */
export function ListingNewPage() {
  return <MarketGate need="manage">{() => <NewListingForm />}</MarketGate>;
}

function NewListingForm() {
  const t = useTranslations(NS);
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const categories = useQuery({
    queryKey: marketKeys.categories,
    queryFn: ({ signal }) => fetchCategories(signal),
    refetchOnWindowFocus: false,
  });

  const [draft, setDraft] = useState<ListingDraft>(emptyListingDraft);
  const [changelog, setChangelog] = useState('');
  const [docs, setDocs] = useState<DocsText>({ manifestText: '', recipeText: '' });
  const [attempted, setAttempted] = useState(false);
  const [serverError, setServerError] = useState<MarketError | null>(null);
  const [serverDocs, setServerDocs] = useState<DocProblem[]>([]);
  const [serverFields, setServerFields] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  const [focusTick, setFocusTick] = useState(0);
  useEffect(() => {
    if (focusTick > 0) summaryRef.current?.focus();
  }, [focusTick]);

  const known = categories.data?.data ?? null;
  const { check, settled } = useDocsCheck({ ...docs, categories: known });
  const problems = useMemo(() => {
    const all = mergeProblems(check.problems, serverDocs);
    // An editor nobody has typed in yet is not an error until a save is tried.
    return attempted ? all : all.filter((p) => p.code !== 'empty');
  }, [check, serverDocs, attempted]);
  const fieldProblems: FieldProblems = useMemo(() => {
    const out = listingProblems(draft);
    const c = changelogProblem(changelog, false);
    if (c) out.changelog = c;
    return out;
  }, [draft, changelog]);
  const changelogError = useFieldError(fieldProblems, serverFields, attempted);

  const dirty =
    !saved &&
    (docs.manifestText !== '' ||
      docs.recipeText !== '' ||
      changelog !== '' ||
      isDirty(emptyListingDraft(), draft));
  useUnsavedGuard(dirty);

  const create = useMutation({
    mutationFn: createApp,
    onSuccess: (detail) => {
      setSaved(true);
      void qc.invalidateQueries({ queryKey: marketKeys.appsAll });
      toast.success(t('created', { name: detail.name }));
      router.push(listingHref(detail));
    },
    onError: (e) => {
      const info = marketError(e);
      setServerError(info);
      setServerDocs(docProblemsFromError(info));
      const fields: Record<string, string> = {};
      for (const p of info.problems) {
        if (p.target !== 'field') continue;
        const key = serverFieldKey(p.path);
        if (key && !fields[key]) fields[key] = p.message;
      }
      setServerFields(fields);
      setFocusTick((n) => n + 1);
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setAttempted(true);
    setServerError(null);
    setServerDocs([]);
    setServerFields({});
    // Checked again from the text as it is now, not from the debounced copy the editors show.
    const fresh = checkDocs({ ...docs, categories: known });
    if (!fresh.canSave || Object.keys(fieldProblems).length > 0) {
      setFocusTick((n) => n + 1);
      return;
    }
    const manifest = parseJsonText(docs.manifestText);
    const recipe = isBlankRecipe(docs.recipeText) ? undefined : parseJsonText(docs.recipeText);
    if (!manifest.ok || (recipe && !recipe.ok)) return;
    create.mutate({
      manifest: manifest.value,
      ...(recipe?.ok ? { recipe: recipe.value } : {}),
      ...createFields(draft, changelog),
    });
  };

  const errorsIn = (doc: 'manifest' | 'recipe') =>
    problems.filter((p) => p.doc === doc && p.severity === 'error').length;

  return (
    <div className="space-y-6">
      <Link
        href={CATALOGUE_PATH}
        className="inline-flex text-sm text-muted-foreground underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-primary"
      >
        {t('back')}
      </Link>
      <PageHeader title={t('title')} description={t('description')} />

      <form onSubmit={submit} noValidate className="space-y-6" aria-busy={create.isPending}>
        <ErrorSummary
          innerRef={summaryRef}
          idPrefix="new"
          general={serverError}
          manifestCount={errorsIn('manifest')}
          recipeCount={errorsIn('recipe')}
          fieldCount={
            attempted
              ? Object.keys(fieldProblems).length + Object.keys(serverFields).length
              : Object.keys(serverFields).length
          }
          attempted={attempted}
        />

        <Section title={t('sections.docs')} description={t('sections.docsHelp')}>
          <DocsEditors
            idPrefix="new"
            value={docs}
            onChange={(next) => {
              // An edit makes the API's problems for that document stale: they are listed again if the next save finds them again.
              if (next.manifestText !== docs.manifestText)
                setServerDocs((all) => all.filter((p) => p.doc !== 'manifest'));
              if (next.recipeText !== docs.recipeText)
                setServerDocs((all) => all.filter((p) => p.doc !== 'recipe'));
              setDocs(next);
            }}
            check={check}
            settled={settled}
            problems={problems}
            withTemplates
            disabled={create.isPending}
          />
        </Section>

        <ListingFields
          draft={draft}
          onChange={setDraft}
          problems={fieldProblems}
          server={serverFields}
          showErrors={attempted}
          disabled={create.isPending}
        />

        <Section title={t('sections.changelog')} description={t('sections.changelogHelp')}>
          <Field
            label={t('changelog')}
            htmlFor="new-changelog"
            hint={t('changelogHint', { max: LISTING_LIMITS.changelogMax })}
            error={changelogError('changelog')}
          >
            <Textarea
              id="new-changelog"
              rows={3}
              value={changelog}
              disabled={create.isPending}
              invalid={!!changelogError('changelog')}
              onChange={(e) => setChangelog(e.target.value)}
            />
          </Field>
        </Section>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={create.isPending}>
            {create.isPending && <Spinner />}
            {create.isPending ? t('saving') : t('save')}
          </Button>
          <Link href={CATALOGUE_PATH} className={linkClass}>
            {t('cancel')}
          </Link>
          <p className="text-xs text-muted-foreground">{t('draftNote')}</p>
        </div>
      </form>
    </div>
  );
}
