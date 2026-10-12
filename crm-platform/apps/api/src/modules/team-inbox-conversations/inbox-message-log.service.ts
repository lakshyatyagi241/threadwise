import { Inject, Injectable } from '@nestjs/common';
import type {
  CreateMessageLogExportInput,
  MessageLogExport,
  MessageLogExportList,
  MessageLogResponse,
} from '@crm/contracts';
import { ERROR_CODES } from '@crm/contracts';
import { HttpStatus } from '@nestjs/common';
import type { Readable } from 'node:stream';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { MESSAGE_LOG_FACADE, type MessageLogFacade } from '../chat-conversations';
import { ConversationsRepository } from './conversations.repository';
import { InboxAccess } from './inbox-access.service';

/**
 * The inbox's side of the message delivery log: the same visibility rule as reading the thread decides who may see one message's log
 * (a message of a conversation the person cannot see is not theirs to learn about, and is answered like one that does not exist), and
 * the export of the whole log is a workspace-level capability (`inbox.logs.export`, checked by the route).
 */
@Injectable()
export class InboxMessageLogService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: ConversationsRepository,
    private readonly access: InboxAccess,
    @Inject(MESSAGE_LOG_FACADE) private readonly logs: MessageLogFacade,
  ) {}

  async messageLog(messageUuid: string): Promise<MessageLogResponse> {
    const ctx = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      const viewer = await this.access.viewer(tx, ctx);
      const record = await this.repo.recordByMessageUuid(tx, ctx.orgId, messageUuid);
      if (!record || !this.access.canSee(viewer, record)) {
        throw new AppError(
          ERROR_CODES.MESSAGE_NOT_FOUND,
          'Message not found',
          HttpStatus.NOT_FOUND,
        );
      }
    });
    return this.logs.messageLog(messageUuid);
  }

  requestExport(input: CreateMessageLogExportInput): Promise<MessageLogExport> {
    return this.logs.requestExport(input);
  }

  listExports(): Promise<MessageLogExportList> {
    return this.logs.listExports();
  }

  downloadExport(exportUuid: string): Promise<{ stream: Readable; fileName: string }> {
    return this.logs.downloadExport(exportUuid);
  }
}
