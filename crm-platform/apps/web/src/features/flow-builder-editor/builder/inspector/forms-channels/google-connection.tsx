'use client';

import { useTranslations } from 'next-intl';
import type { GoogleCapability } from '@crm/contracts';
import { useGoogleSummary } from '../../../api/hooks';
import { Notice } from '../kit';
import { ExtLink } from './shared';

const NS = 'flb.builder.formsChannels.google.connection';

/**
 * Above a Google step's fields: says plainly, before the flow ever runs, when the workspace's Google account cannot do what this step
 * needs (not set up, not connected, needs reconnecting, or connected without the permission). Silent while the answer loads, and for
 * a role that may not read it: the notice is a help, never a blocker (the step still saves, and at run time it fails with a message that says to connect Google).
 */
export function GoogleConnectionNotice({ need }: { need: GoogleCapability }) {
  const t = useTranslations(NS);
  const q = useGoogleSummary();
  if (!q.data) return null;
  const s = q.data;
  const kind =
    s.status === 'unavailable'
      ? 'unavailable'
      : s.status === 'disconnected'
        ? 'disconnected'
        : s.status === 'needs_reconnect'
          ? 'needsReconnect'
          : s.granted.includes(need)
            ? null
            : 'missing';
  if (!kind) return null;
  return (
    <Notice tone="warn" className="mb-2">
      {t(kind, { permission: t(`permission.${need}`) })}{' '}
      <ExtLink href="/google-account">{t('open')}</ExtLink>
    </Notice>
  );
}
