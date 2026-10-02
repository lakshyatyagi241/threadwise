import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import {
  DEFAULT_GRAPH_BASE_URL,
  DEFAULT_TWILIO_API_BASE_URL,
  ERROR_CODES,
  OTP_SENDER_KINDS,
  parseOtpSenderRef,
  type OtpSenderCreate,
  type OtpSenderKind,
  type OtpSenderPatch,
  type OtpSenderView,
} from '@crm/contracts';
import { AppError } from '../../../common/errors/app-error';
import type { Env } from '../../../config/env.schema';
import type { ResolvedOtpSender } from '../../../infra/providers/auth-registration-security/otp-sender.port';
import { PlatformSettingsService } from './platform-settings.service';

/** Non-secret fields of a sender, as stored in the `otp.senders` platform setting. */
export interface StoredOtpSender {
  id: string;
  kind: OtpSenderKind;
  label: string;
  phoneNumberId?: string;
  wabaId?: string;
  graphBaseUrl?: string;
  accountSid?: string;
  fromNumber?: string;
  apiBaseUrl?: string;
  bridgeUrl?: string;
  senderNumber?: string;
}

/** Whether a reference can deliver right now. */
export type OtpSenderState = 'ok' | 'missing' | 'incomplete' | 'dev_in_production';

const DOC_KEY = 'otp.senders';
const MAX_SENDERS = 20;

/** Fields each kind owns (everything else is refused on update). */
const KIND_FIELDS: Record<OtpSenderKind, ReadonlyArray<keyof OtpSenderPatch>> = {
  waba: ['label', 'phoneNumberId', 'wabaId', 'graphBaseUrl', 'secret', 'clearSecret'],
  twilio: ['label', 'accountSid', 'fromNumber', 'apiBaseUrl', 'secret', 'clearSecret'],
  device: ['label', 'bridgeUrl', 'senderNumber', 'secret', 'clearSecret'],
  dev: ['label'],
};

const BLOCKED_HOSTS = /^(169\.254\.\d+\.\d+|metadata\.google\.internal|\[?fd00:ec2::254\]?)$/i;

export const otpSenderSecretKey = (id: string): string => `otp.sender.${id}.secret`;

/**
 * The OTP sender registry: the connections that can deliver the sign-up code.
 *
 * It lives in the auth zone because the channel domains (WABA, WADEV, Twilio)
 * and their connection tables do not exist yet. `registration.otp.sender`
 * stores `<kind>:<id>` and resolves here; when those domains land they replace
 * this behind the same reference.
 *
 * Non-secret fields are one platform setting (`otp.senders`); each secret (Meta
 * access token, Twilio auth token, bridge token) is its own encrypted
 * write-only platform secret. Responses carry `hasSecret`, never a value.
 * `resolve` is the only path to a plaintext secret, for the adapters.
 */
@Injectable()
export class OtpSenderRegistryService {
  /** The `dev` sender (log the code) is refused in production. */
  readonly devAllowed: boolean;

  constructor(
    private readonly settings: PlatformSettingsService,
    config: ConfigService<Env, true>,
  ) {
    this.devAllowed = config.get('NODE_ENV', { infer: true }) !== 'production';
  }

  // --- reads --------------------------------------------------------------------------------

  private async load(): Promise<StoredOtpSender[]> {
    const doc = await this.settings.get<{ senders?: unknown }>(DOC_KEY);
    const list = Array.isArray(doc?.senders) ? (doc.senders as StoredOtpSender[]) : [];
    return list.filter(
      (s) =>
        s &&
        typeof s.id === 'string' &&
        (OTP_SENDER_KINDS as readonly string[]).includes(s.kind) &&
        typeof s.label === 'string',
    );
  }

  private async save(list: StoredOtpSender[], by: number | null): Promise<void> {
    await this.settings.set(DOC_KEY, { senders: list }, by);
  }

