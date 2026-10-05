'use client';

import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  marketScopeSummaries,
  type MarketOperatorAppDetail,
  type MarketOperatorVersion,
} from '@crm/contracts';
import { Alert, Button, Spinner } from '@crm/ui';
import { useToast } from '@/features/auth-registration-security/platform/ui/toast';
import { approveVersion, marketKeys, publishApp, rejectVersion, submitVersion } from '../api';
import { marketError } from '../lib/errors';
import { prettyJson, withManifestVersion } from '../lib/json-docs';
import { versionActions, type VersionAction } from '../lib/lifecycle';
import type { MarketAccess } from '../lib/permissions';
import { nextVersionNumber } from '../lib/version';
import type { Notice } from './app-actions';
import { ApproveDialog, PublishDialog, RejectDialog } from './version-dialogs';
import { VersionEditor, type VersionEditorMode } from './version-editor';
import { ErrorLine, JsonBlock, ScopeList, Section, VersionStatusBadge, useErrorText } from './ui';

const NS = 'marketplace.operator.versions';

type Dialog = 'approve' | 'reject' | 'publish' | null;

/**
 * Every version of the listing, and the one being looked at: its permissions, its manifest and recipe (read-only), and the actions its state
 * and the caller's keys allow: edit, submit for review, approve, reject, publish; and a new version made from it.
 */
export function VersionsPanel({
  detail,
  access,
  onSelect,
  onNotice,
}: {
  detail: MarketOperatorAppDetail;
  access: MarketAccess;
  onSelect: (versionId: string | undefined) => void;
  onNotice: (n: Notice) => void;
}) {
  const t = useTranslations(NS);
  const toast = useToast();
  const qc = useQueryClient();
  const [editor, setEditor] = useState<VersionEditorMode | null>(null);
  const selected = detail.versions.find((v) => v.id === detail.versionId) ?? null;

  if (editor) {
    const isNew = editor.kind === 'new';
    const bumped = nextVersionNumber(detail.versions);
    return (
      <VersionEditor
        key={isNew ? 'new' : editor.versionId}
        app={{ slug: detail.slug, kind: detail.kind }}
        versions={detail.versions}
        mode={editor}
        initial={{
          manifestText:
            isNew && bumped
              ? withManifestVersion(prettyJson(detail.manifest), bumped)
              : prettyJson(detail.manifest),
          recipeText: detail.recipe ? prettyJson(detail.recipe) : '',
          changelog: isNew ? '' : (selected?.changelog ?? ''),
        }}
        onSaved={(saved) => {
          const version = saved.versions.find((v) => v.id === saved.versionId)?.version ?? '';
          toast.success(t(isNew ? 'done.created' : 'done.updated', { version }));
          void qc.invalidateQueries({ queryKey: marketKeys.appAll(detail.slug) });
          void qc.invalidateQueries({ queryKey: marketKeys.appsAll });
          setEditor(null);
          onSelect(saved.versionId);
        }}
        onCancel={() => setEditor(null)}
      />
    );
  }

  return (
    <div className="space-y-6">
      <Section
        id="versions"
        title={t('title')}
        description={t('description')}
        actions={
          access.manage ? (
            <Button variant="secondary" onClick={() => setEditor({ kind: 'new' })}>
              {t('newVersion')}
            </Button>
          ) : undefined
        }
      >
        <VersionsTable
          versions={detail.versions}
          selectedId={detail.versionId}
          onSelect={onSelect}
        />
        {access.manage && selected && (
          <p className="text-xs text-muted-foreground">
            {t('newVersionHint', { version: selected.version })}
          </p>
        )}
      </Section>
      {selected && (
        <SelectedVersion
          detail={detail}
          version={selected}
          access={access}
          onEdit={() => setEditor({ kind: 'edit', versionId: selected.id })}
          onNewFrom={() => setEditor({ kind: 'new' })}
          onNotice={onNotice}
        />
      )}
    </div>
  );
}

