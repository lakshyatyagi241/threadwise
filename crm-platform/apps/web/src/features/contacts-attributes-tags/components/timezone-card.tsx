'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { contactSendWindowSchema } from '@crm/contracts';
import { Button, Spinner, useToast } from '@crm/ui';
import { apiFetch } from '@/lib/api/client';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { invalidateContacts, KEYS, updateContact } from '../api/contacts';
import { sourceKey } from '../lib/timezone';
import { TimezoneSelect } from './timezone-select';

const SEND_WINDOW = (id: string) => ['cat', 'contact-send-window', id] as const;

/**
 * The clock a contact's marketing messages are read on (BL-193): the zone stored on the contact and who set it, or else where the
 * clock comes from (the country of the number, your fallback, the workspace), what time it is there, what the quiet hours say right
 * now and when the next marketing message may go, and how many already wait. Anyone who may edit contacts can set or clear the zone.
 * The answer comes from the same rule the senders use, so this card cannot disagree with them.
 */
export function TimezoneCard({
  contactId,
  rowVersion,
  className,
}: {
  contactId: string;
  rowVersion: number;
  className?: string;
}) {
  const t = useTranslations('contacts-attributes-tags.timezone');
  const locale = useLocale();
  const qc = useQueryClient();
  const { toast } = useToast();
  const canUpdate = useCan('record.contacts.update');
  const [editing, setEditing] = useState(false);
  const [zone, setZone] = useState('');

  const q = useQuery({
    queryKey: SEND_WINDOW(contactId),
    queryFn: ({ signal }) =>
      apiFetch(`/contacts/${contactId}/send-window`, { schema: contactSendWindowSchema, signal }),
    retry: false,
  });

  const save = useMutation({
    mutationFn: (next: string) =>
      updateContact(contactId, { timezone: next === '' ? null : next, rowVersion }),
    onSuccess: async () => {
      setEditing(false);
      toast(t('saved'), 'success');
      await Promise.all([
        invalidateContacts(qc),
        qc.invalidateQueries({ queryKey: KEYS.contact(contactId) }),
        qc.invalidateQueries({ queryKey: SEND_WINDOW(contactId) }),
      ]);
    },
    onError: () => toast(t('failed'), 'danger'),
  });

  if (q.isLoading) {
    return (
      <section className={className} aria-busy="true">
        <Spinner />
      </section>
    );
  }
  if (!q.data) return null;
  const w = q.data;
  const when = (iso: string) =>
    new Date(iso).toLocaleString(locale, w.clock.zone ? { timeZone: w.clock.zone } : undefined);

  return (
    <section
      className={`rounded-md border border-border bg-background p-4 ${className ?? ''}`}
      data-testid="contact-timezone-card"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {t('title')}
          </h2>
          <p className="mt-1 text-sm font-medium" data-testid="timezone-zone">
            {w.clock.zone ?? t('several', { count: w.clock.zones.length })}
          </p>
          <p className="text-xs text-muted-foreground" data-testid="timezone-source">
            {t(`source.${sourceKey(w)}`)}
            {w.clock.localTime ? ` · ${t('localTime', { time: w.clock.localTime })}` : ''}
          </p>
        </div>
        {canUpdate && !editing && (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => {
              setZone(w.timezone ?? '');
              setEditing(true);
            }}
          >
            {t('change')}
          </Button>
        )}
      </div>

      {editing && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="min-w-[14rem] flex-1">
            <TimezoneSelect value={zone} onChange={setZone} />
          </div>
          <Button
            type="button"
            size="sm"
            disabled={save.isPending}
            onClick={() => save.mutate(zone)}
          >
            {save.isPending && <Spinner />}
            {t('save')}
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => setEditing(false)}>
            {t('cancel')}
          </Button>
        </div>
      )}

      <p
        className={`mt-3 text-sm ${w.quietHours === 'held' ? 'text-warning' : 'text-muted-foreground'}`}
        data-testid="timezone-quiet"
      >
        {w.quietHours === 'held' && w.nextSendAt
          ? t('quiet.held', { when: when(w.nextSendAt) })
          : t(`quiet.${w.quietHours}`)}
      </p>
      {w.heldCount > 0 && (
        <p className="mt-1 text-sm text-warning" data-testid="timezone-held">
          {t('held', { count: w.heldCount })}
          {w.heldUntil ? ` · ${t('heldUntil', { when: when(w.heldUntil) })}` : ''}
        </p>
      )}
    </section>
  );
}
