import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ERROR_CODES, senderWeight, splitAudience } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { AppError } from '../../common/errors/app-error';
import {
  UNOFFICIAL_ENGINE,
  UNOFFICIAL_WHATSAPP_GATE,
  type UnofficialWhatsappGate,
} from '../auth/unofficial-whatsapp.port';
import { SENDER_DIRECTORY, type SenderDirectory } from '../broadcasts';
import { CampaignsRepository, type RecipientSender } from './campaigns.repository';
import type { SenderBreakdownLine } from '@crm/contracts';

/** One number a split send goes out from: the engine and its id in the engine's own table, and its weight. */
export interface RunSender {
  key: string;
  provider: string;
  deviceId: number | null;
  label: string;
  weight: number;
}

/**
 * Sending one campaign from several numbers (TW-BCAST-006 / 014 carried into the wizard and the classic builder): resolving the picked
 * numbers, checking a template can go out from each, and cutting the recipients across them. One place, so the guided wizard, the classic
 * create and a recurring series split the same way.
 */
@Injectable()
export class SenderSharesService {
  constructor(
    @Inject(SENDER_DIRECTORY) private readonly senders: SenderDirectory,
    @Inject(UNOFFICIAL_WHATSAPP_GATE) private readonly unofficial: UnofficialWhatsappGate,
    private readonly repo: CampaignsRepository,
  ) {}

  private refuse(path: string, message: string, text: string): never {
    throw new AppError(
      ERROR_CODES.CAMP_TEMPLATE_NOT_ALLOWED,
      text,
      HttpStatus.UNPROCESSABLE_ENTITY,
      [{ path, message }],
    );
  }

  /**
   * Two or more picked numbers, in the order picked (the first is the primary). Any engine the sender directory resolves can share a
   * send except a mailbox (an email campaign has one mailbox); a personal (unofficial) number needs the platform switch on. A pick that is
   * not connected is refused (422) naming it, so nothing is sent from a number the person did not choose.
   */
  async resolvePicks(
    tx: Tx,
    orgId: number,
    picks: readonly string[],
    share: Readonly<Record<string, number>>,
    pathOf: (i: number) => string = (i) => `senderKeys.${i}`,
  ): Promise<RunSender[]> {
    const found = new Map(
      (await this.senders.resolve(tx, orgId, picks)).map((x) => [x.key, x] as const),
    );
    const unofficialOn = picks.some((k) => k.trim().startsWith(`${UNOFFICIAL_ENGINE}:`))
      ? await this.unofficial.isEnabledFor(orgId)
      : true;
    return picks.map((key, i) => {
      const x = found.get(key);
      if (!x || (x.engine === UNOFFICIAL_ENGINE && !unofficialOn)) {
        return this.refuse(
          pathOf(i),
          'sender_not_connected',
          'A WhatsApp number you picked is not connected.',
        );
      }
      if (x.engine === 'email') {
        return this.refuse(
          pathOf(i),
          'sender_is_mailbox',
          'A mailbox cannot share a send with phone numbers.',
        );
      }
      return {
        key,
        provider: x.engine,
        deviceId: x.id,
        label: x.label,
        weight: senderWeight(share[key]),
      };
    });
  }

  /**
   * A template tied to one WhatsApp connection (its Meta account) goes out only from Cloud API numbers of that same account; a
   * template tied to none goes from any number, and a personal (device) number is never held to an account. Refuses (422) with the first
   * Cloud API number that cannot send it. A send from one number is not checked here.
   */
  async assertTemplateOnEvery(
    tx: Tx,
    orgId: number,
    template: { name: string; providerConfigId: number | null },
    senders: readonly RunSender[],
  ): Promise<void> {
    if (senders.length < 2 || template.providerConfigId === null) return;
    const ids = [
      template.providerConfigId,
      ...senders.flatMap((x) => (x.provider === 'waba' && x.deviceId !== null ? [x.deviceId] : [])),
    ];
    const accounts = await this.wabaAccounts(tx, orgId, ids);
    const owner = accounts.get(template.providerConfigId) ?? null;
    senders.forEach((x, i) => {
      if (x.provider !== 'waba') return;
      if (x.deviceId === template.providerConfigId) return;
      const account = x.deviceId === null ? null : (accounts.get(x.deviceId) ?? null);
      if (owner !== null && account === owner) return;
      this.refuse(
        `senderKeys.${i}`,
        'template_not_on_sender',
        `The template "${template.name}" cannot be sent from ${x.label || 'one of the numbers you picked'}: it belongs to another WhatsApp Business account. Pick numbers of the same account, or another template.`,
      );
    });
  }

  /** The connection a template (by uuid) is tied to, for the classic path that holds only the template record. */
  async templateTie(
    tx: Tx,
    orgId: number,
    uuid: string,
  ): Promise<{ name: string; providerConfigId: number | null } | null> {
    const res = await tx.execute(sql`
      SELECT template_name, provider_config_id FROM wa_templates WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid`);
    const r = res.rows[0] as
      { template_name: string; provider_config_id: string | number | null } | undefined;
    return r
      ? {
          name: r.template_name,
          providerConfigId: r.provider_config_id === null ? null : Number(r.provider_config_id),
        }
      : null;
  }

  private async wabaAccounts(
    tx: Tx,
    orgId: number,
    configIds: readonly number[],
  ): Promise<Map<number, string>> {
    const out = new Map<number, string>();
    if (configIds.length === 0) return out;
    const res = await tx.execute(sql`
      SELECT id, meta_json ->> 'waba_id' AS waba_id FROM wa_provider_configs
      WHERE org_id = ${orgId} AND id IN (${sql.join(
        [...new Set(configIds)].map((id) => sql`${id}::bigint`),
        sql`, `,
      )})`);
    for (const r of res.rows as Array<{ id: string | number; waba_id: string | null }>) {
      if (r.waba_id) out.set(Number(r.id), r.waba_id);
    }
    return out;
  }

  /** Cuts `everyone` (contact order) into one slice per number by weight; each contact is in exactly one. */
  assign(everyone: readonly number[], senders: readonly RunSender[]): Map<number, RecipientSender> {
    const out = new Map<number, RecipientSender>();
    if (senders.length < 2) return out;
    const slices = splitAudience(
      everyone,
      senders.map((x) => x.weight),
    );
    slices.forEach((slice, n) => {
      const x = senders[n]!;
      for (const contactId of slice)
        out.set(contactId, { provider: x.provider, deviceId: x.deviceId! });
    });
    return out;
  }

  /**
   * The per-number figures of a send shared across several numbers, in the order the numbers first appear. Empty when the campaigns used one
   * number (nothing names a number, or only one does).
   */
  async breakdown(
    tx: Tx,
    orgId: number,
    campaignIds: readonly number[],
  ): Promise<SenderBreakdownLine[]> {
    const counts = await this.repo.senderCounts(tx, orgId, campaignIds);
    if (counts.length < 2) return [];
    const out: SenderBreakdownLine[] = [];
    for (const c of counts) {
      const who = await this.repo.senderLabel(tx, orgId, c.provider, c.deviceId);
      out.push({
        key: who.key,
        label: who.label,
        engine: c.provider,
        recipients: c.recipients,
        sent: c.sent,
        delivered: c.delivered,
        failed: c.failed,
      });
    }
    return out;
  }
}
