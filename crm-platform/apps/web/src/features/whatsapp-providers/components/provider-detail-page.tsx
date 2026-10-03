'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import { Alert, Badge, Button, EmptyState, Spinner } from '@crm/ui';
import { PageHeader } from '@/features/auth-registration-security/platform/ui/page-header';
import { ErrorBlock, LoadingBlock } from '@/features/auth-registration-security/platform/ui/state';
import { useToast } from '@/features/auth-registration-security/platform/ui/toast';
import { useUnsavedGuard } from '@/features/auth-registration-security/platform/ui/use-unsaved-guard';
import { KEYS, providersApi } from '../api/client';
import { useProvider, useRefreshAll, useWapAccess } from '../api/hooks';
import type { Provider, TestInput, TestResult } from '../api/schemas';
import type { WapAccess } from '../lib/access';
import { errorView, isStale, serverFieldErrors } from '../lib/errors';
import {
  draftFromProvider,
  isDirty,
  toUpdateInput,
  validateDraft,
  type ProviderDraft,
} from '../lib/provider-draft';
import { ProviderActions } from './provider-actions';
import { BillingSection, ConnectionSection, CredentialsSection } from './provider-sections';
import { DefaultBadge, Section, StatusChip } from './parts';
import { TestPanel } from './test-panel';

/** One provider: the same sections as the wizard, plus its channels, history and the danger zone. */
export function ProviderDetailPage({ id }: { id: string }) {
  const q = useProvider(id);
  const { access } = useWapAccess();
  if (q.isPending) return <LoadingBlock />;
  if (q.isError) return <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />;
  // The new rowVersion remounts the editor with a clean draft, so a saved change never leaves stale edits behind.
  return (
    <ProviderEditor key={`${q.data.id}:${q.data.rowVersion}`} provider={q.data} access={access} />
  );
}

function ProviderEditor({ provider: p, access }: { provider: Provider; access: WapAccess }) {
  const t = useTranslations('whatsapp-providers.detail');
  const te = useTranslations('whatsapp-providers.errors');
  const router = useRouter();
  const toast = useToast();
  const refresh = useRefreshAll();
  const [draft, setDraft] = useState<ProviderDraft>(() => draftFromProvider(p));
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<{ text: string; stale: boolean } | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [ids, setIds] = useState<TestInput>({ wabaId: '', phoneNumberId: '' });
  const [result, setResult] = useState<TestResult | null>(null);

  const dirty = isDirty(p, draft);
  useUnsavedGuard(dirty);
  const errors = useMemo(() => validateDraft(draft, undefined, p), [draft, p]);
  const canEdit = access.manage;

  const patch = (next: Partial<ProviderDraft>) => {
    setDraft((d) => ({ ...d, ...next }));
    setServerErrors({});
  };

  const save = useMutation({
    mutationFn: () => providersApi.update(p.id, toUpdateInput(p, draft)),
    onSuccess: (saved) => {
      toast.success(t('saved', { label: saved.label }));
      void refresh();
    },
    onError: (e) => {
      const view = errorView(e);
      setProblem({ text: te(view.kind), stale: isStale(e) });
      setServerErrors(serverFieldErrors(e));
    },
  });

  const onSave = () => {
    setShowErrors(true);
    if (Object.keys(errors).length > 0) {
      setProblem({ text: te('validation'), stale: false });
      return;
    }
    setProblem(null);
    save.mutate();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={p.key}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {p.label}
            <StatusChip status={p.status} />
            {p.isDefault && <DefaultBadge />}
          </span>
        }
        description={t('description')}
        actions={
          <>
            <Link href="/admin/whatsapp-providers">
              <Button variant="secondary" size="sm">
                {t('back')}
              </Button>
            </Link>
            <ProviderActions
              provider={p}
              access={access}
              showEdit={false}
              onDeleted={() => router.push('/admin/whatsapp-providers')}
            />
          </>
        }
      />

      {!canEdit && <Alert tone="info">{t('readOnly')}</Alert>}
      {problem && (
        <Alert
          tone="danger"
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2"
        >
          <span>{problem.text}</span>
          {problem.stale && (
            <Button size="sm" variant="secondary" onClick={() => void refresh()}>
              {t('reload')}
            </Button>
          )}
        </Alert>
      )}

      <Section title={t('sections.connection')} id="connection">
        <ConnectionSection
          draft={draft}
          patch={patch}
          errors={showErrors ? errors : {}}
          serverErrors={serverErrors}
          existing={p}
          disabled={!canEdit}
          previewValues={ids}
        />
      </Section>
      <Section title={t('sections.credentials')} id="credentials">
        <CredentialsSection
          draft={draft}
          patch={patch}
          errors={showErrors ? errors : {}}
          serverErrors={serverErrors}
          existing={p}
          disabled={!canEdit}
        />
      </Section>
      <Section title={t('sections.billing')} id="billing">
        <BillingSection
          draft={draft}
          patch={patch}
          errors={showErrors ? errors : {}}
          serverErrors={serverErrors}
          existing={p}
          disabled={!canEdit}
        />
      </Section>

      {canEdit && (
        <div
          className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-background/95 px-4 py-3 shadow-sm backdrop-blur"
          role="region"
          aria-label={t('saveBar')}
        >
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {dirty ? t('unsaved') : t('saved_state')}
          </p>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              disabled={!dirty || save.isPending}
              onClick={() => {
                setDraft(draftFromProvider(p));
                setServerErrors({});
                setProblem(null);
                setShowErrors(false);
              }}
            >
              {t('discard')}
            </Button>
            <Button disabled={!dirty || save.isPending} onClick={onSave}>
              {save.isPending && <Spinner label={t('saving')} />}
              {t('save')}
            </Button>
          </div>
        </div>
      )}

      {canEdit && (
        <Section title={t('sections.test')} description={t('testIntro')} id="test">
          {dirty && <Alert tone="info">{t('testSaved')}</Alert>}
          <TestPanel
            values={ids}
            onValues={setIds}
            result={result}
            onResult={setResult}
            run={async (v) => {
              const r = await providersApi.test(p.id, v);
              void refresh();
              return r;
            }}
          />
        </Section>
      )}

      <ChannelsSection provider={p} access={access} />
      <HistorySection id={p.id} />
      {canEdit && (
        <DangerZone
          provider={p}
          access={access}
          onDeleted={() => router.push('/admin/whatsapp-providers')}
        />
      )}
    </div>
  );
}

