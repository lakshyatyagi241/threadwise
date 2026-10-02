'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Spinner, cn } from '@crm/ui';
import { useDocEvents } from '../api/hooks';
import type { DocEvent, EventType } from '../api/schemas';
import { isUnavailable } from '../lib/errors';
import { formatDateTime } from '../lib/format';
import { Drawer } from './drawer';
import {
  CalendarIcon,
  CheckIcon,
  ClockIcon,
  CopyDocIcon,
  DealIcon,
  EyeIcon,
  InvoiceIcon,
  LinkIcon,
  PencilIcon,
  PlusIcon,
  SendIcon,
  UndoIcon,
  XIcon,
} from './icons';
import { ErrorLine, useWorkspaceZone } from './parts';

const ICON: Record<EventType, typeof CheckIcon> = {
  created: PlusIcon,
  edited: PencilIcon,
  duplicated: CopyDocIcon,
  sent: SendIcon,
  viewed: EyeIcon,
  accepted: CheckIcon,
  declined: XIcon,
  expired: ClockIcon,
  revised: UndoIcon,
  extended: CalendarIcon,
  converted_invoice: InvoiceIcon,
  converted_deal: DealIcon,
  link_regenerated: LinkIcon,
  link_revoked: LinkIcon,
};
const TONE: Partial<Record<EventType, string>> = {
  accepted: 'bg-success/15 text-success',
  declined: 'bg-danger/15 text-danger',
  expired: 'bg-warning/15 text-warning',
  viewed: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
  converted_invoice: 'bg-brand/15 text-brand dark:text-primary',
  converted_deal: 'bg-brand/15 text-brand dark:text-primary',
  sent: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  link_revoked: 'bg-danger/15 text-danger',
};

const CHANNELS = ['link', 'email', 'whatsapp'] as const;

function Line({ e }: { e: DocEvent }) {
  const t = useTranslations('sales-docs.activity');
  const locale = useLocale();
  const zone = useWorkspaceZone();
  const Icon = ICON[e.type];
  const who =
    e.actor.name ||
    (e.actor.kind === 'buyer'
      ? t('buyer')
      : e.actor.kind === 'system'
        ? t('system')
        : t('someone'));
  const channel =
    e.channel && (CHANNELS as readonly string[]).includes(e.channel) ? e.channel : null;
  // A decision made by a person on the team is "recorded", the buyer's own comes with a signature and an address.
  const byStaff = (e.type === 'accepted' || e.type === 'declined') && e.actor.kind === 'user';
  const detail = [
    e.type === 'sent' && channel ? t('via', { channel: t(`channels.${channel}`) }) : null,
    e.type === 'accepted' && e.signerName ? t('signedBy', { name: e.signerName }) : null,
    e.type === 'accepted' && e.hasSignature ? t('withSignature') : null,
    byStaff ? t('recordedByStaff') : null,
    e.comment
      ? e.type === 'declined'
        ? t('reason', { reason: e.comment })
        : t('note', { note: e.comment })
      : null,
    e.revision > 1 && (e.type === 'revised' || e.type === 'sent')
      ? t('revision', { revision: e.revision })
      : null,
    (e.type === 'accepted' || e.type === 'declined') && e.actor.kind === 'buyer' && e.ip
      ? t('fromAddress', { ip: e.ip })
      : null,
  ].filter(Boolean) as string[];
  return (
    <li className="relative flex gap-3 pb-5 last:pb-0 [&:last-child>[data-line]]:hidden">
      <span
        aria-hidden="true"
        data-line
        className="absolute start-[15px] top-8 bottom-0 w-px bg-border"
      />
      <span
        className={cn(
          'relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full',
          TONE[e.type] ?? 'bg-muted text-muted-foreground',
        )}
      >
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <p className="text-sm font-medium">{t(`events.${e.type}`, { who })}</p>
        {detail.map((d) => (
          <p key={d} className="mt-0.5 text-sm text-muted-foreground" dir="auto">
            {d}
          </p>
        ))}
        <time dateTime={e.at} className="mt-0.5 block text-xs text-muted-foreground tabular-nums">
          {formatDateTime(e.at, locale, zone)}
        </time>
      </div>
    </li>
  );
}

/** The history of one document: created, sent (and how), viewed, accepted (with the signer's name), declined, converted. */
export function ActivityDrawer({
  docId,
  number,
  onClose,
}: {
  docId: string;
  number: string;
  onClose: () => void;
}) {
  const t = useTranslations('sales-docs.activity');
  const q = useDocEvents(docId);
  return (
    <Drawer onClose={onClose} title={t('title', { number })} closeLabel={t('close')}>
      <div className="space-y-4 p-5">
        <div className="pe-10">
          <h2 className="text-lg font-semibold" aria-hidden="true">
            {t('title', { number })}
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        {q.isPending ? (
          <div role="status" className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Spinner /> {t('loading')}
          </div>
        ) : q.isError ? (
          isUnavailable(q.error) ? (
            <p className="text-sm text-muted-foreground">{t('unavailable')}</p>
          ) : (
            <ErrorLine error={q.error} onRetry={() => void q.refetch()} />
          )
        ) : q.data.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t('empty')}</p>
        ) : (
          <ol className="relative">
            {q.data.map((e) => (
              <Line key={e.id} e={e} />
            ))}
          </ol>
        )}
      </div>
    </Drawer>
  );
}
