/**
 * The send primitives and the files allowed to touch them without asking the ConsentGate themselves (BL-141). The guard test
 * (`test/unit/contact-consent/consent-gate-guard.spec.ts`) fails when a file under `src/` mentions one of `SEND_PRIMITIVES`, is not
 * gate-aware (it names `ConsentGate`, `DispatchConsent` or passes a `consent:` purpose to the dispatcher) and is not listed here. A
 * new send path therefore either asks the gate or is added here, with a reason, in review.
 *
 * Paths are relative to `apps/api/src`, with forward slashes. `*.module.ts` and `index.ts` only wire providers and are exempt.
 * An entry whose file no longer exists, or became gate-aware, also fails the test: the list cannot rot.
 */
export const SEND_PRIMITIVES = [
  'ChannelDispatcher',
  'SMS_GATEWAY',
  'TELEGRAM_API',
  'LINE_API',
  'VIBER_API',
  'WECHAT_API',
  'CALLING_GRAPH',
  'APPOINTMENT_MESSENGER',
  'MailDriverRegistry',
  'EngineSenderRegistry',
  'OutboundRegistry',
] as const;

/** Text that marks a file as gate-aware. */
export const GATE_MARKERS = ['ConsentGate', 'DispatchConsent', 'consent: {', 'consent:'] as const;

export interface AllowlistEntry {
  path: string;
  /** Why it may touch a send primitive without asking the gate, or which backlog item closes the gap. */
  reason: string;
}

const GAP = 'KNOWN GAP (BL-141 follow-up):';