function ChannelsSection({ provider: p, access }: { provider: Provider; access: WapAccess }) {
  const t = useTranslations('whatsapp-providers.detail.channels');
  const q = useInfiniteQuery({
    queryKey: KEYS.channels(p.id),
    queryFn: ({ pageParam, signal }) => providersApi.channels(p.id, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) =>
      last.page.hasMore ? (last.page.nextCursor ?? undefined) : undefined,
    refetchOnWindowFocus: false,
  });
  const rows = q.data?.pages.flatMap((pg) => pg.data) ?? [];
  return (
    <Section
      title={t('title')}
      description={t('description', { count: p.channelCount })}
      id="channels"
      actions={
        access.switch && p.channelCount > 0 ? (
          <Link href={`/admin/whatsapp-providers/switch?from=${p.id}`}>
            <Button variant="secondary" size="sm">
              {t('move')}
            </Button>
          </Link>
        ) : undefined
      }
    >
      {q.isPending ? (
        <LoadingBlock />
      ) : q.isError ? (
        <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title={t('emptyTitle')} message={t('emptyMessage')} />
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-[34rem] text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  {(['workspace', 'channel', 'status', 'queued'] as const).map((c) => (
                    <th key={c} scope="col" className="px-3 py-2 text-start font-medium">
                      {t(`columns.${c}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => (
                  <tr key={r.channelId}>
                    <td className="px-3 py-2">{r.workspaceName}</td>
                    <td className="px-3 py-2">
                      {r.label}
                      {r.phoneDisplay && (
                        <span dir="ltr" className="ms-2 font-mono text-xs text-muted-foreground">
                          {r.phoneDisplay}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Badge>{r.status}</Badge>
                    </td>
                    <td className="px-3 py-2 tabular-nums">{r.queuedMessages}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {q.hasNextPage && (
            <Button
              variant="secondary"
              size="sm"
              disabled={q.isFetchingNextPage}
              onClick={() => void q.fetchNextPage()}
            >
              {t('loadMore')}
            </Button>
          )}
        </>
      )}
    </Section>
  );
}

function HistorySection({ id }: { id: string }) {
  const t = useTranslations('whatsapp-providers.detail.history');
  const format = useFormatter();
  const q = useQuery({
    queryKey: KEYS.events(id),
    queryFn: ({ signal }) => providersApi.events(id, signal),
    refetchOnWindowFocus: false,
    retry: false,
  });
  return (
    <Section title={t('title')} description={t('description')} id="history">
      {q.isPending ? (
        <LoadingBlock />
      ) : q.isError ? (
        <p className="text-sm text-muted-foreground">{t('unavailable')}</p>
      ) : q.data.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <ol className="space-y-2">
          {q.data.data.map((e) => (
            <li key={e.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-sm">
              <time dateTime={e.at} className="text-xs text-muted-foreground tabular-nums">
                {format.dateTime(new Date(e.at), { dateStyle: 'medium', timeStyle: 'short' })}
              </time>
              <span className="font-medium">{e.action}</span>
              {e.actor && <span className="text-muted-foreground">{e.actor}</span>}
              {e.detail && <span className="text-muted-foreground">{e.detail}</span>}
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}

function DangerZone({
  provider: p,
  access,
  onDeleted,
}: {
  provider: Provider;
  access: WapAccess;
  onDeleted: () => void;
}) {
  const t = useTranslations('whatsapp-providers.detail.danger');
  return (
    <Section title={t('title')} description={t('description')} tone="danger" id="danger">
      <ul className="list-disc space-y-1 ps-5 text-sm text-muted-foreground">
        {p.isDefault && <li>{t('isDefault')}</li>}
        {p.channelCount > 0 && <li>{t('hasChannels', { count: p.channelCount })}</li>}
        {p.workspaceOverrideCount > 0 && (
          <li>{t('hasOverrides', { count: p.workspaceOverrideCount })}</li>
        )}
        {!p.isDefault && p.channelCount === 0 && p.workspaceOverrideCount === 0 && (
          <li>{t('free')}</li>
        )}
      </ul>
      <ProviderActions provider={p} access={access} only="danger" onDeleted={onDeleted} />
    </Section>
  );
}
