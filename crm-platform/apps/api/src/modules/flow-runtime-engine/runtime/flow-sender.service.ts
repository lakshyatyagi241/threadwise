import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ERROR_CODES } from '@crm/contracts';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import { ChannelError } from '../../../infra/providers/chat-conversations';
import { ChatMediaStore, mimeForKey } from '../../../infra/providers/chat-conversations/media';
import { SafeFetch } from '../../../infra/providers/node-bridge-runtime/safe-fetch';
import {
  CONVERSATIONS_FACADE,
  ChannelDispatcher,
  ChannelRegistryService,
  type ConversationsFacade,
} from '../../chat-conversations';
import { WalletGateService } from '../../wallet-message-billing';
import { CapTally, DEFAULT_PACING } from '../caps';
import { ConsentGate } from '../../contact-consent';
import { flowMessagePurpose } from './flow-consent';
import { profileOf, renderForChannel, threadTextOf, type Rendered } from './channel-render';
import type { OutboundMessage, RunState, SendOutcome } from './types';

/** What a customer's file looks like inside a variable: the media store key, never a public link. */
export const CHAT_MEDIA_PREFIX = 'chatmedia:';

/** How long a channel that is down or capped is left alone before the run tries again. */
export const HALT_RETRY_MS = 5 * 60_000;

const HALT_CODES: ReadonlySet<string> = new Set([
  ERROR_CODES.CHANNEL_DISCONNECTED,
  ERROR_CODES.AUTH_SEND_HALTED,
  // An empty wallet halts the run too: it tries again by itself and carries on once the wallet is topped up.
  ERROR_CODES.WALLET_EMPTY,
]);

/**
 * Sends one flow message to the customer (TW-FLR-019, 020): renders it for the channel (degrading what the channel cannot show),
 * checks the unofficial engine's daily cap, passes it through the channel dispatcher (connected, capable, window open, emergency
 * halt and content screen, one send per client reference) and records it on the thread as `source = flow`.
 *
 * The client reference is `flow:<run>:<step>:<index>`, so a step that runs twice (a crash after the send) sends nothing the second
 * time: the dispatcher replays the stored answer and the thread's ledger ignores the repeat.
 *
 * Reference never failed a flow for a send problem and never retried one: a dead socket or a full cap left the run stuck until a timer
 * deleted it, and a Meta rejection was only a log line. Here a channel that is down or capped HALTS the run (it tries again by
 * itself), and any other refusal is returned to the node, which decides: a prompt the customer never got ends the run `failed`
 * with the reason, a plain message is skipped and noted in the run log.
 */
@Injectable()
export class FlowSender {
  private readonly logger = new Logger(FlowSender.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly channels: ChannelRegistryService,
    private readonly dispatcher: ChannelDispatcher,
    private readonly tally: CapTally,
    private readonly wallet: WalletGateService,
    private readonly fetcher: SafeFetch,
    private readonly media: ChatMediaStore,
    private readonly consentGate: ConsentGate,
    @Inject(CONVERSATIONS_FACADE) private readonly conversations: ConversationsFacade,
  ) {}

