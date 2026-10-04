'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MARKET_APP_KINDS, type MarketAppKind, type MarketOperatorCategory } from '@crm/contracts';
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  Modal,
  Select,
  Spinner,
  Switch,
  Textarea,
} from '@crm/ui';
import { PageHeader } from '@/features/auth-registration-security/platform/ui/page-header';
import { useToast } from '@/features/auth-registration-security/platform/ui/toast';
import {
  createCategory,
  deleteCategory,
  fetchCategories,
  marketKeys,
  updateCategory,
} from '../api';
import {
  CATEGORY_LIMITS,
  canDeleteCategory,
  categoryProblems,
  createBody,
  draftFromCategory,
  emptyCategoryDraft,
  groupCategories,
  updateBody,
  type CategoryDraft,
} from '../lib/categories';
import { isConflict, marketError } from '../lib/errors';
import type { MarketAccess } from '../lib/permissions';
import { useFieldError } from './listing-fields';
import {
  ErrorLine,
  Failure,
  KindLabel,
  LoadingBlock,
  MarketGate,
  Section,
  useErrorText,
} from './ui';

const NS = 'marketplace.operator.categories';

/** Operator console: the categories of both tabs. Needs `platform.market.manage` or `platform.market.review` (only manage changes them). */
export function CategoriesPage() {
  return <MarketGate>{(access) => <Categories access={access} />}</MarketGate>;
}

type Dialog =
  | { kind: 'create' }
  | { kind: 'edit'; category: MarketOperatorCategory }
  | { kind: 'delete'; category: MarketOperatorCategory };

function Categories({ access }: { access: MarketAccess }) {
  const t = useTranslations(NS);
  const q = useQuery({
    queryKey: marketKeys.categories,
    queryFn: ({ signal }) => fetchCategories(signal),
    refetchOnWindowFocus: false,
  });
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const groups = useMemo(() => groupCategories(q.data?.data ?? []), [q.data]);

  const header = (
    <PageHeader
      title={t('title')}
      description={t('description')}
      actions={
        access.manage ? (
          <Button onClick={() => setDialog({ kind: 'create' })}>{t('new')}</Button>
        ) : undefined
      }
    />
  );

  if (q.isPending) {
    return (
      <div className="space-y-6">
        {header}
        <LoadingBlock />
      </div>
    );
  }
  if (q.isError) {
    return (
      <div className="space-y-6">
        {header}
        <Failure error={q.error} onRetry={() => void q.refetch()} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}
      {q.data.data.length === 0 ? (
        <EmptyState
          title={t('emptyTitle')}
          message={t('emptyMessage')}
          actions={
            access.manage ? (
              <Button onClick={() => setDialog({ kind: 'create' })}>{t('new')}</Button>
            ) : undefined
          }
        />
      ) : (
        groups.map((g) => (
          <Section
            key={g.kind}
            id={`kind-${g.kind}`}
            title={<KindLabel kind={g.kind} />}
            description={t('groupCount', { count: g.categories.length })}
          >
            {g.categories.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('groupEmpty')}</p>
            ) : (
              <CategoryTable
                categories={g.categories}
                access={access}
                onEdit={(category) => setDialog({ kind: 'edit', category })}
                onDelete={(category) => setDialog({ kind: 'delete', category })}
              />
            )}
          </Section>
        ))
      )}
      {dialog?.kind === 'create' && (
        <CategoryFormDialog mode="create" onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'edit' && (
        <CategoryFormDialog
          mode="edit"
          category={dialog.category}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'delete' && (
        <DeleteCategoryDialog category={dialog.category} onClose={() => setDialog(null)} />
      )}
    </div>
  );
}

