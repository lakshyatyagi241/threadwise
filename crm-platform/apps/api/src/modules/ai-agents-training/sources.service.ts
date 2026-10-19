import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import {
  AIAG_FILE_EXTENSIONS,
  AIAG_SOURCE_LIMITS,
  ERROR_CODES,
  type AddAiagSourceInput,
  type AiagSource,
  type ListAiagSourcesResponse,
  type UploadAiagSourceFields,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import {
  TRAINING_FILE_STORE,
  type TrainingFileStore,
} from '../../infra/providers/ai-agents-training/training-file-store.port';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { KbIndexService } from '../knowledge-base';
import { AssistantsRepository } from './assistants.repository';
import { extractFileText } from './file-extract';
import { SOURCE_REQUESTED } from './source-events';
import { SourcesRepository, type SourceFull } from './sources.repository';
import { toSource } from './training.mapper';
import { clampContent, extensionOf, tokensEstimate } from './training-rules';

const MODULE_KEY = 'ai_training_sources';

/** The shape multer hands over (memory storage). */
export interface UploadedFile {
  originalname: string;
  buffer: Buffer;
  size: number;
}

/**
 * The knowledge entries of one assistant (its own knowledge base): add (URL, text, Q&A), upload a file, list, delete (TW-AIAG-005..010).
 *
 * Text and Q&A are ready at once. A file is read while the request waits (every type but a scanned PDF is quick), and its
 * stored copy is kept only so deleting the entry can delete it. A URL is read by the worker: the entry starts `processing` and the
 * outbox event `ai_training_source.requested` hands it to the consumer, so a slow or dead page never holds a request open.
 */
@Injectable()
export class SourcesService {
  private readonly logger = new Logger(SourcesService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly assistants: AssistantsRepository,
    private readonly repo: SourcesRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly kb: KbIndexService,
    @Inject(TRAINING_FILE_STORE) private readonly files: TrainingFileStore,
  ) {}

  async list(assistantUuid: string): Promise<ListAiagSourcesResponse> {
    const orgId = RequestContextStore.orgId();
    const rows = await this.db.tx(async (tx) => {
      const a = await this.assistants.findByUuid(tx, orgId, assistantUuid);
      if (!a) throw AppError.notFound('Assistant', assistantUuid);
      return this.repo.listFor(tx, orgId, a.id);
    });
    return { data: rows.map(toSource) };
  }

  async add(assistantUuid: string, input: AddAiagSourceInput): Promise<AiagSource> {
    const ctx = RequestContextStore.require();
    const row = await this.db.tx(async (tx) => {
      const a = await this.assistants.findByUuid(tx, ctx.orgId, assistantUuid);
      if (!a) throw AppError.notFound('Assistant', assistantUuid);
      const common = {
        assistantId: a.id,
        userId: ctx.userId,
        kind: input.kind,
        label: input.label,
      };
      let id: number;
      if (input.kind === 'url') {
        id = await this.repo.insert(tx, ctx.orgId, {
          ...common,
          url: input.url,
          status: 'processing',
        });
        await this.outbox.emit(tx, {
          aggregateModule: MODULE_KEY,
          aggregateId: id,
          eventType: SOURCE_REQUESTED,
          payload: {},
        });
      } else if (input.kind === 'text') {
        id = await this.repo.insert(tx, ctx.orgId, {
          ...common,
          content: input.content,
          status: 'ready',
          tokensEstimate: tokensEstimate(input.content.length),
        });
      } else {
        id = await this.repo.insert(tx, ctx.orgId, {
          ...common,
          question: input.question,
          answer: input.answer,
          status: 'ready',
          tokensEstimate: tokensEstimate(input.question.length + input.answer.length),
        });
      }
      const created = (await this.repo.findById(tx, ctx.orgId, id))!;
      await this.record(tx, created, 'insert', 'ai_training_source.created', a.uuid);
      // A ready entry is cut into searchable passages in the same commit; a URL entry is indexed once the worker has read the page.
      await this.kb.indexSource(tx, ctx.orgId, id);
      return created;
    });
    return toSource(row);
  }

  /** Reference's rules: an allowed type, up to 10 MB, text found, extracted text cut at 200 000 characters. */
  async upload(
    assistantUuid: string,
    file: UploadedFile | undefined,
    fields: UploadAiagSourceFields,
  ): Promise<AiagSource> {
    const ctx = RequestContextStore.require();
    if (!file || file.size === 0) {
      throw AppError.validation('Request payload failed validation', [
        { path: 'file', message: 'Pick a file (PDF, DOCX, TXT, Markdown, CSV or HTML).' },
      ]);
    }
    const ext = extensionOf(file.originalname);
    if (!(AIAG_FILE_EXTENSIONS as readonly string[]).includes(ext)) {
      throw new AppError(
        ERROR_CODES.AIAG_FILE_TYPE_UNSUPPORTED,
        ext === 'doc'
          ? 'Legacy .doc files are not supported: re-save as .docx (or export to .pdf) and upload again.'
          : 'Accepted file types: TXT, Markdown, CSV, HTML, PDF, DOCX. For anything else, paste the text into a Text entry.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (file.size > AIAG_SOURCE_LIMITS.fileBytes) throw tooLarge();

    // The assistant is checked before any bytes are read or stored.
    const assistant = await this.db.tx((tx) =>
      this.assistants.findByUuid(tx, ctx.orgId, assistantUuid),
    );
    if (!assistant) throw AppError.notFound('Assistant', assistantUuid);

    const content = clampContent(await extractFileText(file.buffer, ext));
    if (content === '') {
      throw new AppError(
        ERROR_CODES.AIAG_FILE_NO_TEXT,
        'No readable text found. A scanned or image-only PDF has no extractable text: paste the text into a Text entry instead.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const key = await this.files.put(ctx.orgId, ext, file.buffer);
    try {
      const row = await this.db.tx(async (tx) => {
        // Checked again inside the write: the assistant may have been deleted while the file was being read.
        const a = await this.assistants.findByUuid(tx, ctx.orgId, assistantUuid);
        if (!a) throw AppError.notFound('Assistant', assistantUuid);
        const id = await this.repo.insert(tx, ctx.orgId, {
          assistantId: a.id,
          userId: ctx.userId,
          kind: 'file',
          label: fields.label,
          filePath: key,
          content,
          status: 'ready',
          tokensEstimate: tokensEstimate(content.length),
        });
        const created = (await this.repo.findById(tx, ctx.orgId, id))!;
        await this.record(tx, created, 'insert', 'ai_training_source.created', a.uuid);
        await this.kb.indexSource(tx, ctx.orgId, id);
        return created;
      });
      return toSource(row);
    } catch (err) {
      await this.files.remove(ctx.orgId, key).catch(() => undefined);
      throw err;
    }
  }

  async remove(uuid: string): Promise<void> {
    const orgId = RequestContextStore.orgId();
    const key = await this.db.tx(async (tx) => {
      const current = await this.repo.findByUuid(tx, orgId, uuid);
      if (!current) throw AppError.notFound('Knowledge entry', uuid);
      await this.repo.delete(tx, orgId, current.id);
      await this.record(tx, current, 'delete', 'ai_training_source.deleted', current.assistantUuid);
      return current.filePath;
    });
    if (key) {
      await this.files.remove(orgId, key).catch(() => {
        this.logger.warn(
          { orgId },
          'a knowledge file could not be removed after its entry was deleted',
        );
      });
    }
  }

  private async record(
    tx: Tx,
    row: SourceFull,
    action: 'insert' | 'delete',
    eventType: string,
    assistantUuid: string | null,
  ): Promise<void> {
    await this.audit.record(tx, {
      module: MODULE_KEY,
      recordId: row.id,
      action,
      delta: { kind: { old: null, new: row.kind } },
    });
    await this.outbox.emit(tx, {
      aggregateModule: MODULE_KEY,
      aggregateId: row.id,
      eventType,
      payload: { uuid: row.uuid, kind: row.kind, assistantId: assistantUuid },
    });
  }
}

export const tooLarge = (): AppError =>
  new AppError(
    ERROR_CODES.AIAG_FILE_TOO_LARGE,
    `The file may not be greater than ${AIAG_SOURCE_LIMITS.fileBytes / (1024 * 1024)} MB.`,
    HttpStatus.PAYLOAD_TOO_LARGE,
  );
