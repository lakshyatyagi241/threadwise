import { Injectable, Logger } from '@nestjs/common';
import makeWASocket, {
  BufferJSON,
  downloadMediaMessage,
  Browsers,
  fetchLatestBaileysVersion,
  fetchLatestWaWebVersion,
  initAuthCreds,
  makeCacheableSignalKeyStore,
  proto,
  type AnyMessageContent,
  type AuthenticationCreds,
  type SignalDataTypeMap,
  type SignalKeyStore,
  type WAVersion,
} from 'baileys';
import pino from 'pino';
import { normalizeMessage, type Normalized, type RawMessage } from './inbound-normalizer';
import type { GroupSnapshot } from './inbound.port';
import {
  bareDevice,
  includesSelf,
  inviteCodeOf,
  jidUser,
  looksLikeGroupId,
  toGroupJid,
  toSnapshot,
  type RawGroupMetadata,
  type SelfIds,
} from './group-mapping';
import {
  UnsupportedSendError,
  type MessageAction,
  type SendCommand,
  type SendContext,
  type SendOutcome,
} from './outbound.port';
import { SafeFetch } from './safe-fetch';
import type {
  GroupAction,
  GroupInviteInfo,
  GroupJoinRequestSnapshot,
  GroupParticipantStatus,
  GroupResult,
  SocketEvent,
  SocketTarget,
  WaSocket,
  WaSocketFactory,
} from './socket.port';
import { DeviceAuthStore } from './device-auth-store';
import { buildProxyAgent, probeProxy } from './proxy';

const VERSION_TTL_MS = 60 * 60 * 1000;
/** A customer's file is kept for the inbox up to this size; WhatsApp allows more, but Redis holds it until the inbox stores it. */
const INBOUND_MEDIA_MAX_BYTES = 25 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 60_000;

/**
 * A chat id for a number, or the id as given when it already is one. Digits only: Reference's last-12-digits cut misrouted some countries.
 * A bare GROUP id (digits with a dash, or longer than any phone number) is sent to `@g.us`, never turned into a person's address.
 */
const jidOf = (to: string): string =>
  to.includes('@')
    ? to
    : looksLikeGroupId(to)
      ? toGroupJid(to)
      : `${to.replace(/\D+/g, '')}@s.whatsapp.net`;
const groupJid = toGroupJid;

/** Where a command goes: a group addressed by its id, or a person. */
const addressOf = (command: SendCommand): string =>
  command.type === 'group_text'
    ? groupJid(command.groupJid)
    : command.toGroup
      ? groupJid(command.to)
      : jidOf(command.to);

const bareGroupIdOf = (jid: string): string => jid.replace(/@g\.us$/, '');

/** The invite code given to `get_invite_info` / `accept_invite` is not a link or code. Reads as a 400 from WhatsApp would. */
class InviteCodeError extends Error {
  readonly data = 400;
  constructor() {
    super('invalid invite code');
  }
}

function joinRequestOf(attrs: Record<string, string>): GroupJoinRequestSnapshot {
  const jid = attrs.jid ?? '';
  const phoneId = attrs.phone_number ?? (jid.endsWith('@s.whatsapp.net') ? jid : '');
  const at = Number(attrs.request_time);
  return {
    jid,
    phone: phoneId ? jidUser(phoneId).replace(/\D+/g, '') || null : null,
    lid: jid.endsWith('@lid') ? jidUser(jid) : null,
    name: null,
    requestedAt: Number.isFinite(at) && at > 0 ? new Date(at * 1000).toISOString() : null,
  };
}

function inviteInfoOf(g: RawGroupMetadata): GroupInviteInfo {
  return {
    groupId: bareGroupIdOf(g.id),
    subject: g.subject ?? null,
    description: g.desc ?? null,
    size: g.size ?? g.participants?.length ?? null,
    joinApproval: g.joinApprovalMode === true,
  };
}

/** The most pending group re-reads kept before a full read is cheaper than one read per group. */
const GROUP_REFRESH_MAX = 5;

/** Runs `fn` once after calls stop coming for `ms`. */
function debounce(ms: number, fn: () => void): () => void {
  let t: NodeJS.Timeout | null = null;
  return () => {
    if (t) clearTimeout(t);
    t = setTimeout(fn, ms);
    t.unref?.();
  };
}