  async send(run: RunState, message: OutboundMessage, index: number): Promise<SendOutcome> {
    if (!run.channelUuid || !run.channelKind) {
      return {
        ok: false,
        code: 'FLR_NO_CHANNEL',
        error: 'The channel this run sends through is gone',
        halt: false,
      };
    }
    try {
      const profile = profileOf(run.channelKind);
      const rendered = renderForChannel(message, profile);

      // A template is the paid message of a flow (a plain reply inside the customer's window is free): the wallet must cover it.
      if (rendered.kind === 'template') {
        await this.wallet.assertCanSend({
          orgId: run.orgId,
          source: 'flow',
          to: run.peerKey,
          category: 'utility',
        });
      }

      const deviceId = run.channelKind === 'whatsapp_qr' ? await this.deviceOf(run) : null;
      if (deviceId !== null) {
        const used = await this.tally.sentToday(run.orgId, 'baileys', deviceId);
        if (used >= DEFAULT_PACING.baileysDailyCap) {
          return {
            ok: false,
            code: 'FLR_DAILY_CAP',
            error: `The daily limit of ${DEFAULT_PACING.baileysDailyCap} messages for this number is reached`,
            halt: true,
          };
        }
      }

      const { runtime, lastInboundAt } = await this.db.txAs({ orgId: run.orgId }, async (tx) => {
        const row = await this.channels.row(tx, run.orgId, run.channelUuid!);
        return {
          runtime: await this.channels.runtime(tx, run.orgId, row),
          lastInboundAt:
            (await this.conversations.findThread(run.channelUuid!, run.peerKey))?.lastInboundAt ??
            null,
        };
      });

      const clientReference = `flow:${run.uuid}:${run.stepSeq}:${index}`;
      // The widget draws reply buttons from the thread, not from the envelope: the channel is sent the question as text.
      const envelope = await this.envelopeOf(
        run,
        textForWebchat(run.channelKind, rendered),
        clientReference,
      );
      // A template takes its category; a plain message is marketing in a run the business started and a reply otherwise.
      const templatePurpose =
        rendered.kind === 'template'
          ? await this.consentGate.purposeOfTemplate(
              run.orgId,
              rendered.template.name,
              rendered.template.language,
            )
          : null;
      const sent = await this.dispatcher.send({
        channel: runtime,
        envelope,
        lastInboundAt,
        source: 'flow',
        consent: {
          purpose: flowMessagePurpose(run.source, templatePurpose),
          contactId: run.contactId,
        },
      });
      await this.conversations.recordOutbound({
        channelId: run.channelUuid,
        peerKey: run.peerKey,
        ...(run.contactUuid ? { contactId: run.contactUuid } : {}),
        source: 'flow',
        // The widget draws reply buttons itself, so its thread keeps the question and the buttons apart.
        ...withWebInput(
          run.channelKind,
          message,
          webCarousel(run.channelKind, message) ??
            webMedia(run.channelKind, rendered, envelope) ??
            webButtons(run.channelKind, rendered),
        ),
        providerMessageId: sent.providerMessageId,
        // A template node knows the name, language and values it sent (not the template's uuid, so the bubble has no header, footer or
        // buttons to draw: it shows the name and the text).
        ...(rendered.kind === 'template'
          ? {
              template: {
                name: rendered.template.name,
                language: rendered.template.language,
                variables: rendered.template.variables,
              },
            }
          : {}),
      });
      if (!sent.replayed) await this.dispatcher.scheduleReceipts(runtime, sent);
      // One tick per node that sends, not per message: a Message with five replies counts once (TW-FLR-020 rule 4).
      if (deviceId !== null && index === 0) await this.tally.bump(run.orgId, 'baileys', deviceId);
      return { ok: true };
    } catch (err) {
      return this.outcomeOf(err);
    }
  }

  private outcomeOf(err: unknown): SendOutcome {
    if (err instanceof AppError) {
      return { ok: false, code: err.code, error: err.message, halt: HALT_CODES.has(err.code) };
    }
    if (err instanceof ChannelError) {
      // A provider that may be back in a minute halts the run; one that refused the message for good does not.
      return { ok: false, code: err.code, error: err.message, halt: err.retryable };
    }
    this.logger.warn({ err }, '[FLR] a send failed unexpectedly');
    return {
      ok: false,
      code: 'FLR_SEND_ERROR',
      error: err instanceof Error ? err.message : 'The message could not be sent',
      halt: false,
    };
  }

  /** The device behind a QR channel: its external id is the device uuid. */
  private async deviceOf(run: RunState): Promise<number | null> {
    return this.db.txAs({ orgId: run.orgId }, async (tx) => {
      const res = await tx.execute(sql`
        SELECT d.id FROM channels c JOIN devices d ON d.org_id = c.org_id AND d.uuid::text = c.external_id
        WHERE c.org_id = ${run.orgId} AND c.id = ${run.channelId}`);
      const row = (res as unknown as { rows: Array<{ id: number | string }> }).rows[0];
      return row ? Number(row.id) : null;
    });
  }

  private envelopeOf(run: RunState, r: Rendered, clientReference: string): Promise<unknown> {
    return envelopeFor(this.fetcher, this.media, run.orgId, run.peerKey, r, clientReference);
  }
}

/**
 * The outbound envelope to `to`. A file is fetched through the guarded fetcher and stored once: the envelope carries a key, never a
 * link. Shared with the nodes that write to a number other than the customer (TW-FLR-038).
 */
