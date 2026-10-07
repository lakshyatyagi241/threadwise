import { Injectable } from '@nestjs/common';
import type {
  V1Conversation,
  V1Device,
  V1ListConversationsQuery,
  V1ListMessagesQuery,
  V1Message,
  V1PageMeta,
} from '@crm/contracts';
import { RequestContextStore } from '../../../../common/context/request-context';
import { DatabaseService } from '../../../../infra/db/database.service';
import { countMeta, pageMeta } from '../../http/v1-envelope';
import { MediaIntakeService } from './media-intake.service';
import {
  toV1Connection,
  toV1Conversation,
  toV1Device,
  toV1Message,
  type MessageReadRow,
} from './messaging.mapper';
import { MessagingRepository } from './messaging.repository';
import { notFound } from './messaging-errors';

export interface MessagePage {
  data: V1Message[];
  meta: V1PageMeta & { count: number };
}

/** The reads of the messaging group: the repository's rows in Reference's public shapes. Read-only, so nothing here audits or emits. */
@Injectable()
export class MessagingReadService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: MessagingRepository,
    private readonly intake: MediaIntakeService,
  ) {}

  /** The public shape of one stored message. */
  messageOf(row: MessageReadRow): V1Message {
    return toV1Message(row, (r) =>
      this.intake.linkFor({ key: r.mediaKey!, name: r.mediaName, mime: r.mediaMime }),
    );
  }

  async listMessages(query: V1ListMessagesQuery): Promise<MessagePage> {
    const orgId = RequestContextStore.orgId();
    const { items, page } = await this.db.tx((tx) => this.repo.messages(tx, orgId, query));
    return {
      data: items.map((m) => this.messageOf(m)),
      meta: { ...pageMeta(page), count: items.length },
    };
  }

  async getMessage(uuid: string): Promise<V1Message> {
    const orgId = RequestContextStore.orgId();
    const row = await this.db.tx((tx) => this.repo.messageByUuid(tx, orgId, uuid));
    if (!row) throw notFound('Message');
    return this.messageOf(row);
  }

  /** Any thread of the workspace answers, whatever channel it runs on: the list is not a gate. Reading does not mark the thread read. */
  async conversationMessages(
    conversationUuid: string,
    query: V1ListMessagesQuery,
  ): Promise<MessagePage & { meta: { conversation_id: string } }> {
    const orgId = RequestContextStore.orgId();
    const done = await this.db.tx(async (tx) => {
      const id = await this.repo.conversationId(tx, orgId, conversationUuid);
      if (id === null) return null;
      return this.repo.messages(tx, orgId, { ...query, conversationId: id });
    });
    if (!done) throw notFound('Conversation');
    return {
      data: done.items.map((m) => this.messageOf(m)),
      meta: { ...pageMeta(done.page), count: done.items.length, conversation_id: conversationUuid },
    };
  }

  async listConversations(
    query: V1ListConversationsQuery,
  ): Promise<{ data: V1Conversation[]; meta: V1PageMeta }> {
    const orgId = RequestContextStore.orgId();
    const { items, page } = await this.db.tx((tx) => this.repo.conversations(tx, orgId, query));
    return { data: items.map(toV1Conversation), meta: pageMeta(page) };
  }

  /** Unofficial numbers first, then Cloud API and Twilio connections, as Reference concatenated them (not paged). */
  async listDevices(): Promise<{ data: V1Device[]; meta: { count: number } }> {
    const orgId = RequestContextStore.orgId();
    const { devices, connections } = await this.db.tx(async (tx) => ({
      devices: await this.repo.devices(tx, orgId),
      connections: await this.repo.connections(tx, orgId),
    }));
    const data = [...devices.map(toV1Device), ...connections.map(toV1Connection)];
    return { data, meta: countMeta(data.length) };
  }

  /**
   * One id space for both kinds: a device's or a connection's uuid. (Reference numbered the two kinds separately, and the list's `cfg_<n>`
   * ids were refused by the single read.)
   */
  async getDevice(uuid: string): Promise<V1Device> {
    const orgId = RequestContextStore.orgId();
    const found = await this.db.tx(async (tx) => {
      const device = await this.repo.deviceByUuid(tx, orgId, uuid);
      if (device) return toV1Device(device);
      const connection = await this.repo.connectionByUuid(tx, orgId, uuid);
      return connection ? toV1Connection(connection) : null;
    });
    if (!found) throw notFound('Device');
    return found;
  }
}