/** What the runtime learns about a device's proxy each time it connects (TW-NODE-013 rule 2). */
export interface ProxyResultSink {
  report(
    orgId: number,
    deviceId: number,
    result: { ok: boolean; egressIp?: string; error?: string },
  ): Promise<void>;
}
export const PROXY_RESULT_SINK = Symbol('PROXY_RESULT_SINK');

/**
 * The unofficial WhatsApp engine (TW-NODE-011): Baileys behind the runtime's socket port. This file is the only place that
 * knows the library. Settings are Reference's, value for value: the long query timeout (120 s, so a slow send is not reported
 * failed and retried into a duplicate), the 15 s keep-alive, no history sync, no "online" on connect, and a `getMessage` that
 * answers nothing (a placeholder text made WhatsApp loop on decryption).
 *
 * Not verified against a live WhatsApp session in this repository: everything around it (the state machine, the persistence,
 * the status flow) is tested with a fake socket, and this adapter is checked by the compiler against the library's types.
 */
@Injectable()
export class BaileysSocketFactory implements WaSocketFactory {
  private readonly logger = new Logger(BaileysSocketFactory.name);
  private version: { at: number; value: WAVersion | undefined } | null = null;
  /** Set by the runtime so a proxy result reaches the device row. */
  proxyResults: ProxyResultSink | null = null;

  constructor(
    private readonly store: DeviceAuthStore,
    private readonly fetcher: SafeFetch,
  ) {}