function CategoryTable({
  categories,
  access,
  onEdit,
  onDelete,
}: {
  categories: readonly MarketOperatorCategory[];
  access: MarketAccess;
  onEdit: (c: MarketOperatorCategory) => void;
  onDelete: (c: MarketOperatorCategory) => void;
}) {
  const t = useTranslations(NS);
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full min-w-[48rem] text-sm">
        <caption className="sr-only">{t('tableCaption')}</caption>
        <thead className="bg-muted text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-2 text-start font-medium">
              {t('cols.name')}
            </th>
            <th scope="col" className="px-3 py-2 text-start font-medium">
              {t('cols.slug')}
            </th>
            <th scope="col" className="px-3 py-2 text-start font-medium">
              {t('cols.icon')}
            </th>
            <th scope="col" className="px-3 py-2 text-end font-medium">
              {t('cols.order')}
            </th>
            <th scope="col" className="px-3 py-2 text-end font-medium">
              {t('cols.apps')}
            </th>
            <th scope="col" className="px-3 py-2 text-start font-medium">
              {t('cols.status')}
            </th>
            {access.manage && (
              <th scope="col" className="px-3 py-2 text-end font-medium">
                <span className="sr-only">{t('cols.actions')}</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {categories.map((c) => (
            <tr key={c.id} data-testid={`category-${c.kind}-${c.slug}`}>
              <th scope="row" className="px-3 py-3 text-start align-top font-normal">
                <div className="font-medium" dir="auto">
                  {c.name}
                </div>
                {c.description && (
                  <div className="mt-0.5 max-w-md text-xs text-muted-foreground" dir="auto">
                    {c.description}
                  </div>
                )}
              </th>
              <td className="px-3 py-3 align-top font-mono text-xs" dir="ltr">
                {c.slug}
              </td>
              <td className="px-3 py-3 align-top font-mono text-xs" dir="ltr">
                {c.icon ?? t('dash')}
              </td>
              <td className="px-3 py-3 text-end align-top tabular-nums">{c.sortOrder}</td>
              <td className="px-3 py-3 text-end align-top tabular-nums">{c.appCount}</td>
              <td className="px-3 py-3 align-top">
                <Badge tone={c.isActive ? 'success' : 'warning'}>
                  {c.isActive ? t('active') : t('inactive')}
                </Badge>
              </td>
              {access.manage && (
                <td className="px-3 py-3 align-top">
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <Button variant="secondary" size="sm" onClick={() => onEdit(c)}>
                      {t('edit')}
                      <span className="sr-only"> {c.name}</span>
                    </Button>
                    {canDeleteCategory(c) ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        className="text-danger"
                        onClick={() => onDelete(c)}
                      >
                        {t('delete')}
                        <span className="sr-only"> {c.name}</span>
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">{t('inUse')}</span>
                    )}
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Add a category (kind, slug, name, description, icon, order) or edit one (everything but the kind and the slug, plus on/off). */
export function CategoryFormDialog({
  mode,
  category,
  onClose,
}: {
  mode: 'create' | 'edit';
  category?: MarketOperatorCategory;
  onClose: () => void;
}) {
  const t = useTranslations(`${NS}.form`);
  const toast = useToast();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<CategoryDraft>(
    category ? draftFromCategory(category) : emptyCategoryDraft(),
  );
  const [attempted, setAttempted] = useState(false);
  const [serverFields, setServerFields] = useState<Record<string, string>>({});
  const problems = categoryProblems(draft, mode);
  const fieldError = useFieldError(problems, serverFields, attempted);
  const formId = `category-form-${mode}`;

  const done = () => {
    void qc.invalidateQueries({ queryKey: marketKeys.categories });
    void qc.invalidateQueries({ queryKey: marketKeys.appsAll });
    onClose();
  };
  const save = useMutation({
    mutationFn: async () => {
      if (mode === 'create') return createCategory(createBody(draft));
      const body = updateBody(category!, draft);
      if (!body) return category!;
      return updateCategory(category!.id, body);
    },
    onSuccess: (c) => {
      toast.success(t(mode === 'create' ? 'created' : 'saved', { name: c.name }));
      done();
    },
    onError: (e) => {
      const fields: Record<string, string> = {};
      for (const p of marketError(e).problems)
        if (p.target === 'field' && !fields[p.path]) fields[p.path] = p.message;
      setServerFields(fields);
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setAttempted(true);
    setServerFields({});
    if (Object.keys(problems).length > 0) return;
    save.mutate();
  };
  const set = <K extends keyof CategoryDraft>(key: K, value: CategoryDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  return (
    <Modal
      open
      size="md"
      title={mode === 'create' ? t('createTitle') : t('editTitle', { name: category!.name })}
      closeLabel={t('close')}
      onClose={() => {
        if (!save.isPending) onClose();
      }}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
            {t('cancel')}
          </Button>
          <Button type="submit" form={formId} disabled={save.isPending}>
            {save.isPending && <Spinner />}
            {mode === 'create' ? t('create') : t('save')}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate className="space-y-4">
        {isConflict(save.error) ? (
          <Alert tone="warning" className="space-y-2">
            <p>{t('conflict')}</p>
            <Button variant="secondary" size="sm" onClick={done}>
              {t('reload')}
            </Button>
          </Alert>
        ) : (
          save.error && <ErrorLine error={save.error} />
        )}

        <Field
          label={t('kind')}
          htmlFor="cat-kind"
          hint={mode === 'edit' ? t('kindLocked') : undefined}
        >
          <Select
            id="cat-kind"
            value={draft.kind}
            disabled={mode === 'edit' || save.isPending}
            onChange={(e) => set('kind', e.target.value as MarketAppKind)}
          >
            {MARKET_APP_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`kinds.${k}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label={t('slug')}
          htmlFor="cat-slug"
          hint={mode === 'edit' ? t('slugLocked') : t('slugHint')}
          error={fieldError('slug')}
        >
          <Input
            id="cat-slug"
            dir="ltr"
            autoComplete="off"
            spellCheck={false}
            value={draft.slug}
            readOnly={mode === 'edit'}
            disabled={save.isPending}
            invalid={!!fieldError('slug')}
            onChange={(e) => set('slug', e.target.value)}
          />
        </Field>
        <Field
          label={t('name')}
          htmlFor="cat-name"
          hint={t('nameHint', { min: CATEGORY_LIMITS.nameMin, max: CATEGORY_LIMITS.nameMax })}
          error={fieldError('name')}
        >
          <Input
            id="cat-name"
            value={draft.name}
            disabled={save.isPending}
            invalid={!!fieldError('name')}
            onChange={(e) => set('name', e.target.value)}
          />
        </Field>
        <Field
          label={t('descriptionField')}
          htmlFor="cat-description"
          hint={t('descriptionHint', { max: CATEGORY_LIMITS.descriptionMax })}
          error={fieldError('description')}
        >
          <Textarea
            id="cat-description"
            rows={2}
            value={draft.description}
            disabled={save.isPending}
            invalid={!!fieldError('description')}
            onChange={(e) => set('description', e.target.value)}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t('icon')}
            htmlFor="cat-icon"
            hint={t('iconHint')}
            error={fieldError('icon')}
          >
            <Input
              id="cat-icon"
              dir="ltr"
              autoComplete="off"
              spellCheck={false}
              value={draft.icon}
              disabled={save.isPending}
              invalid={!!fieldError('icon')}
              onChange={(e) => set('icon', e.target.value)}
            />
          </Field>
          <Field
            label={t('sortOrder')}
            htmlFor="cat-order"
            hint={t('sortOrderHint', { max: CATEGORY_LIMITS.sortOrderMax })}
            error={fieldError('sortOrder')}
          >
            <Input
              id="cat-order"
              type="number"
              inputMode="numeric"
              min={0}
              max={CATEGORY_LIMITS.sortOrderMax}
              value={draft.sortOrder}
              disabled={save.isPending}
              invalid={!!fieldError('sortOrder')}
              onChange={(e) => set('sortOrder', e.target.value)}
            />
          </Field>
        </div>
        {mode === 'edit' && (
          <div className="flex items-start gap-3">
            <Switch
              id="cat-active"
              checked={draft.isActive}
              disabled={save.isPending}
              label={t('active')}
              onCheckedChange={(v) => set('isActive', v)}
            />
            <div className="text-sm">
              <label htmlFor="cat-active" className="font-medium">
                {t('active')}
              </label>
              <p className="text-xs text-muted-foreground">{t('activeHint')}</p>
            </div>
          </div>
        )}
      </form>
    </Modal>
  );
}

/** Delete an empty category. The API refuses one with apps in it; the screen offers delete only for an empty one and still shows a refusal. */
export function DeleteCategoryDialog({
  category,
  onClose,
}: {
  category: MarketOperatorCategory;
  onClose: () => void;
}) {
  const t = useTranslations(`${NS}.deleteDialog`);
  const toast = useToast();
  const qc = useQueryClient();
  const errorText = useErrorText();
  const remove = useMutation({
    mutationFn: () => deleteCategory(category.id),
    onSuccess: () => {
      toast.success(t('done', { name: category.name }));
      void qc.invalidateQueries({ queryKey: marketKeys.categories });
      onClose();
    },
    onError: (e) => {
      toast.error(errorText(e).text);
      // The category gained apps, or is gone: show what it is now.
      void qc.invalidateQueries({ queryKey: marketKeys.categories });
      onClose();
    },
  });
  return (
    <ConfirmDialog
      open
      title={t('title', { name: category.name })}
      message={<p>{t('body', { name: category.name })}</p>}
      confirmLabel={t('action')}
      cancelLabel={t('cancel')}
      tone="danger"
      busy={remove.isPending}
      onConfirm={() => remove.mutate()}
      onClose={onClose}
    />
  );
}
