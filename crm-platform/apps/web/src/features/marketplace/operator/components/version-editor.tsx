'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { MarketAppKind, MarketOperatorAppDetail, MarketOperatorVersion } from '@crm/contracts';
import { Button, Field, Spinner, Textarea } from '@crm/ui';
import { useUnsavedGuard } from '@/features/auth-registration-security/platform/ui/use-unsaved-guard';
import { fetchCategories, marketKeys, saveVersion, updateVersion } from '../api';
import { marketError, type MarketError } from '../lib/errors';
import {
  checkDocs,
  docProblemsFromError,
  isBlankRecipe,
  mergeProblems,
  parseJsonText,
  type DocProblem,
} from '../lib/json-docs';
import { LISTING_LIMITS, changelogProblem } from '../lib/listing-form';
import { highestVersion } from '../lib/version';
import { DocsEditors, type DocsText } from './docs-editors';
import { ErrorSummary } from './error-summary';
import { useDocsCheck } from './use-docs-check';
import { Section } from './ui';

const NS = 'marketplace.operator.versionEditor';

export type VersionEditorMode = { kind: 'new' } | { kind: 'edit'; versionId: string };

/**
 * The manifest and recipe editors for a new version of a listing (the number must be higher than every earlier one) or for editing a draft
 * or rejected one, with the changelog the admin will read. Saving a rejected version sends it back to draft (the API does that).
 */
export function VersionEditor({
  app,
  versions,
  mode,
  initial,
  onSaved,
  onCancel,
}: {
  app: { slug: string; kind: MarketAppKind };
  versions: readonly Pick<MarketOperatorVersion, 'id' | 'version'>[];
  mode: VersionEditorMode;
  initial: DocsText & { changelog: string };
  onSaved: (detail: MarketOperatorAppDetail) => void;
  onCancel: () => void;
}) {
  const t = useTranslations(NS);
  const categories = useQuery({
    queryKey: marketKeys.categories,
    queryFn: ({ signal }) => fetchCategories(signal),
    refetchOnWindowFocus: false,
  });
  const [docs, setDocs] = useState<DocsText>({
    manifestText: initial.manifestText,
    recipeText: initial.recipeText,
  });
  const [changelog, setChangelog] = useState(initial.changelog);
  const [attempted, setAttempted] = useState(false);
  const [serverError, setServerError] = useState<MarketError | null>(null);
  const [serverDocs, setServerDocs] = useState<DocProblem[]>([]);
  const [saved, setSaved] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  const [focusTick, setFocusTick] = useState(0);
  useEffect(() => {
    if (focusTick > 0) summaryRef.current?.focus();
  }, [focusTick]);

  const known = categories.data?.data ?? null;
  const expect = useMemo(
    () => ({
      slug: app.slug,
      kind: app.kind,
      newestVersion: mode.kind === 'new' ? highestVersion(versions) : null,
      takenVersions:
        mode.kind === 'edit'
          ? versions.filter((v) => v.id !== mode.versionId).map((v) => v.version)
          : undefined,
    }),
    [app.slug, app.kind, mode, versions],
  );
  const { check, settled } = useDocsCheck({ ...docs, expect, categories: known });
  const problems = useMemo(() => mergeProblems(check.problems, serverDocs), [check, serverDocs]);
  const changelogIssue = changelogProblem(changelog, true);
  const tp = useTranslations('marketplace.operator.fields.problems');

  const dirty =
    !saved &&
    (docs.manifestText !== initial.manifestText ||
      docs.recipeText !== initial.recipeText ||
      changelog !== initial.changelog);
  useUnsavedGuard(dirty);

  const save = useMutation({
    mutationFn: (body: { manifest: unknown; recipe?: unknown; changelog: string }) =>
      mode.kind === 'new'
        ? saveVersion(app.slug, body)
        : updateVersion(app.slug, mode.versionId, body),
    onSuccess: (detail) => {
      setSaved(true);
      onSaved(detail);
    },
    onError: (e) => {
      const info = marketError(e);
      setServerError(info);
      setServerDocs(docProblemsFromError(info));
      setFocusTick((n) => n + 1);
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setAttempted(true);
    setServerError(null);
    setServerDocs([]);
    const fresh = checkDocs({ ...docs, expect, categories: known });
    if (!fresh.canSave || changelogIssue) {
      setFocusTick((n) => n + 1);
      return;
    }
    const manifest = parseJsonText(docs.manifestText);
    const recipe = isBlankRecipe(docs.recipeText) ? undefined : parseJsonText(docs.recipeText);
    if (!manifest.ok || (recipe && !recipe.ok)) return;
    save.mutate({
      manifest: manifest.value,
      ...(recipe?.ok ? { recipe: recipe.value } : {}),
      changelog: changelog.trim(),
    });
  };

  const errorsIn = (doc: 'manifest' | 'recipe') =>
    problems.filter((p) => p.doc === doc && p.severity === 'error').length;

  return (
    <form onSubmit={submit} noValidate className="space-y-6" aria-busy={save.isPending}>
      <ErrorSummary
        innerRef={summaryRef}
        idPrefix="ver"
        general={serverError}
        manifestCount={errorsIn('manifest')}
        recipeCount={errorsIn('recipe')}
        fieldCount={attempted && changelogIssue ? 1 : 0}
        attempted={attempted}
      />
      <Section
        title={mode.kind === 'new' ? t('newTitle') : t('editTitle')}
        description={mode.kind === 'new' ? t('newHelp') : t('editHelp')}
      >
        <DocsEditors
          idPrefix="ver"
          value={docs}
          onChange={(next) => {
            if (next.manifestText !== docs.manifestText)
              setServerDocs((all) => all.filter((p) => p.doc !== 'manifest'));
            if (next.recipeText !== docs.recipeText)
              setServerDocs((all) => all.filter((p) => p.doc !== 'recipe'));
            setDocs(next);
          }}
          check={check}
          settled={settled}
          problems={problems}
          disabled={save.isPending}
        />
        <Field
          label={t('changelog')}
          htmlFor="ver-changelog"
          hint={t('changelogHint', { max: LISTING_LIMITS.changelogMax })}
          error={
            attempted && changelogIssue ? tp(changelogIssue.code, changelogIssue.values) : undefined
          }
        >
          <Textarea
            id="ver-changelog"
            rows={3}
            value={changelog}
            disabled={save.isPending}
            invalid={attempted && !!changelogIssue}
            onChange={(e) => setChangelog(e.target.value)}
          />
        </Field>
      </Section>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={save.isPending}>
          {save.isPending && <Spinner />}
          {save.isPending ? t('saving') : mode.kind === 'new' ? t('saveNew') : t('saveEdit')}
        </Button>
        <Button variant="secondary" disabled={save.isPending} onClick={onCancel}>
          {t('cancel')}
        </Button>
      </div>
    </form>
  );
}