export async function envelopeFor(
  fetcher: SafeFetch,
  media: ChatMediaStore,
  orgId: number,
  to: string,
  r: Rendered,
  clientReference: string,
): Promise<unknown> {
  const common = { to, clientReference };
  switch (r.kind) {
    case 'text':
      return { ...common, kind: 'text', body: r.body };
    case 'location':
      return { ...common, kind: 'location', location: r.location };
    case 'interactive':
      return { ...common, kind: 'interactive', interactive: r.interactive };
    case 'template':
      return { ...common, kind: 'template', template: r.template };
    case 'media': {
      // A file the customer sent earlier in this run (`chatmedia:<key>`) is already in the media store: send it as it is.
      if (r.url.startsWith(CHAT_MEDIA_PREFIX)) {
        const key = r.url.slice(CHAT_MEDIA_PREFIX.length);
        return {
          ...common,
          kind: 'media',
          media: {
            key,
            mediaKind: r.mediaKind,
            mime: mimeForKey(key) ?? 'application/octet-stream',
            ...(r.filename ? { name: r.filename } : {}),
            ...(r.caption ? { caption: r.caption } : {}),
          },
        };
      }
      const got = await fetcher.fetchMedia(r.url);
      const filename = r.filename || `file${got.extension}`;
      const stored = await media.store({
        orgId,
        filename,
        buffer: got.buffer,
      });
      return {
        ...common,
        kind: 'media',
        media: {
          key: stored.key,
          mediaKind: r.mediaKind === 'audio' ? 'audio' : r.mediaKind,
          mime: stored.mime,
          name: stored.name,
          sha256: stored.sha256,
          ...(r.caption ? { caption: r.caption } : {}),
        },
      };
    }
  }
}

/**
 * A carousel on a website chat thread is stored as its intro line with the cards in the meta the window reads (`widget_cards`); the
 * channel itself was sent the cards as text.
 */
function webCarousel(
  channelKind: string | null,
  message: OutboundMessage,
): { body: string; meta: Record<string, unknown> } | null {
  if (channelKind !== 'webchat' || message.kind !== 'carousel') return null;
  return {
    body: message.body,
    meta: { widget_cards: message.cards },
  };
}

/**
 * A question that says what it waits for (an Ask node's type, a file) keeps that on the website chat line, in the meta the window
 * reads (`widget_input`): the window then shows the right keyboard, date picker or attach button for it.
 */
function withWebInput(
  channelKind: string | null,
  message: OutboundMessage,
  stored: { body: string; meta?: Record<string, unknown> },
): { body: string; meta?: Record<string, unknown> } {
  if (channelKind !== 'webchat' || message.kind !== 'text') return stored;
  if (!message.input && !message.links?.length) return stored;
  return {
    ...stored,
    meta: {
      ...stored.meta,
      ...(message.input ? { widget_input: message.input } : {}),
      ...(message.links?.length ? { widget_links: message.links } : {}),
    },
  };
}

/**
 * A file the bot sent on a website chat thread is stored as a line with the file's object key, type and name in the meta the widget
 * reads (`widget_media`): the visitor's window draws it from there and reads the bytes through its own thread.
 */
function webMedia(
  channelKind: string | null,
  r: Rendered,
  envelope: unknown,
): { body: string; meta: Record<string, unknown> } | null {
  if (channelKind !== 'webchat' || r.kind !== 'media') return null;
  const m = (
    envelope as {
      media?: { key?: string; mediaKind?: string; mime?: string; name?: string; caption?: string };
    }
  ).media;
  if (!m?.key) return null;
  const kind = ['image', 'video', 'audio'].includes(String(m.mediaKind))
    ? String(m.mediaKind)
    : 'document';
  const name = m.name || r.filename || 'file';
  return {
    body: m.caption || '',
    meta: { widget_media: { key: m.key, kind, mime: m.mime ?? '', name } },
  };
}

/**
 * On a website chat thread a reply-button message is stored as the question alone, with the buttons in the meta the widget reads.
 * Every other channel (and every other kind of message) keeps the thread text with the options after it.
 */
function webButtons(
  channelKind: string | null,
  r: Rendered,
): { body: string; meta?: Record<string, unknown> } {
  if (channelKind === 'webchat' && r.kind === 'interactive' && r.interactive.type === 'buttons') {
    return {
      body: r.interactive.body,
      meta: {
        widget_buttons: r.interactive.buttons.map((b) => ({
          id: b.id,
          title: b.title,
          ...(b.icon ? { icon: b.icon } : {}),
        })),
      },
    };
  }
  return { body: threadTextOf(r) };
}

/** What goes to the webchat channel for a reply-button message: the question as plain text (the buttons ride in the thread's meta). */
function textForWebchat(channelKind: string | null, r: Rendered): Rendered {
  if (channelKind === 'webchat' && r.kind === 'interactive' && r.interactive.type === 'buttons') {
    return { kind: 'text', body: r.interactive.body };
  }
  return r;
}