  async create(target: SocketTarget): Promise<WaSocket> {
    const agent = target.proxy ? buildProxyAgent(target.proxy) : undefined;
    if (agent) {
      // Fail closed: a proxy that does not answer means no connection, never a connection from this server's own address.
      const probe = await probeProxy(agent, process.env.NODE_PROXY_ECHO_URL || undefined);
      await this.proxyResults?.report(target.orgId, target.deviceId, probe).catch(() => undefined);
      if (!probe.ok) throw new Error(`Proxy unreachable: ${probe.error ?? 'no answer'}`);
    }

    const { creds, keys, saveCreds } = await this.loadState(target.orgId, target.deviceId);
    const logger = pino({ level: process.env.BAILEYS_LOG_LEVEL || 'warn' });
    const version = await this.waVersion();
    const sock = makeWASocket({
      ...(version ? { version } : {}),
      auth: { creds, keys: makeCacheableSignalKeyStore(keys, logger) },
      logger,
      browser: Browsers.macOS('Desktop'),
      connectTimeoutMs: 60_000,
      defaultQueryTimeoutMs: 120_000,
      keepAliveIntervalMs: 15_000,
      retryRequestDelayMs: 3_000,
      maxMsgRetryCount: 5,
      qrTimeout: 60_000,
      emitOwnEvents: false,
      fireInitQueries: false,
      syncFullHistory: false,
      markOnlineOnConnect: false,
      shouldSyncHistoryMessage: () => false,
      transactionOpts: { maxCommitRetries: 10, delayBetweenTriesMs: 3_000 },
      getMessage: async () => undefined,
      generateHighQualityLinkPreview: false,
      ...(agent ? { agent, fetchAgent: agent } : {}),
    });

    let listener: ((e: SocketEvent) => void) | null = null;
    const backlog: SocketEvent[] = [];
    let ended = false;
    const emit = (e: SocketEvent) => {
      if (ended) return;
      if (listener) listener(e);
      else backlog.push(e);
    };
    let firstSignal: () => void = () => undefined;
    const signalled = new Promise<void>((r) => (firstSignal = r));

    sock.ev.on('connection.update', (u) => {
      if (u.connection === 'connecting') {
        firstSignal();
        emit({ type: 'connecting' });
      }
      if (u.qr) {
        firstSignal();
        emit({ type: 'qr', qr: u.qr });
      }
      if (u.connection === 'open') {
        emit({ type: 'open', linkedId: sock.user?.id });
        // Reference saved the credentials again two seconds after opening.
        setTimeout(() => void saveCreds().catch(() => undefined), 2_000);
      }
      if (u.connection === 'close') {
        const err = u.lastDisconnect?.error as
          { output?: { statusCode?: number }; message?: string } | undefined;
        emit({ type: 'close', code: err?.output?.statusCode, message: err?.message });
      }
    });
    sock.ev.on('messages.upsert', ({ messages, type }) => {
      // In arrival order: a file's download finishes before the next message is emitted.
      void (async () => {
        for (const m of messages) {
          try {
            const normalized = normalizeMessage(m as unknown as RawMessage, type, new Date());
            if (!normalized) continue;
            const media = await this.downloadMedia(sock, m, normalized);
            emit({ type: 'message', normalized, ...(media ? { media } : {}) });
          } catch (err) {
            // One bad message must not drop the rest of the batch (TW-NODE-016 rule 10).
            this.logger.warn({ err: String(err) }, '[NODE] a message could not be read');
          }
        }
      })();
    });
    sock.ev.on('messages.update', (updates) => {
      for (const u of updates) {
        const ack = u.update?.status;
        if (typeof ack === 'number' && u.key.id && u.key.fromMe) {
          emit({
            type: 'receipt',
            receipt: { providerMessageId: u.key.id, chatJid: u.key.remoteJid ?? '', ack },
          });
        }
      }
    });
    /** The connected number's own ids, read when needed (they are not known until the link is open). */
    const self = (): SelfIds => ({
      jid: sock.user?.id ? bareDevice(sock.user.id) : null,
      lid: sock.user?.lid ? bareDevice(sock.user.lid) : null,
    });
    const snap = (g: unknown): GroupSnapshot => toSnapshot(g as RawGroupMetadata, self());
    const syncGroups = debounce(5_000, () => {
      void sock
        .groupFetchAllParticipating()
        .then((all) =>
          emit({ type: 'groups', groups: Object.values(all).map(snap), complete: true }),
        )
        .catch(() => undefined);
    });
    // One change in one group re-reads that group only (a full read per change is a known source of "rate-overlimit").
    const pendingGroups = new Set<string>();
    const refreshGroups = debounce(5_000, () => {
      const ids = [...pendingGroups];
      pendingGroups.clear();
      if (ids.length > GROUP_REFRESH_MAX) {
        syncGroups();
        return;
      }
      void (async () => {
        for (const id of ids) {
          try {
            emit({ type: 'groups', groups: [snap(await sock.groupMetadata(id))], complete: false });
          } catch {
            // Removed from the group, or it is gone: the event already said so.
          }
        }
      })();
    });
    const queueGroup = (id: string) => {
      pendingGroups.add(id);
      refreshGroups();
    };
    sock.ev.on('groups.upsert', syncGroups);
    sock.ev.on('groups.update', (updates) => {
      for (const u of updates) {
        if (!u.id) continue;
        emit({
          type: 'group_event',
          event: {
            kind: 'update',
            groupId: bareGroupIdOf(u.id),
            author: u.author ?? null,
            patch: {
              ...(u.subject !== undefined ? { subject: u.subject } : {}),
              ...(u.desc !== undefined ? { description: u.desc } : {}),
              ...(u.announce !== undefined ? { announce: u.announce } : {}),
              ...(u.restrict !== undefined ? { restrict: u.restrict } : {}),
              ...(u.joinApprovalMode !== undefined ? { joinApproval: u.joinApprovalMode } : {}),
              ...(u.memberAddMode !== undefined
                ? { memberAddMode: u.memberAddMode ? 'all_member_add' : 'admin_add' }
                : {}),
            },
          },
        });
        queueGroup(u.id);
      }
    });
    sock.ev.on('group-participants.update', (u) => {
      const selfAffected = includesSelf(u.participants, self());
      emit({
        type: 'group_event',
        event: {
          kind: 'participants',
          groupId: bareGroupIdOf(u.id),
          author: u.author || null,
          action: u.action,
          participants: u.participants,
          selfAffected,
        },
      });
      // Removed from the group: it cannot be read any more.
      if (!(selfAffected && u.action === 'remove')) queueGroup(u.id);
    });
    sock.ev.on('group.join-request', (u) => {
      emit({
        type: 'group_event',
        event: {
          kind: 'join_request',
          groupId: bareGroupIdOf(u.id),
          participant: u.participant,
          author: u.author || null,
          action: u.action,
          method: u.method ?? null,
        },
      });
    });
    sock.ev.on('creds.update', () => {
      // Never debounced: a lost credentials write is a lost device.
      void saveCreds()
        .then(() => emit({ type: 'creds' }))
        .catch((err) =>
          this.logger.error({ err: String(err) }, '[NODE] saving credentials failed'),
        );
    });

    // One send at a time per socket: two concurrent sends to a new recipient race WhatsApp's key exchange (TW-NODE-029 rule 3).
    let chain: Promise<unknown> = Promise.resolve();
    const serialize = <T>(fn: () => Promise<T>): Promise<T> => {
      const run = chain.then(fn, fn);
      chain = run.catch(() => undefined);
      return run;
    };
    const send = (command: SendCommand, _ctx: SendContext): Promise<SendOutcome> =>
      serialize(async () => {
        const jid = addressOf(command);
        const quoted = command.quote
          ? ({
              key: {
                remoteJid: jid,
                id: command.quote.providerMessageId,
                fromMe: command.quote.fromMe,
                ...(command.quote.participant ? { participant: command.quote.participant } : {}),
              },
              message: { conversation: command.quote.text ?? '' },
            } as unknown as proto.IWebMessageInfo)
          : undefined;
        const sent = await sock.sendMessage(
          jid,
          await this.content(command),
          quoted ? { quoted } : undefined,
        );
        return { providerMessageId: sent?.key?.id ?? null };
      });
    const act = (a: MessageAction): Promise<void> =>
      serialize(async () => {
        const jid = jidOf(a.to);
        const key = { remoteJid: jid, id: a.messageId, fromMe: 'fromMe' in a ? a.fromMe : true };
        switch (a.type) {
          case 'react':
            await sock.sendMessage(jid, { react: { text: a.emoji, key } });
            return;
          case 'pin':
            await sock.sendMessage(jid, { pin: key, type: a.pin ? 1 : 2, time: 86_400 });
            return;
          case 'star':
            await sock.chatModify(
              { star: { messages: [{ id: a.messageId, fromMe: a.fromMe }], star: a.star } },
              jid,
            );
            return;
          case 'edit':
            await sock.sendMessage(jid, { text: a.text, edit: key });
            return;
          case 'delete':
            await sock.sendMessage(jid, { delete: key });
            return;
        }
      });
    const statuses = (
      r: Array<{ status: string; jid: string | undefined }>,
    ): GroupParticipantStatus[] => r.map((x) => ({ jid: x.jid ?? '', status: x.status }));
    const groups = async (a: GroupAction): Promise<GroupResult> => {
      switch (a.type) {
        case 'list':
          return { groups: Object.values(await sock.groupFetchAllParticipating()).map(snap) };
        case 'metadata':
          return { group: snap(await sock.groupMetadata(groupJid(a.groupJid))) };
        case 'create':
          return serialize(async () => {
            const wanted = a.participants.map((p) => jidOf(p));
            const meta = snap(await sock.groupCreate(a.subject, wanted));
            let descriptionSet = false;
            if (a.description) {
              try {
                await sock.groupUpdateDescription(meta.jid, a.description);
                descriptionSet = true;
                meta.description = a.description;
              } catch {
                // The group exists; the description is best effort.
              }
            }
            // WhatsApp's create reply lists who is in; anyone asked for and missing was refused (privacy, not on WhatsApp).
            const inside = new Set(
              meta.participants.flatMap((p) => [p.phone, p.lid, jidUser(p.jid)].filter(Boolean)),
            );
            return {
              group: meta,
              participants: wanted.map((jid) => ({
                jid,
                status: inside.has(jidUser(jid)) ? '200' : '403',
              })),
              descriptionSet,
            };
          });
        case 'participants':
          return serialize(async () => ({
            participants: statuses(
              await sock.groupParticipantsUpdate(
                groupJid(a.groupJid),
                a.participants.map((p) => jidOf(p)),
                a.change,
              ),
            ),
          }));
        case 'subject':
          return serialize(async () => {
            await sock.groupUpdateSubject(groupJid(a.groupJid), a.subject);
            return { ok: true as const };
          });
        case 'description':
          return serialize(async () => {
            await sock.groupUpdateDescription(groupJid(a.groupJid), a.description);
            return { ok: true as const };
          });
        case 'settings':
          return serialize(async () => {
            await sock.groupSettingUpdate(groupJid(a.groupJid), a.setting);
            return { ok: true as const };
          });
        case 'member_add_mode':
          return serialize(async () => {
            await sock.groupMemberAddMode(groupJid(a.groupJid), a.mode);
            return { ok: true as const };
          });
        case 'join_approval':
          return serialize(async () => {
            await sock.groupJoinApprovalMode(groupJid(a.groupJid), a.enabled ? 'on' : 'off');
            return { ok: true as const };
          });
        case 'join_requests': {
          const rows = await sock.groupRequestParticipantsList(groupJid(a.groupJid));
          return { requests: rows.map(joinRequestOf) };
        }
        case 'join_request_update':
          return serialize(async () => ({
            participants: statuses(
              await sock.groupRequestParticipantsUpdate(
                groupJid(a.groupJid),
                a.participants,
                a.action,
              ),
            ),
          }));
        case 'leave':
          return serialize(async () => {
            await sock.groupLeave(groupJid(a.groupJid));
            return { ok: true as const };
          });
        case 'invite':
          return { code: (await sock.groupInviteCode(groupJid(a.groupJid))) ?? '' };
        case 'revoke_invite':
          return serialize(async () => ({
            code: (await sock.groupRevokeInvite(groupJid(a.groupJid))) ?? '',
          }));
        case 'picture':
          return serialize(async () => {
            if (a.remove) {
              await sock.removeProfilePicture(groupJid(a.groupJid));
              return { ok: true as const };
            }
            if (!a.data) throw new UnsupportedSendError('The picture has no file.');
            await sock.updateProfilePicture(groupJid(a.groupJid), a.data);
            return { ok: true as const };
          });
        case 'get_invite_info': {
          const code = inviteCodeOf(a.code);
          if (!code) throw new InviteCodeError();
          return { invite: inviteInfoOf(await sock.groupGetInviteInfo(code)) };
        }
        case 'accept_invite':
          return serialize(async () => {
            const code = inviteCodeOf(a.code);
            if (!code) throw new InviteCodeError();
            const id = await sock.groupAcceptInvite(code);
            return { joined: { groupId: id ? jidUser(id) : null, requested: !id } };
          });
      }
    };

    return {
      send,
      act,
      groups,
      subscribe: (l) => {
        listener = l;
        for (const e of backlog.splice(0)) l(e);
      },
      requestPairingCode: async (phoneDigits) => {
        // The socket must be talking to WhatsApp before it can be asked for a code.
        await Promise.race([
          signalled,
          new Promise((_, rej) =>
            setTimeout(() => rej(new Error('The connection did not start in time.')), 30_000),
          ),
        ]);
        return sock.requestPairingCode(phoneDigits);
      },
      logout: () => sock.logout(),
      end: () => {
        ended = true;
        sock.ev.removeAllListeners('connection.update');
        sock.ev.removeAllListeners('creds.update');
        sock.end(undefined);
      },
    };
  }