  /**
   * The view with `connected` filled in: the sender can deliver right now. WaDesk's picker lists only
   * connected devices and provider configs; the registry keeps the rest (an unfinished sender) so the
   * Manage list can finish them, and the picker filters on this flag.
   */
  private async view(s: StoredOtpSender): Promise<OtpSenderView> {
    const core = await this.viewCore(s);
    return { ...core, connected: core.kind === 'dev' ? this.devAllowed : isComplete(core) };
  }

  private async viewCore(s: StoredOtpSender): Promise<OtpSenderView> {
    const base = { id: s.id, label: s.label };
    switch (s.kind) {
      case 'waba':
        return {
          ...base,
          kind: 'waba',
          phoneNumberId: s.phoneNumberId ?? '',
          wabaId: s.wabaId ?? '',
          graphBaseUrl: s.graphBaseUrl ?? DEFAULT_GRAPH_BASE_URL,
          hasSecret: await this.settings.hasSecret(otpSenderSecretKey(s.id)),
        };
      case 'twilio':
        return {
          ...base,
          kind: 'twilio',
          accountSid: s.accountSid ?? '',
          fromNumber: s.fromNumber ?? '',
          apiBaseUrl: s.apiBaseUrl ?? DEFAULT_TWILIO_API_BASE_URL,
          hasSecret: await this.settings.hasSecret(otpSenderSecretKey(s.id)),
        };
      case 'device':
        return {
          ...base,
          kind: 'device',
          bridgeUrl: s.bridgeUrl ?? '',
          senderNumber: s.senderNumber ?? '',
          hasSecret: await this.settings.hasSecret(otpSenderSecretKey(s.id)),
        };
      default:
        return { ...base, kind: 'dev', hasSecret: false };
    }
  }

  async list(): Promise<OtpSenderView[]> {
    return Promise.all((await this.load()).map((s) => this.view(s)));
  }

  async get(id: string): Promise<OtpSenderView | null> {
    const found = (await this.load()).find((s) => s.id === id);
    return found ? this.view(found) : null;
  }

  /** Can this reference deliver right now? Never decrypts anything. */
  async stateOf(ref: string | null): Promise<OtpSenderState> {
    const parsed = parseOtpSenderRef(ref);
    if (!parsed) return 'missing';
    const stored = (await this.load()).find((s) => s.id === parsed.id && s.kind === parsed.kind);
    if (!stored) return 'missing';
    if (stored.kind === 'dev') return this.devAllowed ? 'ok' : 'dev_in_production';
    const view = await this.viewCore(stored);
    return isComplete(view) ? 'ok' : 'incomplete';
  }

  /** The sender with its secret decrypted, or null when it cannot deliver. Adapters only. */
  async resolve(ref: string | null): Promise<ResolvedOtpSender | null> {
    if ((await this.stateOf(ref)) !== 'ok') return null;
    const parsed = parseOtpSenderRef(ref)!;
    const s = (await this.load()).find((x) => x.id === parsed.id && x.kind === parsed.kind)!;
    if (s.kind === 'dev') return { kind: 'dev', id: s.id };
    const secret = await this.settings.getSecret(otpSenderSecretKey(s.id));
    if (!secret) return null;
    switch (s.kind) {
      case 'waba':
        return {
          kind: 'waba',
          id: s.id,
          phoneNumberId: s.phoneNumberId!,
          wabaId: s.wabaId!,
          graphBaseUrl: s.graphBaseUrl ?? DEFAULT_GRAPH_BASE_URL,
          accessToken: secret,
        };
      case 'twilio':
        return {
          kind: 'twilio',
          id: s.id,
          accountSid: s.accountSid!,
          fromNumber: s.fromNumber!,
          apiBaseUrl: s.apiBaseUrl ?? DEFAULT_TWILIO_API_BASE_URL,
          authToken: secret,
        };
      default:
        return {
          kind: 'device',
          id: s.id,
          bridgeUrl: s.bridgeUrl!,
          senderNumber: s.senderNumber!,
          token: secret,
        };
    }
  }

