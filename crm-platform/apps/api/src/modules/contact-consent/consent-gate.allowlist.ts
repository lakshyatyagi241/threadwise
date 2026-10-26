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
  // Asks a telephony vendor to ring a customer (click-to-call): only the click-to-call service may, after its gate check.
  'clickToCall',
  'APPOINTMENT_MESSENGER',
  'MailDriverRegistry',
  'EngineSenderRegistry',
  'OutboundRegistry',
  // The commerce (Shopify / WooCommerce) sender: a template send to a customer needs the clearance CommerceConsentService issues.
  'COMMERCE_SENDER',
] as const;

/** Text that marks a file as gate-aware. */
export const GATE_MARKERS = ['ConsentGate', 'DispatchConsent', 'consent: {', 'consent:'] as const;

export interface AllowlistEntry {
  path: string;
  /** Why it may touch a send primitive without asking the gate, or which backlog item closes the gap. */
  reason: string;
}

/**
 * What an entry's reason starts with while its file still sends without asking the gate. There is none today (the commerce senders were the
 * last, closed in BL-278); the guard test fails if one is added, so a gap is never left in silently.
 */
export const KNOWN_GAP_PREFIX = 'KNOWN GAP (BL-141 follow-up):';

export const CONSENT_GATE_ALLOWLIST: readonly AllowlistEntry[] = [
  // --- a message to the person who is signed in, never to a customer --------------------------------------------------------------
  {
    path: 'modules/appointments-booking/reminder-test-send.ts',
    reason:
      "The test email of a reminder step goes to the signed-in editor's OWN user address with sample values (BL-425); it is never sent to a contact, so there is no customer consent to ask. There is deliberately no WhatsApp test.",
  },
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
  {
    path: 'modules/channel-viber/viber-sender.service.ts',
    reason: 'Reply sender used by the Viber adapter, behind the dispatcher.',
  },
  {
    path: 'modules/channel-viber/channels.service.ts',
    reason: 'Channel setup (account check, webhook registration); sends nothing to a customer.',
  },
  {
    path: 'modules/channel-wechat/wechat-channel.adapter.ts',
    reason: 'Adapter behind the dispatcher (the gate runs in ChannelDispatcher.send).',
  },
  {
    path: 'modules/channel-wechat/wechat-token.service.ts',
    reason:
      'The Official Account access token and the request wrapper that refreshes it; used by the adapter (behind the dispatcher) and the broadcast sender. Sends nothing itself.',
  },
  {
    path: 'modules/channel-wechat/channels.service.ts',
    reason:
      'Account setup (fetches an access token to prove the credentials); sends nothing to a customer.',
  },
  {
    path: 'modules/channel-wechat/inbound.service.ts',
    reason:
      'Inbound handling; reads a follower profile for the thread title, sends nothing to a customer.',
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
    path: 'modules/calling-voice/calling-readiness.service.ts',
    reason:
      'Reads the number calling settings and, after a connect for an opted-in workspace, switches calling on at Meta; places no call and sends no message to a contact.',
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
    path: 'modules/channel-email/drivers/driver-providers.ts',
    reason: 'Provider wiring of the mail drivers; reached only through the email adapter.',
  },
  {
    path: 'modules/channel-email/drivers/google-mail.driver.ts',
    reason: 'Provider driver; reached only through the email adapter.',
  },
  {
    path: 'modules/channel-email/mail-connection-test.service.ts',
    reason:
      'Test credentials for an IMAP/SMTP mailbox (E-08): tries the two logins and reports the result; stores and sends nothing to a contact.',
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
    path: 'modules/shopify-woocommerce/cart.service.ts',
    reason:
      'Asks the commerce sender only whether a number is connected (canSend) before it schedules a follow-up; it sends nothing. The reminder itself goes out through EventMessageService, which clears the customer with CommerceConsentService.',
  },
];
