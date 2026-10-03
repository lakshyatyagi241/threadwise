'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { WhatsappProvider } from '@crm/contracts';
import { Button, ConfirmDialog, Menu, MenuItem, Spinner } from '@crm/ui';
import { useToast } from '@/features/auth-registration-security/platform/ui/toast';
import {
  clearDefaultProvider,
  runProviderAction,
  wapKeys,
  type ProviderStatusAction,
} from '../api';
import { wapError } from '../lib/errors';
import type { WapAccess } from '../lib/permissions';
import { providerActions, type ActionBlock } from '../lib/provider-view';
import { useErrorText } from './ui';

const NS = 'whatsapp-providers.actions';

type Confirmable = 'disable' | 'archive' | 'default' | 'clearDefault';

/**
 * Activate, disable, archive and the default, with the confirmation each deserves (disable and the default change where new
 * numbers go; archive retires a provider; none of them moves a number that is already connected). The buttons follow the API's
 * own rules: an action the API would refuse says why instead of being hidden or left dead.
 */
export function ProviderActionButtons({
  provider,
  access,
  layout,
}: {
  provider: WhatsappProvider;
  access: WapAccess;
  /** `menu`: one compact menu (a table row). `buttons`: inline buttons with the reasons written out (the detail page). */
  layout: 'menu' | 'buttons';
}) {
  const t = useTranslations(NS);
  const tb = useTranslations(`${NS}.blocked`);
  const toast = useToast();
  const qc = useQueryClient();
  const errorText = useErrorText();
  const [confirm, setConfirm] = useState<Confirmable | null>(null);
  const actions = providerActions(provider, access);

  const done = (key: string) => {
    toast.success(t(`done.${key}`, { name: provider.label }));
    setConfirm(null);
    void qc.invalidateQueries({ queryKey: wapKeys.all });
  };
  const failed = (e: unknown) => {
    toast.error(errorText(e).text);
    setConfirm(null);
    if (wapError(e).kind === 'conflict') void qc.invalidateQueries({ queryKey: wapKeys.all });
  };

  const run = useMutation({
    mutationFn: (action: ProviderStatusAction) =>
      runProviderAction(provider.id, action, provider.rowVersion),
    onSuccess: (_p, action) => done(action),
    onError: failed,
  });
  const clear = useMutation({
    mutationFn: () => clearDefaultProvider(),
    onSuccess: () => done('clearDefault'),
    onError: failed,
  });
  const busy = run.isPending || clear.isPending;

  const apply = () => {
    if (confirm === 'clearDefault') clear.mutate();
    else if (confirm) run.mutate(confirm);
  };

  const reason = (b: ActionBlock | undefined) => (b ? tb(b) : undefined);

  const items: Array<{
    id: string;
    label: string;
    enabled: boolean;
    block?: ActionBlock;
    danger?: boolean;
    onSelect: () => void;
    primary?: boolean;
  }> = [
    ...(actions.activate.enabled
      ? [
          {
            id: 'activate',
            label: t('activate'),
            enabled: true,
            primary: true,
            onSelect: () => run.mutate('activate'),
          },
        ]
      : []),
    ...(actions.makeDefault.enabled
      ? [
          {
            id: 'default',
            label: t('makeDefault'),
            enabled: true,
            onSelect: () => setConfirm('default'),
          },
        ]
      : []),
    ...(actions.clearDefault
      ? [
          {
            id: 'clearDefault',
            label: t('clearDefault'),
            enabled: true,
            onSelect: () => setConfirm('clearDefault'),
          },
        ]
      : []),
    ...(provider.status === 'active'
      ? [
          {
            id: 'disable',
            label: t('disable'),
            enabled: actions.disable.enabled,
            block: actions.disable.blocked,
            onSelect: () => setConfirm('disable'),
          },
        ]
      : []),
    ...(provider.status !== 'archived'
      ? [
          {
            id: 'archive',
            label: t('archive'),
            enabled: actions.archive.enabled,
            block: actions.archive.blocked,
            danger: true,
            onSelect: () => setConfirm('archive'),
          },
        ]
      : []),
  ];

  const dialog = (
    <ConfirmDialog
      open={confirm !== null}
      title={confirm ? t(`confirm.${confirm}.title`, { name: provider.label }) : ''}
      message={confirm ? <ConfirmBody kind={confirm} provider={provider} /> : null}
      confirmLabel={confirm ? t(`confirm.${confirm}.action`) : ''}
      cancelLabel={t('cancel')}
      tone={confirm === 'archive' || confirm === 'disable' ? 'danger' : 'default'}
      busy={busy}
      onConfirm={apply}
      onClose={() => setConfirm(null)}
    />
  );

  if (!access.manage || items.length === 0) return layout === 'menu' ? null : dialog;

  if (layout === 'menu') {
    return (
      <>
        <Menu
          label={t('menuLabel', { name: provider.label })}
          trigger={busy ? <Spinner /> : t('menu')}
          align="end"
          disabled={busy}
          triggerClassName="h-8 px-3"
        >
          {items.map((i) => (
            <MenuItem
              key={i.id}
              disabled={!i.enabled}
              danger={i.danger && i.enabled}
              hint={reason(i.block)}
              onSelect={i.onSelect}
            >
              {i.label}
            </MenuItem>
          ))}
        </Menu>
        {dialog}
      </>
    );
  }

  return (
    <>
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {items.map((i) => (
            <Button
              key={i.id}
              variant={i.danger ? 'secondary' : i.primary ? 'primary' : 'secondary'}
              className={i.danger && i.enabled ? 'text-danger' : undefined}
              disabled={!i.enabled || busy}
              aria-describedby={i.block ? `block-${i.id}` : undefined}
              onClick={i.onSelect}
            >
              {busy && i.primary && <Spinner />}
              {i.label}
            </Button>
          ))}
        </div>
        {items
          .filter((i) => i.block)
          .map((i) => (
            <p key={i.id} id={`block-${i.id}`} className="text-xs text-muted-foreground">
              {i.label}: {reason(i.block)}
            </p>
          ))}
      </div>
      {dialog}
    </>
  );
}

function ConfirmBody({
  kind,
  provider,
}: {
  kind: Confirmable;
  provider: WhatsappProvider;
}): ReactNode {
  const t = useTranslations(`${NS}.confirm`);
  return (
    <div className="space-y-2">
      <p>{t(`${kind}.body`, { name: provider.label })}</p>
      {kind === 'disable' && provider.numberCount > 0 && (
        <p className="font-medium">{t('disable.inUse', { count: provider.numberCount })}</p>
      )}
    </div>
  );
}

const linkClass =
  'inline-flex h-8 items-center rounded-md border border-border px-3 text-sm font-medium hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary';

/** Move a workspace's numbers to this provider (needs the switch permission and an active provider). */
export function SwitchLink({
  provider,
  access,
}: {
  provider: WhatsappProvider;
  access: WapAccess;
}) {
  const t = useTranslations(NS);
  if (!access.switch || provider.status !== 'active') return null;
  return (
    <Link href={`/admin/whatsapp-providers/switch?target=${provider.id}`} className={linkClass}>
      {t('switchTo')}
    </Link>
  );
}

/** The links a provider row offers by permission: open or manage, and switch numbers. */
export function ProviderLinks({
  provider,
  access,
}: {
  provider: WhatsappProvider;
  access: WapAccess;
}) {
  const t = useTranslations(NS);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link href={`/admin/whatsapp-providers/${provider.id}`} className={linkClass}>
        {access.manage ? t('manage') : t('open')}
      </Link>
      <SwitchLink provider={provider} access={access} />
    </div>
  );
}
