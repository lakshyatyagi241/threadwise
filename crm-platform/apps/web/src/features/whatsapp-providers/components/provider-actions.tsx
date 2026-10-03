'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation } from '@tanstack/react-query';
import { Button, ConfirmDialog, Menu, MenuItem, Modal } from '@crm/ui';
import { useToast } from '@/features/auth-registration-security/platform/ui/toast';
import { providersApi } from '../api/client';
import { useRefreshAll } from '../api/hooks';
import type { Provider, TestInput, TestResult } from '../api/schemas';
import type { WapAccess } from '../lib/access';
import { errorView } from '../lib/errors';
import { canDelete, canDisable, canMakeDefault } from '../lib/health';
import { TestPanel } from './test-panel';

type Pending = null | 'default' | 'disable' | 'enable' | 'delete';

/** The error toast every write shares: the message by kind, and a refresh when the row moved underneath us. */
export function useWriteError() {
  const te = useTranslations('whatsapp-providers.errors');
  const toast = useToast();
  const refresh = useRefreshAll();
  return (e: unknown) => {
    const { kind } = errorView(e);
    toast.error(te(kind));
    if (kind === 'conflict' || kind === 'notFound') void refresh();
  };
}

/**
 * The actions of one provider: edit, test, and a menu for make default, enable or disable, and delete. Disabled entries say why
 * in the confirmation text rather than hiding, so an operator learns the rule instead of wondering where the button went.
 * `onDeleted` lets the detail page leave once its provider is gone.
 */
export function ProviderActions({
  provider: p,
  access,
  onDeleted,
  showEdit = true,
  only,
}: {
  provider: Provider;
  access: WapAccess;
  onDeleted?: () => void;
  showEdit?: boolean;
  /** `danger`: just the disable and delete buttons, for the detail page's danger zone. */
  only?: 'danger';
}) {
  const t = useTranslations('whatsapp-providers.actions');
  const toast = useToast();
  const refresh = useRefreshAll();
  const onError = useWriteError();
  const [pending, setPending] = useState<Pending>(null);
  const [testing, setTesting] = useState(false);
  const [ids, setIds] = useState<TestInput>({ wabaId: '', phoneNumberId: '' });
  const [result, setResult] = useState<TestResult | null>(null);

  const done = (message: string) => {
    toast.success(message);
    setPending(null);
    void refresh();
  };

  const makeDefault = useMutation({
    mutationFn: () => providersApi.makeDefault(p.id, p.rowVersion),
    onSuccess: () => done(t('doneDefault', { label: p.label })),
    onError: (e) => {
      setPending(null);
      onError(e);
    },
  });
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => providersApi.setEnabled(p.id, enabled, p.rowVersion),
    onSuccess: (_r, enabled) => done(t(enabled ? 'doneEnable' : 'doneDisable', { label: p.label })),
    onError: (e) => {
      setPending(null);
      onError(e);
    },
  });
  const remove = useMutation({
    mutationFn: () => providersApi.remove(p.id),
    onSuccess: () => {
      done(t('doneDelete', { label: p.label }));
      onDeleted?.();
    },
    onError: (e) => {
      setPending(null);
      onError(e);
    },
  });

  const busy = makeDefault.isPending || toggle.isPending || remove.isPending;
  const menuHasItems = access.manage && !only;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {only === 'danger' && access.manage && (
        <>
          {p.status === 'active' ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={!canDisable(p)}
              onClick={() => setPending('disable')}
            >
              {t('disable')}
            </Button>
          ) : (
            <Button variant="secondary" size="sm" onClick={() => setPending('enable')}>
              {t('enable')}
            </Button>
          )}
          <Button
            variant="danger"
            size="sm"
            disabled={!canDelete(p)}
            onClick={() => setPending('delete')}
          >
            {t('delete')}
          </Button>
        </>
      )}
      {!only && showEdit && (
        <Link href={`/admin/whatsapp-providers/${p.id}`}>
          <Button variant="secondary" size="sm" type="button">
            {access.manage ? t('edit') : t('view')}
          </Button>
        </Link>
      )}
      {!only && access.manage && (
        <Button
          variant="secondary"
          size="sm"
          type="button"
          onClick={() => {
            setResult(null);
            setTesting(true);
          }}
        >
          {t('test')}
        </Button>
      )}
      {menuHasItems && (
        <Menu
          label={t('more', { label: p.label })}
          trigger={<span>{t('moreShort')}</span>}
          triggerClassName="h-8 px-3"
          align="end"
        >
          <MenuItem disabled={!canMakeDefault(p)} onSelect={() => setPending('default')}>
            {t('makeDefault')}
          </MenuItem>
          {p.status === 'active' ? (
            <MenuItem disabled={!canDisable(p)} onSelect={() => setPending('disable')}>
              {t('disable')}
            </MenuItem>
          ) : (
            <MenuItem onSelect={() => setPending('enable')}>{t('enable')}</MenuItem>
          )}
          <MenuItem danger disabled={!canDelete(p)} onSelect={() => setPending('delete')}>
            {t('delete')}
          </MenuItem>
        </Menu>
      )}

      {pending && (
        <>
          <ConfirmDialog
            open={pending === 'default'}
            title={t('confirmDefault.title', { label: p.label })}
            message={
              <div className="space-y-2">
                <p>{t('confirmDefault.body')}</p>
                <p>{t('confirmDefault.newOnly')}</p>
              </div>
            }
            confirmLabel={t('confirmDefault.confirm')}
            cancelLabel={t('cancel')}
            busy={busy}
            onConfirm={() => makeDefault.mutate()}
            onClose={() => setPending(null)}
          />
          <ConfirmDialog
            open={pending === 'disable'}
            title={t('confirmDisable.title', { label: p.label })}
            message={t('confirmDisable.body', { count: p.channelCount })}
            confirmLabel={t('confirmDisable.confirm')}
            cancelLabel={t('cancel')}
            tone="danger"
            busy={busy}
            onConfirm={() => toggle.mutate(false)}
            onClose={() => setPending(null)}
          />
          <ConfirmDialog
            open={pending === 'enable'}
            title={t('confirmEnable.title', { label: p.label })}
            message={t('confirmEnable.body')}
            confirmLabel={t('confirmEnable.confirm')}
            cancelLabel={t('cancel')}
            busy={busy}
            onConfirm={() => toggle.mutate(true)}
            onClose={() => setPending(null)}
          />
          <ConfirmDialog
            open={pending === 'delete'}
            title={t('confirmDelete.title', { label: p.label })}
            message={t('confirmDelete.body')}
            confirmLabel={t('confirmDelete.confirm')}
            cancelLabel={t('cancel')}
            tone="danger"
            busy={busy}
            onConfirm={() => remove.mutate()}
            onClose={() => setPending(null)}
          />
        </>
      )}
      {testing && (
        <Modal
          open={testing}
          onClose={() => setTesting(false)}
          title={t('testTitle', { label: p.label })}
          closeLabel={t('close')}
          size="md"
        >
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
        </Modal>
      )}
    </div>
  );
}
