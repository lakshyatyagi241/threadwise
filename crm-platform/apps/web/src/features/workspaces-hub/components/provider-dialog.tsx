'use client';

import { useId, useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { WorkspaceHubRow } from '@crm/contracts';
import { Alert, Button, Field, Input, Modal, Select, Spinner } from '@crm/ui';
import { useToast } from '@/features/auth-registration-security/platform/ui/toast';
import {
  clearAssignment,
  fetchProviders,
  setAssignment,
  wapKeys,
} from '@/features/whatsapp-providers/api';
import { selectableProviders } from '@/features/whatsapp-providers/lib/provider-view';
import { hubKeys } from '../api';
import { HubErrorLine } from './error-line';

/** "Change and set provider": pick the provider new numbers of this workspace connect through, or go back to the default. */
export function ProviderDialog({
  workspace,
  onClose,
}: {
  workspace: Pick<WorkspaceHubRow, 'workspaceId' | 'name' | 'provider'> | null;
  onClose: () => void;
}) {
  const t = useTranslations('workspaces-hub.provider');
  const ts = useTranslations('workspaces-hub.cell.providerSource');
  const tc = useTranslations('workspaces-hub.common');
  const toast = useToast();
  const qc = useQueryClient();
  const fieldId = useId();
  const noteId = useId();
  const [pick, setPick] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const providers = useQuery({
    queryKey: wapKeys.list,
    queryFn: ({ signal }) => fetchProviders(signal),
    enabled: workspace !== null,
    refetchOnWindowFocus: false,
  });
  const options = useMemo(() => selectableProviders(providers.data?.data ?? []), [providers.data]);
  const current = options.find((p) => p.key === workspace?.provider.key);
  const chosen = pick ?? current?.id ?? options[0]?.id ?? '';
  const hasOverride = workspace?.provider.source === 'override';
  const name = workspace?.name ?? '';

  const finish = async (message: string) => {
    toast.success(message);
    await Promise.all([
      qc.invalidateQueries({ queryKey: hubKeys.all }),
      qc.invalidateQueries({ queryKey: wapKeys.all }),
    ]);
    close();
  };

  const save = useMutation({
    mutationFn: () =>
      setAssignment(workspace!.workspaceId, {
        providerId: chosen,
        ...(note.trim() ? { note: note.trim() } : {}),
      }),
    onSuccess: () => finish(t('saved', { name })),
  });
  const clear = useMutation({
    mutationFn: () => clearAssignment(workspace!.workspaceId),
    onSuccess: () => finish(t('cleared', { name })),
  });
  const busy = save.isPending || clear.isPending;

  const close = () => {
    setPick(null);
    setNote('');
    save.reset();
    clear.reset();
    onClose();
  };

  return (
    <Modal
      open={workspace !== null}
      onClose={() => {
        if (!busy) close();
      }}
      title={t('title', { name })}
      closeLabel={tc('close')}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={busy}>
            {tc('cancel')}
          </Button>
          {hasOverride && (
            <Button variant="secondary" disabled={busy} onClick={() => clear.mutate()}>
              {clear.isPending && <Spinner />}
              {t('clear')}
            </Button>
          )}
          <Button disabled={busy || chosen === ''} onClick={() => save.mutate()}>
            {save.isPending && <Spinner />}
            {t('save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{t('help')}</p>
        {workspace && (
          <p className="text-sm">
            {t('current', {
              name: workspace.provider.name ?? workspace.provider.key,
              source: ts(workspace.provider.source),
            })}
          </p>
        )}
        {providers.isPending ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner label={tc('loading')} /> {tc('loading')}
          </div>
        ) : providers.isError ? (
          <Alert tone="danger" className="space-y-2">
            <HubErrorLine error={providers.error} />
            <Button size="sm" variant="secondary" onClick={() => void providers.refetch()}>
              {tc('retry')}
            </Button>
          </Alert>
        ) : options.length === 0 ? (
          <Alert tone="warning">{t('noActive')}</Alert>
        ) : (
          <Field label={t('field')} htmlFor={fieldId}>
            <Select id={fieldId} value={chosen} onChange={(e) => setPick(e.target.value)}>
              {options.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label} ({p.key})
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label={t('note')} htmlFor={noteId} hint={t('noteHint')}>
          <Input
            id={noteId}
            value={note}
            maxLength={500}
            autoComplete="off"
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
        {(save.isError || clear.isError) && <HubErrorLine error={save.error ?? clear.error} />}
        {workspace && (
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <Link
              className="text-primary hover:underline"
              href={`/admin/whatsapp-providers/switch?workspace=${workspace.workspaceId}&name=${encodeURIComponent(workspace.name)}`}
            >
              {t('switchLink')}
            </Link>
            <Link className="text-primary hover:underline" href="/admin/whatsapp-providers">
              {t('assignmentsLink')}
            </Link>
          </p>
        )}
      </div>
    </Modal>
  );
}
