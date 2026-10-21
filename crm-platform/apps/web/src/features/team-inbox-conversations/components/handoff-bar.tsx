'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import {
  HANDOFF_REASONS,
  type ConversationSummary,
  type HandoffCard,
  type HandoffReason,
  type InboxConversationDetail,
} from '@crm/contracts';
import { Alert, Badge, Button, Spinner, cn, useToast } from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import { useHandoffActions, useHandoffCard } from '../api/handoff';
import { waitAge } from '../lib/handoff';
import { AlertIcon, ChatIcon, UserPlusIcon } from './icons';
import { SendToQueueDialog } from './send-to-queue-dialog';

/** The reason picklist is the contract's; an unknown value (a newer server) is shown as written. */
const KNOWN_REASONS: readonly string[] = HANDOFF_REASONS;

export interface HandoffBarProps {
  detail: InboxConversationDetail;
  nowMs: number;
  /** May take a conversation nobody holds (`inbox.conversation.assign_self`). */
  canClaim: boolean;
  /** May send a conversation to the queue, a team or a person (`inbox.conversation.assign`). */
  canSend: boolean;
  /** May give the conversation back to the bot (`inbox.conversation.reply`). */
  canReturn: boolean;
  /** The row the server answered with, so the list and the counts follow at once. */
  onPlaced: (row: ConversationSummary) => void;
}

/**
 * The strip between the thread header and the messages: who handles the thread (the bot, the waiting queue, a person), why a person was
 * asked for, and the actions that move it (claim, send to the queue, give back to the bot). A thread no handoff ever touched
 * (`handling` empty) shows nothing here, so the screen is the one agents know.
 */
export function HandoffBar({
  detail,
  nowMs,
  canClaim,
  canSend,
  canReturn,
  onPlaced,
}: HandoffBarProps) {
  const t = useTranslations('team-inbox-conversations.handoff');
  const { toast } = useToast();
  const handling = detail.handling ?? null;
  const card = useHandoffCard(detail.id, handling !== null);
  const { claim, giveBack } = useHandoffActions(detail.id);
  const [open, setOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);

  if (handling === null) return null;

  const held = detail.assignment.user !== null;
  const c = card.data?.handoff ?? null;
  const age =
    handling === 'waiting' && detail.handlingSince ? waitAge(detail.handlingSince, nowMs) : null;

  const refused = (e: unknown, fallback: string) => {
    if (e instanceof ApiError && e.status === 409) return t('claim.taken');
    return e instanceof ApiError && e.message ? e.message : fallback;
  };
  const onClaim = () =>
    claim.mutate(detail.rowVersion, {
      onSuccess: (r) => {
        onPlaced(r.conversation);
        toast(r.ownerSet ? t('claim.doneOwner') : t('claim.done'));
      },
      onError: (e) => toast(refused(e, t('claim.failed')), 'danger'),
    });
  const onGiveBack = () =>
    giveBack.mutate(undefined, {
      onSuccess: (r) => {
        onPlaced(r.conversation);
        toast(t('giveBack.done'));
      },
      onError: (e) => toast(refused(e, t('giveBack.failed')), 'danger'),
    });

  const tone =
    handling === 'waiting'
      ? 'border-warning/40 bg-warning/10'
      : handling === 'with_bot'
        ? 'border-border bg-muted/50'
        : 'border-primary/30 bg-primary/5';

  return (
    <div
      data-testid="inbox-handoff-bar"
      data-handling={handling}
      className={cn('border-b px-4 py-2.5 text-sm', tone)}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="flex min-w-0 flex-1 basis-56 items-start gap-2">
          {handling === 'waiting' ? (
            <AlertIcon className="mt-0.5 shrink-0 text-warning" />
          ) : (
            <ChatIcon className="mt-0.5 shrink-0 text-muted-foreground" />
          )}
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-medium">
              {t(`state.${handling}`)}
              {age && (
                <Badge tone="warning" data-testid="inbox-handoff-age">
                  {t('age', age)}
                </Badge>
              )}
            </span>
            {c ? (
              <span className="block text-xs text-muted-foreground" data-testid="inbox-handoff-why">
                {reasonText(t, c)}
                {c.assignedTo.user?.name
                  ? ` · ${t('assignedTo', { name: c.assignedTo.user.name })}`
                  : c.destination.team
                    ? ` · ${t('inTeamQueue', { team: c.destination.team.name })}`
                    : ''}
              </span>
            ) : card.isPending && handling !== 'with_bot' ? (
              <Spinner />
            ) : null}
          </span>
        </span>
        <span className="flex flex-wrap items-center gap-1.5">
          {handling === 'waiting' && !held && canClaim && (
            <Button
              size="sm"
              data-testid="inbox-claim"
              disabled={claim.isPending}
              onClick={onClaim}
              className="gap-1.5"
            >
              {claim.isPending ? <Spinner /> : <UserPlusIcon width={14} height={14} />}
              {t('claim.button')}
            </Button>
          )}
          {handling === 'with_bot' && canSend && (
            <Button
              size="sm"
              variant="secondary"
              data-testid="inbox-send-to-queue"
              onClick={() => setSendOpen(true)}
            >
              {t('send.button')}
            </Button>
          )}
          {handling === 'with_person' && canSend && (
            <Button
              size="sm"
              variant="secondary"
              data-testid="inbox-send-to-queue"
              onClick={() => setSendOpen(true)}
            >
              {t('send.buttonAgain')}
            </Button>
          )}
          {(handling === 'waiting' || handling === 'with_person') && canReturn && (
            <Button
              size="sm"
              variant="secondary"
              data-testid="inbox-return-to-bot"
              disabled={giveBack.isPending}
              onClick={onGiveBack}
            >
              {giveBack.isPending ? <Spinner /> : t('giveBack.button')}
            </Button>
          )}
          {c && (
            <Button
              size="sm"
              variant="ghost"
              data-testid="inbox-handoff-details"
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
            >
              {open ? t('details.hide') : t('details.show')}
            </Button>
          )}
        </span>
      </div>
      {open && c && <HandoffDetails card={c} />}
      {card.isError && handling !== 'with_bot' && (
        <Alert tone="warning" className="mt-2">
          {t('cardFailed')}
        </Alert>
      )}
      {sendOpen && (
        <SendToQueueDialog
          conversationId={detail.id}
          onClose={() => setSendOpen(false)}
          onPlaced={onPlaced}
        />
      )}
    </div>
  );
}

