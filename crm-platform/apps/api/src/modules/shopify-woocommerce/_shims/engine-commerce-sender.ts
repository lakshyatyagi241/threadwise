import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../../../infra/db/database.service';
import { emitDeliveryReported, deliveryProviderOf } from '../../../kernel/outbox/delivery-report';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import { EngineSenderRegistry } from '../../broadcasts';
import { WalletGateService } from '../../wallet-message-billing';
import { OutboundRegistry, SenderResolver, type SenderRef } from '../../node-bridge-runtime';
import type { CommerceClearance } from '../commerce-consent.rules';
import { bodyParams, renderBody, type EventContext } from '../event-rules';
import type { CommerceSender, EcomTemplate } from './tokens';

const ENGINES = new Set(['baileys', 'waba', 'twilio']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A template as the text an unofficial or Twilio number sends: header, body and footer, each with its values filled in. */
export function templateText(template: EcomTemplate, ctx: EventContext): string {
  return [template.header, template.body, template.footer]
    .filter((x): x is string => !!x?.trim())
    .map((x) => renderBody(x, ctx))
    .join('\n\n');
}

/**
 * The commerce send, engine-aware like Reference's notifier. The number is the chosen "send from" one (`engine:uuid`, which must be
 * connected) or the workspace's default engine's. Cloud API numbers send the approved template; the other engines send it as text
 * through the shared outbound layer.
 *
 * Every message goes through the wallet like any other WhatsApp message: the gate is asked before it leaves (422 `WALLET_EMPTY` when the
 * workspace can neither cover it with its plan's free messages nor pay for it) and the provider's id is reported once it was accepted, so
 * the worker prices and charges it from `sent` and a later `failed` gives it back.
 *
 * Consent (BL-141 follow-up): a template send takes the `consent` clearance its caller got from `CommerceConsentService`, which asked
 * the ConsentGate for a marketing template and let a utility one through. The ConsentGate is not asked again per message here, so a
 * broadcast of thousands costs one question per slice, not one per customer.
 */
@Injectable()
export class EngineCommerceSender implements CommerceSender {
  private readonly logger = new Logger(EngineCommerceSender.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly resolver: SenderResolver,
    private readonly outbound: OutboundRegistry,
    private readonly engines: EngineSenderRegistry,
    private readonly wallet: WalletGateService,
    private readonly outbox: OutboxService,
  ) {}

  /** Refuses before the message leaves when the wallet cannot pay for it. */
  private async assertAffordable(
    orgId: number,
    sender: SenderRef,
    to: string,
    category: string | null,
  ): Promise<void> {
    if (deliveryProviderOf(sender.engine) === null) return;
    await this.wallet.assertCanSend({ orgId, source: 'api', to, category });
  }

  /** Reports the message the provider accepted. Never throws: the message is gone, and a billing fault must not turn it into a failed send. */
  private async report(
    orgId: number,
    sender: SenderRef,
    sent: { providerMessageId: string | null },
    m: { to: string; reference: string; category: string | null; templateName: string | null },
  ): Promise<void> {
    const provider = deliveryProviderOf(sender.engine);
    if (provider === null) return;
    try {
      await this.db.txAs({ orgId }, (tx) =>
        emitDeliveryReported(this.outbox, tx, {
          orgId,
          aggregateModule: 'store_messages',
          aggregateId: sender.id,
          report: {
            provider,
            // A provider that gave no id still sent the message: it is named by an id of its own (the caller's reference repeats across
            // messages, and a repeat would be taken for the same message and never charged).
            providerMessageId: sent.providerMessageId ?? `commerce:${randomUUID()}`,
            status: 'sent',
            recipient: m.to,
            category: m.category,
            source: 'api',
            templateName: m.templateName,
          },
        }),
      );
    } catch (err) {
      // The send stands; the miss is logged so the unbilled message can be found and settled by hand.
      this.logger.warn(
        { orgId, providerMessageId: sent.providerMessageId, err: String(err) },
        'store message could not be reported for billing',
      );
    }
  }

  /** The connected number a send goes out through, or null. `senderKey` names one; without it the default engine's is used. */
  private sender(orgId: number, senderKey: string | null | undefined): Promise<SenderRef | null> {
    return this.db.txAs({ orgId }, async (tx) => {
      if (senderKey) {
        const [engine, uuid] = senderKey.split(':');
        if (!engine || !uuid || !ENGINES.has(engine) || !UUID.test(uuid)) return null;
        const res =
          engine === 'baileys'
            ? await tx.execute(
                sql`SELECT id FROM devices WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid`,
              )
            : await tx.execute(
                sql`SELECT id FROM wa_provider_configs WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid AND provider = ${engine}`,
              );
        const row = res.rows[0] as { id: number | string } | undefined;
        return row
          ? this.resolver.resolve(tx, orgId, { provider: engine, deviceId: Number(row.id) })
          : null;
      }
      const def = await tx.execute(
        sql`SELECT default_engine FROM workspace_settings WHERE org_id = ${orgId} LIMIT 1`,
      );
      const engine = (def.rows[0] as { default_engine: string | null } | undefined)?.default_engine;
      return this.resolver.resolve(tx, orgId, {
        // A blank engine (and a stored `baileys`) lets the resolver pick: the unofficial engine while it is on, else the Cloud API.
        provider: engine && engine !== 'baileys' && ENGINES.has(engine) ? engine : null,
        deviceId: null,
      });
    });
  }

  private async need(orgId: number, senderKey?: string | null): Promise<SenderRef> {
    const sender = await this.sender(orgId, senderKey);
    if (!sender)
      throw new Error(
        senderKey
          ? 'The chosen WhatsApp number is not connected.'
          : 'No WhatsApp number is connected to send from.',
      );
    return sender;
  }

  async canSend(orgId: number): Promise<boolean> {
    return (await this.sender(orgId, null)) !== null;
  }

  async send(
    orgId: number,
    m: {
      to: string;
      template: EcomTemplate;
      ctx: EventContext;
      reference: string;
      senderKey?: string | null;
      /** The consent step of this message, already settled by the caller (`CommerceConsentService`); the sender only carries it. */
      consent: CommerceClearance;
    },
  ): Promise<{ providerMessageId: string | null }> {
    // A caller that skipped the consent step (a plain JS call, a cast) is stopped here rather than sending unchecked.
    if (!m.consent) throw new Error('A template send needs its consent clearance.');
    const sender = await this.need(orgId, m.senderKey);
    const billed = {
      to: m.to,
      reference: m.reference,
      category: m.template.category,
      templateName: m.template.name,
    };
    await this.assertAffordable(orgId, sender, m.to, m.template.category);
    if (sender.engine === 'waba') {
      const adapter = this.engines.get('waba');
      if (!adapter) throw new Error('The WhatsApp Cloud API sender is not available.');
      const params = bodyParams(m.template.body, m.ctx.positional);
      const opened = await adapter.open(orgId, sender);
      const out = await opened.send({
        to: m.to,
        templateName: m.template.name,
        language: m.template.language,
        clientReference: m.reference,
        components: params.length
          ? [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) }]
          : [],
      });
      await this.report(orgId, sender, out, billed);
      return out;
    }
    const out = await this.text(
      orgId,
      sender,
      m.to,
      templateText(m.template, m.ctx),
      m.reference,
      true,
    );
    await this.report(orgId, sender, out, billed);
    return out;
  }

  async sendText(
    orgId: number,
    m: { to: string; body: string; reference: string },
  ): Promise<{ providerMessageId: string | null }> {
    const sender = await this.need(orgId);
    await this.assertAffordable(orgId, sender, m.to, null);
    const out = await this.text(orgId, sender, m.to, m.body, m.reference, false);
    await this.report(orgId, sender, out, {
      to: m.to,
      reference: m.reference,
      category: null,
      templateName: null,
    });
    return out;
  }

  private async text(
    orgId: number,
    sender: SenderRef,
    to: string,
    body: string,
    reference: string,
    bulk: boolean,
  ): Promise<{ providerMessageId: string | null }> {
    const transport = this.outbound.get(sender.engine);
    if (!transport) throw new Error(`No sender is connected for engine ${sender.engine}.`);
    const open = await transport.open(orgId, sender);
    const out = await open.send(
      { type: 'text', to, body },
      { clientReference: reference, screen: { bulk, source: 'commerce' } },
    );
    return { providerMessageId: out.providerMessageId ?? null };
  }
}