  /** What to hand Baileys for one command (TW-NODE-022 to 024). Media is fetched through SafeFetch. */
  private async content(command: SendCommand): Promise<AnyMessageContent> {
    switch (command.type) {
      case 'text':
        return { text: command.footer ? `${command.body}\n\n${command.footer}` : command.body };
      case 'group_text':
        return {
          text: command.body,
          ...(command.mentions?.length ? { mentions: command.mentions.map((n) => jidOf(n)) } : {}),
        };
      case 'location': {
        const name = (command.name ?? '').trim().slice(0, 200);
        const address = (command.address ?? '').trim().slice(0, 200);
        return {
          location: {
            degreesLatitude: command.latitude,
            degreesLongitude: command.longitude,
            ...(name ? { name } : {}),
            ...(address ? { address } : {}),
          },
        };
      }
      case 'contact': {
        if (command.cards?.length) {
          return {
            contacts: {
              displayName:
                command.cards.length === 1
                  ? command.cards[0]!.name
                  : `${command.cards.length} contacts`,
              contacts: command.cards.map((c) => ({ displayName: c.name, vcard: c.vcard })),
            },
          };
        }
        const digits = command.phone.replace(/\D+/g, '');
        const vcard =
          command.vcard ??
          `BEGIN:VCARD\nVERSION:3.0\nFN:${command.name}\nTEL;type=CELL;type=VOICE;waid=${digits}:+${digits}\nEND:VCARD`;
        return { contacts: { displayName: command.name, contacts: [{ vcard }] } };
      }
      case 'media': {
        if (!command.data && !command.mediaUrl) {
          throw new UnsupportedSendError('The media to send has no file.');
        }
        const file = command.data
          ? { buffer: command.data, mimetype: command.mimeType ?? 'application/octet-stream' }
          : await this.fetcher.fetchMedia(command.mediaUrl, { timeoutMs: 180_000 });
        // The caller's type wins unless it is blank or the generic one; then what the host said; then the extension (TW-NODE-023 rule 3).
        const mimetype =
          command.mimeType && command.mimeType !== 'application/octet-stream'
            ? command.mimeType
            : file.mimetype;
        const caption = command.caption || undefined;
        if (mimetype.startsWith('image/')) return { image: file.buffer, mimetype, caption };
        if (mimetype.startsWith('video/')) return { video: file.buffer, mimetype, caption };
        if (mimetype.startsWith('audio/')) {
          return { audio: file.buffer, mimetype, ptt: command.voiceNote === true };
        }
        const fileName =
          command.fileName ||
          (command.mediaUrl ? new URL(command.mediaUrl).pathname.split('/').pop() : '') ||
          'file';
        return { document: file.buffer, mimetype, fileName, caption };
      }
      default:
        throw new UnsupportedSendError(
          'This kind of message cannot be sent on the unofficial engine.',
        );
    }
  }