/**
 * "Send to queue" in the thread header, for a thread no handoff has touched yet (once one has, the strip below the header carries the
 * same action). Only for people who may assign.
 */
export function SendToQueueButton({
  detail,
  onPlaced,
}: {
  detail: InboxConversationDetail;
  onPlaced: (row: ConversationSummary) => void;
}) {
  const t = useTranslations('team-inbox-conversations.handoff');
  const [open, setOpen] = useState(false);
  if ((detail.handling ?? null) !== null) return null;
  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        data-testid="inbox-send-to-queue"
        className="hidden sm:inline-flex"
        onClick={() => setOpen(true)}
      >
        {t('send.button')}
      </Button>
      {open && (
        <SendToQueueDialog
          conversationId={detail.id}
          onClose={() => setOpen(false)}
          onPlaced={onPlaced}
        />
      )}
    </>
  );
}

type T = ReturnType<typeof useTranslations>;

/** "Customer asked for a person: wants a refund" - the picklist reason, then the free text next to it. */
function reasonText(t: T, c: HandoffCard): string {
  const label = KNOWN_REASONS.includes(c.reason) ? t(`reason.${c.reason as HandoffReason}`) : c.reason;
  return c.reasonText ? `${label}: ${c.reasonText}` : label;
}

/** The pinned card: why the bot handed over, what it learned, and the steps that led to this person or queue. */
function HandoffDetails({ card }: { card: HandoffCard }) {
  const t = useTranslations('team-inbox-conversations.handoff');
  const answers = Object.entries(card.answers);
  return (
    <div
      data-testid="inbox-handoff-card"
      className="mt-2 space-y-3 rounded-md border border-border bg-background p-3 text-xs"
    >
      <dl className="grid gap-x-4 gap-y-1.5 sm:grid-cols-[auto_1fr]">
        <dt className="text-muted-foreground">{t('card.source')}</dt>
        <dd>{t(`source.${card.source}`)}</dd>
        <dt className="text-muted-foreground">{t('card.reason')}</dt>
        <dd>{reasonText(t, card)}</dd>
        {card.priority && card.priority !== 'normal' && (
          <>
            <dt className="text-muted-foreground">{t('card.priority')}</dt>
            <dd>{t(`priority.${card.priority}`)}</dd>
          </>
        )}
        {card.summary && (
          <>
            <dt className="text-muted-foreground">{t('card.summary')}</dt>
            <dd className="whitespace-pre-wrap">{card.summary}</dd>
          </>
        )}
      </dl>
      {answers.length > 0 && (
        <div>
          <p className="mb-1 font-medium">{t('card.answers')}</p>
          <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[auto_1fr]">
            {answers.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="font-mono text-muted-foreground">{k}</dt>
                <dd className="break-words">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      {card.trace.length > 0 && (
        <div>
          <p className="mb-1 font-medium">{t('card.trace')}</p>
          <ol className="space-y-0.5">
            {card.trace.map((line, i) => (
              <li key={i} className="flex flex-wrap gap-x-1.5">
                <span
                  className={cn(
                    'font-medium',
                    line.result === 'chosen'
                      ? 'text-success'
                      : line.result === 'skipped'
                        ? 'text-warning'
                        : 'text-muted-foreground',
                  )}
                >
                  {t(`trace.${line.result}`)}
                </span>
                <span>{humanize(line.step)}</span>
                {line.why && <span className="text-muted-foreground">({humanize(line.why)})</span>}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

/** `rules_not_in_plan` -> `rules not in plan`: the trace's own words, kept readable (the steps are a technical aid). */
const humanize = (s: string) => s.replace(/_/g, ' ');