function VersionsTable({
  versions,
  selectedId,
  onSelect,
}: {
  versions: readonly MarketOperatorVersion[];
  selectedId: string;
  onSelect: (id: string | undefined) => void;
}) {
  const t = useTranslations(NS);
  const format = useFormatter();
  const date = (iso: string | null) =>
    iso ? format.dateTime(new Date(iso), { dateStyle: 'medium' }) : null;
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full min-w-[60rem] text-sm">
        <caption className="sr-only">{t('tableCaption')}</caption>
        <thead className="bg-muted text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-2 text-start font-medium">
              {t('cols.version')}
            </th>
            <th scope="col" className="px-3 py-2 text-start font-medium">
              {t('cols.status')}
            </th>
            <th scope="col" className="px-3 py-2 text-start font-medium">
              {t('cols.changelog')}
            </th>
            <th scope="col" className="px-3 py-2 text-start font-medium">
              {t('cols.scopes')}
            </th>
            <th scope="col" className="px-3 py-2 text-start font-medium">
              {t('cols.reviewNote')}
            </th>
            <th scope="col" className="px-3 py-2 text-start font-medium">
              {t('cols.dates')}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {versions.map((v) => {
            const isSelected = v.id === selectedId;
            return (
              <tr
                key={v.id}
                data-testid={`version-${v.version}`}
                className={isSelected ? 'bg-muted/50' : undefined}
              >
                <th scope="row" className="px-3 py-3 text-start font-normal align-top">
                  <button
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => onSelect(v.id)}
                    className="font-mono font-medium underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-primary"
                    dir="ltr"
                  >
                    {v.version}
                  </button>
                  {isSelected && (
                    <div className="mt-0.5 text-xs text-muted-foreground">{t('viewing')}</div>
                  )}
                </th>
                <td className="px-3 py-3 align-top">
                  <VersionStatusBadge status={v.status} />
                </td>
                <td className="max-w-xs px-3 py-3 align-top" dir="auto">
                  {v.changelog}
                </td>
                <td className="px-3 py-3 align-top">
                  <ScopeList scopes={marketScopeSummaries(v.scopes)} raw={v.scopes} />
                </td>
                <td className="max-w-xs px-3 py-3 align-top" dir="auto">
                  {v.reviewNote ?? <span className="text-muted-foreground">{t('none')}</span>}
                </td>
                <td className="px-3 py-3 align-top text-xs text-muted-foreground">
                  <dl className="space-y-0.5">
                    {(
                      [
                        ['created', v.createdAt],
                        ['submitted', v.submittedAt],
                        ['reviewed', v.reviewedAt],
                        ['published', v.publishedAt],
                      ] as const
                    ).flatMap(([k, iso]) =>
                      iso ? (
                        <div key={k} className="flex gap-1">
                          <dt>{t(`dates.${k}`)}:</dt>
                          <dd>
                            <time dateTime={iso}>{date(iso)}</time>
                          </dd>
                        </div>
                      ) : (
                        []
                      ),
                    )}
                  </dl>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SelectedVersion({
  detail,
  version,
  access,
  onEdit,
  onNewFrom,
  onNotice,
}: {
  detail: MarketOperatorAppDetail;
  version: MarketOperatorVersion;
  access: MarketAccess;
  onEdit: () => void;
  onNewFrom: () => void;
  onNotice: (n: Notice) => void;
}) {
  const t = useTranslations(NS);
  const toast = useToast();
  const qc = useQueryClient();
  const errorText = useErrorText();
  const [dialog, setDialog] = useState<Dialog>(null);
  const actions = versionActions(version, detail, access);
  const has = (a: VersionAction) => actions.includes(a);
  const published = detail.versions.find((v) => v.status === 'published') ?? null;

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: marketKeys.appAll(detail.slug) });
    void qc.invalidateQueries({ queryKey: marketKeys.appsAll });
    void qc.invalidateQueries({ queryKey: marketKeys.usage });
  };
  const failed = (e: unknown) => {
    toast.error(errorText(e).text);
    setDialog(null);
    // A version that moved under us (someone else submitted, approved, published it): show what it is now.
    if (['conflict', 'general'].includes(marketError(e).kind)) refresh();
  };

  // The error stays in the dialog; a refusal because the version is no longer in that state also reloads what the page shows.
  const staleCheck = (e: unknown) => {
    if (marketError(e).key.startsWith('versionState')) refresh();
  };

  const submit = useMutation({
    mutationFn: () => submitVersion(detail.slug, version.id),
    onSuccess: () => {
      toast.success(t('done.submit', { version: version.version }));
      refresh();
    },
    onError: failed,
  });
  const approve = useMutation({
    mutationFn: (note: string) => approveVersion(detail.slug, version.id, note),
    onSuccess: () => {
      toast.success(t('done.approve', { version: version.version }));
      setDialog(null);
      refresh();
    },
    onError: staleCheck,
  });
  const reject = useMutation({
    mutationFn: (note: string) => rejectVersion(detail.slug, version.id, note),
    onSuccess: () => {
      toast.success(t('done.reject', { version: version.version }));
      setDialog(null);
      refresh();
    },
    onError: staleCheck,
  });
  const publish = useMutation({
    mutationFn: () => publishApp(detail.slug, version.id),
    onSuccess: (r) => {
      toast.success(t('done.publish', { version: version.version }));
      setDialog(null);
      onNotice({
        kind: 'published',
        name: detail.name,
        version: version.version,
        upgraded: r.upgraded,
        awaitingConsent: r.awaitingConsent,
      });
      refresh();
    },
    onError: staleCheck,
  });
  const close = () => {
    approve.reset();
    reject.reset();
    publish.reset();
    setDialog(null);
  };

  const missingRecipe = detail.kind === 'integration' && detail.recipe === null;

  return (
    <Section
      id="selected-version"
      title={
        <span className="flex flex-wrap items-center gap-2">
          {t('selectedTitle', { version: version.version })}
          <VersionStatusBadge status={version.status} />
        </span>
      }
      description={t('selectedHelp')}
      actions={
        <>
          {has('edit') && (
            <Button variant="secondary" onClick={onEdit}>
              {t('edit')}
            </Button>
          )}
          {access.manage && (
            <Button variant="secondary" onClick={onNewFrom}>
              {t('newFrom')}
            </Button>
          )}
          {has('submit') && (
            <Button variant="secondary" disabled={submit.isPending} onClick={() => submit.mutate()}>
              {submit.isPending && <Spinner />}
              {t('submit')}
            </Button>
          )}
          {has('approve') && (
            <Button variant="secondary" onClick={() => setDialog('approve')}>
              {t('approve')}
            </Button>
          )}
          {has('reject') && (
            <Button variant="secondary" className="text-danger" onClick={() => setDialog('reject')}>
              {t('reject')}
            </Button>
          )}
          {has('publish') && <Button onClick={() => setDialog('publish')}>{t('publish')}</Button>}
        </>
      }
    >
      {version.status === 'rejected' && version.reviewNote && (
        <Alert tone="warning" className="space-y-1">
          <p className="font-medium">{t('rejectedNote')}</p>
          <p dir="auto">{version.reviewNote}</p>
        </Alert>
      )}
      {missingRecipe && has('submit') && <Alert tone="warning">{t('recipeMissing')}</Alert>}
      {submit.isError && <ErrorLine error={submit.error} />}

      <div className="space-y-1.5">
        <h3 className="text-sm font-medium">{t('permissions')}</h3>
        <ScopeList scopes={marketScopeSummaries(version.scopes)} raw={version.scopes} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="min-w-0 space-y-1.5">
          <h3 className="text-sm font-medium">{t('manifest')}</h3>
          <JsonBlock value={detail.manifest} label={t('manifest')} />
        </div>
        <div className="min-w-0 space-y-1.5">
          <h3 className="text-sm font-medium">{t('recipe')}</h3>
          {detail.recipe ? (
            <JsonBlock value={detail.recipe} label={t('recipe')} />
          ) : (
            <p className="text-sm text-muted-foreground">
              {detail.kind === 'integration' ? t('noRecipeIntegration') : t('noRecipeMiniApp')}
            </p>
          )}
        </div>
      </div>

      {dialog === 'approve' && (
        <ApproveDialog
          app={detail}
          version={version}
          busy={approve.isPending}
          error={approve.error}
          onConfirm={(note) => approve.mutate(note)}
          onClose={close}
        />
      )}
      {dialog === 'reject' && (
        <RejectDialog
          app={detail}
          version={version}
          busy={reject.isPending}
          error={reject.error}
          onConfirm={(note) => reject.mutate(note)}
          onClose={close}
        />
      )}
      {dialog === 'publish' && (
        <PublishDialog
          app={detail}
          version={version}
          published={published}
          busy={publish.isPending}
          error={publish.error}
          onConfirm={() => publish.mutate()}
          onClose={close}
        />
      )}
    </Section>
  );
}
