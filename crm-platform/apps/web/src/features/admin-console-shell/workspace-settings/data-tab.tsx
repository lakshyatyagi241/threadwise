'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { EXPORT_TYPES } from '@crm/contracts';
import { Alert, Button, Card, ConfirmDialog, Field, Input, PasswordInput, Spinner } from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import { useDeleteWorkspace, useExportCounts, useWorkspaceSettings } from './api';
import { canSubmitDelete } from './logic';
import { ResidencyCard } from './residency-card';

const NS = 'admin-console-shell.workspaceSettings.data';

/** TW-ASHELL-043 (CSV export cards) and TW-ASHELL-044 (delete workspace, owner only). */
export function DataTab() {
  const t = useTranslations(NS);
  const counts = useExportCounts();
  if (counts.isPending) return <Spinner />;
  if (counts.isError || !counts.data) return <Alert tone="danger">{t('loadFailed')}</Alert>;
  const c = counts.data;
  return (
    <div className="space-y-5">
      <Card className="space-y-3 p-6">
        <h2 className="font-serif text-xl">{t('exportTitle')}</h2>
        <p className="text-xs text-muted-foreground">{t('exportNote')}</p>
        {!c.isOwner && (
          <p className="text-xs italic text-muted-foreground">{t('exportOwnerOnly')}</p>
        )}
        <div className="grid gap-3 sm:grid-cols-3">
          {EXPORT_TYPES.map((type) => {
            const body = (
              <>
                <div className="text-sm font-semibold">{t(`types.${type}`)}</div>
                <div className="text-xs text-muted-foreground">
                  {t(`count.${type}`, { count: c[type] })}
                </div>
              </>
            );
            return c.isOwner ? (
              <a
                key={type}
                href={`/api/v2/shell/workspace/export/${type}`}
                download={`${type}.csv`}
                className="block rounded-xl border border-border p-4 transition hover:border-primary"
              >
                {body}
              </a>
            ) : (
              <div key={type} className="rounded-xl border border-border p-4 opacity-60">
                {body}
              </div>
            );
          })}
        </div>
      </Card>
      <ResidencyCard />
      <DeleteCard />
    </div>
  );
}

function DeleteCard() {
  const t = useTranslations(`${NS}.delete`);
  const ws = useWorkspaceSettings();
  const del = useDeleteWorkspace();
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState(false);
  if (!ws.data) return null;

  const fieldError = (path: string) =>
    del.error instanceof ApiError
      ? del.error.fieldErrors.find((d) => d.path === path)?.message
      : undefined;

  return (
    <Card className="space-y-3 border-2 border-danger/40 p-6">
      <h2 className="text-xl font-semibold text-danger">{t('title')}</h2>
      <p className="text-sm">
        {t('note')} <strong>{t('irreversible')}</strong>
      </p>
      {!ws.data.isOwner ? (
        <p className="text-xs italic text-muted-foreground">{t('ownerOnly')}</p>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmitDelete(name, password)) setConfirm(true);
          }}
        >
          <Field
            label={
              <>
                {t('typeName')} <span className="font-mono">{ws.data.name}</span>
              </>
            }
            htmlFor="del-name"
            error={fieldError('confirmName')}
          >
            <Input
              id="del-name"
              value={name}
              required
              className="font-mono"
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label={t('password')} htmlFor="del-pw" error={fieldError('password')}>
            <PasswordInput
              id="del-pw"
              value={password}
              required
              autoComplete="current-password"
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          {del.isError && !fieldError('confirmName') && !fieldError('password') && (
            <Alert tone="danger">{t('failed')}</Alert>
          )}
          <Button type="submit" variant="danger" disabled={!canSubmitDelete(name, password)}>
            {t('submit')}
          </Button>
        </form>
      )}
      <ConfirmDialog
        open={confirm}
        title={t('confirmTitle')}
        message={t('confirmMessage', { name: ws.data.name })}
        confirmLabel={t('submit')}
        cancelLabel={t('cancel')}
        tone="danger"
        busy={del.isPending}
        onClose={() => setConfirm(false)}
        onConfirm={() =>
          del.mutate(
            { confirmName: name, password },
            {
              onSuccess: () => window.location.assign('/login'),
              onSettled: () => setConfirm(false),
            },
          )
        }
      />
    </Card>
  );
}