  /**
   * A customer's (or a group member's) file, kept for the inbox (TW-NODE-016 rule 6). Never an echo of our own message. Skipped past the size cap, and a failed or slow download delivers the message without the file instead of losing it.
   */
  private async downloadMedia(
    sock: ReturnType<typeof makeWASocket>,
    m: unknown,
    n: Normalized,
  ): Promise<Buffer | null> {
    // A customer's file, or a member's file in a group (never our own message echoed back).
    if (n.kind === 'echo' || (n.kind === 'group' && n.message.fromMe) || !n.message.media)
      return null;
    const size = n.message.media.sizeBytes;
    if (size !== null && size > INBOUND_MEDIA_MAX_BYTES) return null;
    try {
      const bytes = await Promise.race([
        downloadMediaMessage(
          m as Parameters<typeof downloadMediaMessage>[0],
          'buffer',
          {},
          { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage },
        ),
        new Promise<never>((_, rej) =>
          setTimeout(() => rej(new Error('download timed out')), DOWNLOAD_TIMEOUT_MS),
        ),
      ]);
      return bytes.length <= INBOUND_MEDIA_MAX_BYTES ? bytes : null;
    } catch (err) {
      this.logger.warn({ err: String(err) }, '[NODE] a customer file could not be downloaded');
      return null;
    }
  }

