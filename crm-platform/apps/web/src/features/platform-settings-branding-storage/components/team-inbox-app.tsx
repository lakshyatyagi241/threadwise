'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { setGroupResponseSchema, type SetGroupResponse } from '@crm/contracts';
import { Alert, Button, Field, Input, Spinner } from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';
import { ToggleRow } from '@/features/auth-registration-security/platform/settings/section-parts';
import { groupKey, hubKey } from '../lib/query-keys';
import { AssetSlot } from './brand-assets';

const NS = 'platform-settings-branding-storage.teamInbox';
interface PushState {
  vapidPublic: string;
  pushReady: boolean;
}

/** The separate installable Team Inbox app (TW-SET-038): its own switch, names, icons and the one-click push keys. */
export function TeamInboxApp({ canEdit }: { canEdit: boolean }) {
  const t = useTranslations(NS);
  const q = useQuery({
    queryKey: groupKey('tiPwa'),
    queryFn: ({ signal }) =>
      operatorFetch('/settings/groups/tiPwa', { schema: setGroupResponseSchema, signal }),
    refetchOnWindowFocus: false,
  });
  if (q.isPending) return <Spinner label={t('loading')} />;
  if (q.isError) return <Alert tone="danger">{t('loadFailed')}</Alert>;
  return <Form key={q.data.rowVersion} data={q.data} canEdit={canEdit} />;
}

function Form({ data, canEdit }: { data: SetGroupResponse; canEdit: boolean }) {
  const t = useTranslations(NS);
  const qc = useQueryClient();
  const v = data.values as {
    enabled: boolean;
    name: string;
    shortName: string;
    icon192: string;
    icon512: string;
  };
  const push = (data.extra ?? { vapidPublic: '', pushReady: false }) as unknown as PushState;
  const [enabled, setEnabled] = useState(v.enabled);
  const [name, setName] = useState(v.name);
  const [shortName, setShortName] = useState(v.shortName);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const dirty = enabled !== v.enabled || name !== v.name || shortName !== v.shortName;

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: groupKey('tiPwa') });
    void qc.invalidateQueries({ queryKey: hubKey });
  };
  const save = useMutation({
    mutationFn: () =>
      operatorFetch(`/settings/groups/tiPwa`, {
        method: 'PATCH',
        body: { rowVersion: data.rowVersion, values: { enabled, name, shortName }, secrets: {} },
        schema: setGroupResponseSchema,
      }),
    onSuccess: (next) => {
      qc.setQueryData(groupKey('tiPwa'), next);
      void qc.invalidateQueries({ queryKey: hubKey });
      setMessage({ tone: 'success', text: t('saved') });
    },
    onError: (e) =>
      setMessage({
        tone: 'danger',
        text:
          e instanceof ApiError && e.code === 'ROW_VERSION_CONFLICT'
            ? t('conflict')
            : e instanceof ApiError && e.fieldErrors[0]
              ? e.fieldErrors[0].message
              : t('failed'),
      }),
  });
  const keys = useMutation({
    mutationFn: () => operatorFetch('/settings/tiPwa/generate-keys', { method: 'POST' }),
    onSuccess: () => {
      setMessage({ tone: 'success', text: t('push.generated') });
      refresh();
    },
    onError: () => setMessage({ tone: 'danger', text: t('failed') }),
  });

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('intro')}</p>
      <ToggleRow
        id="set-ti-enabled"
        label={t('enabled.label')}
        hint={t('enabled.hint')}
        checked={enabled}
        onChange={setEnabled}
        disabled={!canEdit}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('name.label')} htmlFor="set-ti-name">
          <Input
            id="set-ti-name"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            readOnly={!canEdit}
          />
        </Field>
        <Field label={t('shortName.label')} htmlFor="set-ti-short" hint={t('shortName.hint')}>
          <Input
            id="set-ti-short"
            value={shortName}
            maxLength={12}
            onChange={(e) => setShortName(e.target.value)}
            readOnly={!canEdit}
          />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <AssetSlot
          slot="ti-192"
          url={v.icon192}
          canEdit={canEdit}
          label={t('icon192.label')}
          note={t('icon192.note')}
          onChanged={refresh}
        />
        <AssetSlot
          slot="ti-512"
          url={v.icon512}
          canEdit={canEdit}
          label={t('icon512.label')}
          note={t('icon512.note')}
          onChanged={refresh}
        />
      </div>

      <div className="space-y-2 rounded-lg border border-border p-3">
        <p className="text-sm font-semibold">
          {push.pushReady ? t('push.ready.title') : t('push.todo.title')}
        </p>
        <p className="text-xs text-muted-foreground">
          {push.pushReady ? t('push.ready.body') : t('push.todo.body')}
        </p>
        {canEdit && !push.pushReady && (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => keys.mutate()}
            disabled={keys.isPending}
          >
            {keys.isPending && <Spinner label={t('push.generating')} />}
            {t('push.generate')}
          </Button>
        )}
      </div>

      {message && <Alert tone={message.tone}>{message.text}</Alert>}
      <div className="flex flex-wrap items-center gap-3">
        {canEdit && (
          <Button type="button" onClick={() => save.mutate()} disabled={!dirty || save.isPending}>
            {save.isPending && <Spinner label={t('saving')} />}
            {t('save')}
          </Button>
        )}
        <a
          href="/api/v2/public/team-inbox-manifest.webmanifest"
          target="_blank"
          rel="noreferrer"
          className="text-sm text-primary underline-offset-2 hover:underline"
        >
          {t('manifestLink')}
        </a>
      </div>
    </div>
  );
}
