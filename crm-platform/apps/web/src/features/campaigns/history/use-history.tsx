'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { useRef, useState, type ReactNode } from 'react';
import { ConfirmDialog, useToast } from '@crm/ui';
import { useSession } from '@/features/auth-registration-security/shared/session-context';
import { ApiError } from '@/lib/api/errors';
import { controlBroadcast, type BroadcastAction } from '../wizard/api/wizard';
import { defaultTimeZone } from '../wizard/lib/schedule';

/** The workspace's time zone (the browser's, then UTC, when none is set) and a formatter that shows instants in it. */
export function useWorkspaceTime() {
  const session = useSession();
  const format = useFormatter();
  const zone = defaultTimeZone(session.org.timezone);
  return {
    zone,
    when: (iso: string | null | undefined): string =>
      iso
        ? format.dateTime(new Date(iso), {
            dateStyle: 'medium',
            timeStyle: 'short',
            timeZone: zone,
          })
        : '-',
  };
}

/** Scrolls a row into view once, when it is the one a launch just made. */
export function useScrollTo() {
  const done = useRef(false);
  return (el: HTMLElement | null) => {
    if (el && !done.current) {
      done.current = true;
      el.scrollIntoView({ block: 'nearest' });
    }
  };
}

/**
 * Pause, resume and cancel from a list row: the same endpoints and messages as the status page, with the cancel confirmed first.
 * Render `dialog` once in the screen.
 */
export function useRowControl(): {
  busy: string | null;
  act: (id: string, action: BroadcastAction, series: boolean) => void;
  dialog: ReactNode;
} {
  const t = useTranslations('campaigns.wizard.status');
  const qc = useQueryClient();
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ id: string; series: boolean } | null>(null);

  const run = async (id: string, action: BroadcastAction) => {
    setBusy(`${id}:${action}`);
    try {
      await controlBroadcast(id, action);
      toast(t(`done.${action}`), 'success');
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t('failed'), 'danger');
    } finally {
      setBusy(null);
      void qc.invalidateQueries({ queryKey: ['camp'] });
    }
  };

  return {
    busy,
    act: (id, action, series) =>
      action === 'cancel' ? setConfirm({ id, series }) : void run(id, action),
    dialog: (
      <ConfirmDialog
        open={confirm !== null}
        tone="danger"
        busy={busy?.endsWith(':cancel') ?? false}
        title={t('cancelTitle')}
        message={confirm?.series ? t('cancelSeries') : t('cancelOne')}
        confirmLabel={t('action.cancel')}
        cancelLabel={t('keep')}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          const c = confirm;
          setConfirm(null);
          if (c) void run(c.id, 'cancel');
        }}
      />
    ),
  };
}