  async deleteSession(orgId: number, deviceId: number): Promise<void> {
    await this.store.deleteAll(orgId, deviceId);
  }

  /** Reference's order: the WhatsApp Web version, then Baileys' own, cached for an hour; none lets the library choose. */
  private async waVersion(): Promise<WAVersion | undefined> {
    if (this.version && Date.now() - this.version.at < VERSION_TTL_MS) return this.version.value;
    let value: WAVersion | undefined;
    try {
      const v = await fetchLatestWaWebVersion({});
      value = v.version as WAVersion;
    } catch {
      try {
        value = (await fetchLatestBaileysVersion()).version as WAVersion;
      } catch {
        value = undefined;
      }
    }
    this.version = { at: Date.now(), value };
    return value;
  }

  /** Credentials and signal keys as encrypted rows (the multi-file auth state of Baileys, in Postgres). */
  private async loadState(orgId: number, deviceId: number) {
    const raw = await this.store.read(orgId, deviceId, 'creds');
    const creds: AuthenticationCreds = raw ? JSON.parse(raw, BufferJSON.reviver) : initAuthCreds();
    const keys: SignalKeyStore = {
      get: async (type, ids) => {
        const found = await this.store.readMany(
          orgId,
          deviceId,
          ids.map((id) => `${type}-${id}`),
        );
        const data: { [id: string]: SignalDataTypeMap[typeof type] } = {};
        for (const id of ids) {
          const value = found.get(`${type}-${id}`);
          if (!value) continue;
          let parsed = JSON.parse(value, BufferJSON.reviver);
          if (type === 'app-state-sync-key') {
            parsed = proto.Message.AppStateSyncKeyData.fromObject(parsed);
          }
          data[id] = parsed;
        }
        return data;
      },
      set: async (data) => {
        const entries: Array<[string, string | null]> = [];
        for (const category of Object.keys(data) as Array<keyof SignalDataTypeMap>) {
          for (const [id, value] of Object.entries(data[category] ?? {})) {
            entries.push([
              `${category}-${id}`,
              value ? JSON.stringify(value, BufferJSON.replacer) : null,
            ]);
          }
        }
        await this.store.write(orgId, deviceId, entries);
      },
    };
    const saveCreds = () =>
      this.store.write(orgId, deviceId, [['creds', JSON.stringify(creds, BufferJSON.replacer)]]);
    return { creds, keys, saveCreds };
  }
}