export const CONSENT_GATE_ALLOWLIST: readonly AllowlistEntry[] = [
  // --- the dispatcher itself and the layers beneath it -------------------------------------------------------------------------
  {
    path: 'modules/channel-email/email-channel.adapter.ts',
    reason:
      'Adapter behind the dispatcher (ChannelDispatcher.send asks the gate first). Marketing mail adds the unsubscribe link and headers.',
  },
  {
    path: 'modules/channel-email/drivers/mail-driver.ts',
    reason: 'Mail driver contract; reached only through the email adapter.',
  },
  {
    path: 'modules/channel-email/drivers/mail-driver.registry.ts',
    reason: 'Registry of mail drivers; reached only through the email adapter.',
  },
  {
    path: 'modules/channel-email/drivers/microsoft-mail.driver.ts',
    reason: 'Provider driver; reached only through the email adapter.',
  },
  {
    path: 'modules/channel-email/drivers/imap-mail.driver.ts',
    reason: 'Provider driver; reached only through the email adapter.',
  },
  {
    path: 'modules/channel-telegram/telegram-channel.adapter.ts',
    reason: 'Adapter behind the dispatcher (the gate runs in ChannelDispatcher.send).',
  },
  {
    path: 'modules/channel-telegram/telegram-sender.service.ts',
    reason: 'Reply sender used by the Telegram adapter, behind the dispatcher.',
  },
  {
    path: 'modules/channel-telegram/inbound.service.ts',
    reason: 'Inbound handling; looks up the bot, sends nothing to a customer.',
  },
  {
    path: 'modules/channel-telegram/bots.service.ts',
    reason: 'Bot setup (webhook registration); sends nothing to a customer.',
  },
  {
    path: 'modules/channel-line/line-channel.adapter.ts',
    reason: 'Adapter behind the dispatcher (the gate runs in ChannelDispatcher.send).',
  },
  {
    path: 'modules/channel-line/line-sender.service.ts',
    reason: 'Reply sender used by the LINE adapter, behind the dispatcher.',
  },
  {
    path: 'modules/channel-line/inbound.service.ts',
    reason: 'Inbound handling; reads the sender profile and sends nothing to a customer.',
  },
  {
    path: 'modules/channel-line/channels.service.ts',
    reason: 'Channel setup (bot info, webhook registration); sends nothing to a customer.',
  },
  {
    path: 'modules/channel-line/line-token.service.ts',
    reason:
      'Issues the rotated channel access token (LINE token endpoint); sends nothing to a customer.',
  },
  // --- staff-side, setup and test sends -------------------------------------------------------------------------------------------
  {
    path: 'modules/channel-sms/sms-senders.service.ts',
    reason:
      'Sender setup and the credentials check; the broadcast text itself goes through SmsEngineSender (gate-aware).',
  },
  {
    path: 'modules/calling-voice/calling-numbers.service.ts',
    reason: 'Calling setup on the number (Meta settings); places no call.',
  },
  {
    path: 'modules/calling-voice/call-permission.service.ts',
    reason:
      'Meta call-permission request, only reached from CallActionsService.dial after its gate check (service purpose, voice modality).',
  },
  {
    path: 'modules/campaigns/wizard/wizard-test-send.service.ts',
    reason:
      'A test send of the campaign text to the staff member own number; never to an audience.',
  },
  {
    path: 'modules/campaigns/wizard/wizard-retry.service.ts',
    reason:
      'Re-queues failed campaign recipients; the run screens them through the gate again (CampaignDispatchService).',
  },
  {
    path: 'modules/campaigns/fixture/fixture-registrar.ts',
    reason: 'Registers the in-memory engine used by tests and demos.',
  },
  {
    path: 'modules/scheduled-queue-warmer/schedule-create.service.ts',
    reason:
      'Reads the outbound registry to validate the sender; the run is gate-aware (ScheduledRunService).',
  },
  // --- engines whose audience is gated before they are reached ---------------------------------------------------------------------
  {
    path: 'modules/node-bridge-runtime/outbound/baileys.transport.ts',
    reason:
      'Transport of the linked number; reached from broadcasts, campaigns and schedules, whose audiences are gated.',
  },
  {
    path: 'modules/node-bridge-runtime/outbound/catalog-bridge.adapter.ts',
    reason: 'Catalogue message bridge; one-to-one service messages triggered by a person.',
  },
  {
    path: 'modules/broadcasts/engine-senders.ts',
    reason:
      'Registry of broadcast engines; the audience is gated in BroadcastsService.resolveAudience.',
  },
  {
    path: 'modules/broadcasts/broadcast-dispatch.service.ts',
    reason: `${GAP} the audience is gated when the broadcast is created; a send-time re-check of the recipients is still to do.`,
  },
  {
    path: 'modules/channel-email/drivers/driver-providers.ts',
    reason: 'Provider wiring of the mail drivers; reached only through the email adapter.',
  },
  {
    path: 'modules/channel-email/drivers/google-mail.driver.ts',
    reason: 'Provider driver; reached only through the email adapter.',
  },
  {
    path: 'modules/channel-email/mail-push.service.ts',
    reason: 'Mailbox push-notification watch; reads mail, sends none.',
  },
  {
    path: 'modules/channel-email/mail-sync.service.ts',
    reason: 'Mailbox sync (inbound); sends none.',
  },
  {
    path: 'modules/channel-email/mail-sync.sweep.ts',
    reason: 'Mailbox sync schedule (inbound); sends none.',
  },
  {
    path: 'modules/channel-email/mail-tokens.service.ts',
    reason: 'Mailbox access tokens for the drivers; sends none.',
  },
  {
    path: 'modules/channel-email/mailboxes.service.ts',
    reason: 'Mailbox connect and disconnect; sends none.',
  },
  {
    path: 'modules/node-bridge-runtime/outbound/outbound-registry.service.ts',
    reason:
      'Registry of outbound transports; the callers (broadcasts, campaigns, schedules) are gated.',
  },
  {
    path: 'modules/node-bridge-runtime/outbound/twilio.transport.ts',
    reason:
      'Twilio transport; reached from broadcasts, campaigns and schedules, whose audiences are gated.',
  },
  {
    path: 'modules/shopify-woocommerce/_shims/engine-commerce-sender.ts',
    reason: `${GAP} commerce broadcasts (abandoned cart, order updates) send through the engine registry; they honour the contact flag only.`,
  },
  // --- open gaps ----------------------------------------------------------------------------------------------------------------
  {
    path: 'modules/channel-telegram/tg-broadcast-sender.service.ts',
    reason: `${GAP} Telegram broadcasts go to bot subscribers by chat id with no contact link; needs the chat to contact mapping first.`,
  },
];