  // --- writes -------------------------------------------------------------------------------

  async create(
    input: OtpSenderCreate,
    by: number,
  ): Promise<{ sender: OtpSenderView; changed: string[] }> {
    if (input.kind === 'dev' && !this.devAllowed) {
      throw AppError.validation('The log sender is not available in production.', [
        { path: 'kind', message: 'Not available in production.' },
      ]);
    }
    const list = await this.load();
    if (list.length >= MAX_SENDERS) {
      throw new AppError(
        ERROR_CODES.CONFLICT,
        `At most ${MAX_SENDERS} senders can be saved. Remove one first.`,
        HttpStatus.CONFLICT,
      );
    }

    const stored: StoredOtpSender = {
      id: this.freshId(list),
      kind: input.kind,
      label: input.label.trim(),
    };
    if (input.kind === 'waba') {
      stored.phoneNumberId = input.phoneNumberId;
      stored.wabaId = input.wabaId;
      stored.graphBaseUrl = this.cleanBaseUrl(
        input.graphBaseUrl,
        DEFAULT_GRAPH_BASE_URL,
        'graphBaseUrl',
        true,
      );
    } else if (input.kind === 'twilio') {
      stored.accountSid = input.accountSid;
      stored.fromNumber = cleanPhone('fromNumber', input.fromNumber, 'e164');
      stored.apiBaseUrl = this.cleanBaseUrl(
        input.apiBaseUrl,
        DEFAULT_TWILIO_API_BASE_URL,
        'apiBaseUrl',
        true,
      );
    } else if (input.kind === 'device') {
      stored.bridgeUrl = this.cleanBaseUrl(input.bridgeUrl, null, 'bridgeUrl', false);
      stored.senderNumber = cleanPhone('senderNumber', input.senderNumber, 'digits');
    }

    const changed = ['created'];
    if ('secret' in input) {
      const secret = input.secret.trim();
      if (!secret) {
        throw AppError.validation('A secret is required.', [
          { path: 'secret', message: 'Enter the secret.' },
        ]);
      }
      await this.settings.setSecret(otpSenderSecretKey(stored.id), secret, by);
      changed.push('secret');
    }
    await this.save([...list, stored], by);
    return { sender: await this.view(stored), changed };
  }

  async update(
    id: string,
    patch: OtpSenderPatch,
    by: number,
  ): Promise<{ sender: OtpSenderView; changed: string[] }> {
    const list = await this.load();
    const index = list.findIndex((s) => s.id === id);
    if (index < 0) throw AppError.notFound('OTP sender', id);
    const current = list[index]!;

    const allowed = KIND_FIELDS[current.kind];
    for (const key of Object.keys(patch) as Array<keyof OtpSenderPatch>) {
      if (patch[key] !== undefined && !allowed.includes(key)) {
        throw AppError.validation(`${key} is not a field of this kind of sender.`, [
          { path: key, message: 'Not a field of this kind of sender.' },
        ]);
      }
    }

    const next: StoredOtpSender = { ...current };
    const changed: string[] = [];
    const set = <K extends keyof StoredOtpSender>(
      key: K,
      value: StoredOtpSender[K] | undefined,
    ) => {
      if (value !== undefined && next[key] !== value) {
        next[key] = value;
        changed.push(key);
      }
    };
    set('label', patch.label?.trim());
    set('phoneNumberId', patch.phoneNumberId);
    set('wabaId', patch.wabaId);
    if (patch.graphBaseUrl !== undefined) {
      set(
        'graphBaseUrl',
        this.cleanBaseUrl(patch.graphBaseUrl, DEFAULT_GRAPH_BASE_URL, 'graphBaseUrl', true),
      );
    }
    set('accountSid', patch.accountSid);
    if (patch.fromNumber !== undefined) {
      set('fromNumber', cleanPhone('fromNumber', patch.fromNumber, 'e164'));
    }
    if (patch.apiBaseUrl !== undefined) {
      set(
        'apiBaseUrl',
        this.cleanBaseUrl(patch.apiBaseUrl, DEFAULT_TWILIO_API_BASE_URL, 'apiBaseUrl', true),
      );
    }
    if (patch.bridgeUrl !== undefined) {
      set('bridgeUrl', this.cleanBaseUrl(patch.bridgeUrl, null, 'bridgeUrl', false));
    }
    if (patch.senderNumber !== undefined) {
      set('senderNumber', cleanPhone('senderNumber', patch.senderNumber, 'digits'));
    }

    // A blank secret keeps the stored one, so saving the form cannot wipe a working credential.
    if (patch.clearSecret) {
      await this.settings.clearSecret(otpSenderSecretKey(id));
      changed.push('secret_cleared');
    } else if (patch.secret && patch.secret.trim()) {
      await this.settings.setSecret(otpSenderSecretKey(id), patch.secret.trim(), by);
      changed.push('secret');
    }

    if (changed.some((c) => c !== 'secret' && c !== 'secret_cleared')) {
      list[index] = next;
      await this.save(list, by);
    }
    return { sender: await this.view(next), changed };
  }

