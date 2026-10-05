'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { LeadEventResponse, LeadSourceResponse } from '@crm/contracts';
import { Alert, Badge, Button, Field, Spinner, Textarea } from '@crm/ui';
import { fetchEvents, leadKeys, sendTestLead } from '../api';
import { guidanceFor, reasonView } from '../lib/event-view';
import { parsePayload } from '../lib/payload';
import { contactHref } from '../lib/source-view';
import { ErrorText, EventStatusChip } from './ui';

/**
 * "Send test lead": a sample built from the mapping (or the JSON the person pastes) goes through the real pipeline, flagged as a test.
 * It makes real rows the admin can delete; nobody is notified. The answer is the resulting event with its status. A paused source
 * refuses (409), which the panel explains before the person even tries.
 */
export function TestLeadPanel({
  source,
  canManage,
  onSent,
}: {
  source: Pick<LeadSourceResponse, 'id' | 'status'>;
  canManage: boolean;
  onSent?: (event: LeadEventResponse) => void;
}) {
  const t = useTranslations('lead-sources.test');
  const tr = useTranslations('lead-sources.reasons');
  const tg = useTranslations('lead-sources.guidance');
  const qc = useQueryClient();
  const [custom, setCustom] = useState(false);
  const [text, setText] = useState('');
  const parsed = custom && text.trim() !== '' ? parsePayload(text) : null;
  const blocked = custom && (parsed === null || !parsed.ok);

  const send = useMutation({
    mutationFn: () => sendTestLead(source.id, parsed?.ok ? parsed.payload : undefined),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: leadKeys.eventsOf(source.id) });
      void qc.invalidateQueries({ queryKey: leadKeys.one(source.id) });
      void qc.invalidateQueries({ queryKey: leadKeys.list });
      onSent?.(res.event);
    },
  });
  const event = send.data?.event;
  const paused = source.status === 'paused';
  const reason = event ? reasonView(event.reason) : null;
  const guidance = event ? guidanceFor(event.status, event.reason) : null;

  return (
    <section
      aria-labelledby="ls-test-title"
      className="space-y-3 rounded-md border border-border p-4"
    >
      <div className="space-y-1">
        <h3 id="ls-test-title" className="text-base font-semibold">
          {t('title')}
        </h3>
        <p className="text-sm text-muted-foreground">{t('help')}</p>
      </div>

      {paused && <Alert tone="warning">{t('paused')}</Alert>}

      {canManage ? (
        <>
          <div className="space-y-2">
            <button
              type="button"
              aria-expanded={custom}
              onClick={() => setCustom((v) => !v)}
              className="text-xs font-medium text-primary underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-primary"
            >
              {custom ? t('useSample') : t('useOwn')}
            </button>
            {custom && (
              <Field
                label={t('payload')}
                htmlFor="ls-test-payload"
                hint={t('payloadHint')}
                error={parsed && !parsed.ok ? t(`payloadProblems.${parsed.reason}`) : undefined}
              >
                <Textarea
                  id="ls-test-payload"
                  dir="ltr"
                  rows={6}
                  spellCheck={false}
                  value={text}
                  className="font-mono text-xs"
                  invalid={Boolean(parsed && !parsed.ok)}
                  onChange={(e) => setText(e.target.value)}
                />
              </Field>
            )}
          </div>
          <Button
            type="button"
            disabled={paused || blocked || send.isPending}
            onClick={() => send.mutate()}
          >
            {send.isPending && <Spinner />}
            {t('send')}
          </Button>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">{t('needsManage')}</p>
      )}

      <div aria-live="polite">
        {send.isError && <ErrorText error={send.error} />}
        {event && (
          <Alert
            tone={
              event.status === 'failed'
                ? 'danger'
                : event.status === 'needs_review'
                  ? 'warning'
                  : 'success'
            }
            className="space-y-1"
            data-testid="test-result"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{t('result')}</span>
              <EventStatusChip status={event.status} />
              <Badge>{t('flag')}</Badge>
            </div>
            {reason && <p className="text-xs">{reason.known ? tr(reason.code) : reason.raw}</p>}
            {event.error && (
              <p dir="auto" className="break-words text-xs">
                {event.error}
              </p>
            )}
            {guidance && <p className="text-xs">{tg(guidance.key)}</p>}
            {event.contactId && (
              <Link
                href={contactHref(event.contactId)}
                className="text-xs font-medium underline underline-offset-2"
              >
                {t('openContact')}
              </Link>
            )}
          </Alert>
        )}
      </div>
    </section>
  );
}

/**
 * "Waiting for the first lead": polls the source's real (non-test) events every few seconds until one arrives, so a person pasting the
 * URL into their tool sees it work without reloading. It stops when a lead is there and pauses while the tab is hidden.
 */
export function FirstLeadWatch({ sourceId }: { sourceId: string }) {
  const t = useTranslations('lead-sources.watch');
  const q = useQuery({
    queryKey: leadKeys.events(sourceId, 'first-lead', 'hide'),
    queryFn: ({ signal }) => fetchEvents(sourceId, { limit: 1, isTest: 'false' }, signal),
    refetchInterval: (query) =>
      query.state.data && query.state.data.data.length > 0 ? false : 5000,
    retry: false,
  });
  const first = q.data?.data[0];
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="first-lead-watch"
      className="flex flex-wrap items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm"
    >
      {first ? (
        <>
          <span>{t('received')}</span>
          <EventStatusChip status={first.status} />
        </>
      ) : q.isError ? (
        <span className="text-muted-foreground">{t('error')}</span>
      ) : (
        <>
          <Spinner />
          <span className="text-muted-foreground">{t('waiting')}</span>
        </>
      )}
    </div>
  );
}