  /** Removes the sender and its secret. */
  async remove(id: string, by: number): Promise<StoredOtpSender> {
    const list = await this.load();
    const found = list.find((s) => s.id === id);
    if (!found) throw AppError.notFound('OTP sender', id);
    await this.save(
      list.filter((s) => s.id !== id),
      by,
    );
    await this.settings.clearSecret(otpSenderSecretKey(id));
    return found;
  }

  // --- helpers ------------------------------------------------------------------------------

  private freshId(list: StoredOtpSender[]): string {
    for (;;) {
      const id = randomBytes(4).toString('hex');
      if (!list.some((s) => s.id === id)) return id;
    }
  }

  /** http(s) only, no credentials in the address, no cloud metadata hosts, https in production. */
  private cleanBaseUrl(
    value: string | undefined,
    fallback: string | null,
    path: string,
    requireHttpsInProduction: boolean,
  ): string {
    const raw = (value ?? '').trim() || fallback;
    if (!raw) {
      throw AppError.validation('An address is required.', [
        { path, message: 'Enter an address.' },
      ]);
    }
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw AppError.validation('That is not a valid address.', [
        { path, message: 'That is not a valid address.' },
      ]);
    }
    const bad = (message: string) => AppError.validation(message, [{ path, message }]);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw bad('Use an http or https address.');
    }
    if (url.username || url.password) throw bad('Do not put credentials in the address.');
    if (BLOCKED_HOSTS.test(url.hostname)) throw bad('That address is not allowed.');
    if (requireHttpsInProduction && !this.devAllowed && url.protocol !== 'https:') {
      throw bad('Use an https address in production.');
    }
    return raw.replace(/\/+$/, '');
  }
}

function isComplete(v: OtpSenderView): boolean {
  switch (v.kind) {
    case 'waba':
      return Boolean(v.phoneNumberId && v.wabaId && v.graphBaseUrl && v.hasSecret);
    case 'twilio':
      return Boolean(v.accountSid && v.fromNumber && v.apiBaseUrl && v.hasSecret);
    case 'device':
      return Boolean(v.bridgeUrl && v.senderNumber && v.hasSecret);
    default:
      return true;
  }
}

/** "+1 415-523-8886" -> "+14155238886" (e164) or "14155238886" (digits), 7-15 digits. */
function cleanPhone(path: string, raw: string, form: 'e164' | 'digits'): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15 || digits.startsWith('0')) {
    throw AppError.validation('Enter the number with its country code.', [
      { path, message: 'Enter the number with its country code, 7 to 15 digits.' },
    ]);
  }
  return form === 'e164' ? `+${digits}` : digits;
}
