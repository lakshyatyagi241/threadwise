import { Injectable, Logger } from '@nestjs/common';
import { CALL_RECORDING_MAX_BYTES, ERROR_CODES, type RecordingResult } from '@crm/contracts';
import { HttpStatus } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { ChatMediaStore, type OpenedMedia } from '../../infra/providers/chat-conversations/media';
import { CallsRepository } from './calls.repository';
import { caller, notFound } from './calling-support';

/** A recording shorter than this is an empty file (the recorder never got audio): nothing is stored (TW-CALL-019 rule 1). */
export const MIN_RECORDING_BYTES = 256;

/**
 * The operator's recording of a call (TW-CALL-019). The operator's browser mixes both voices and uploads one file when the call ends;
 * the server never hears the audio. Reference put the file on the public disk under a guessable URL; here it goes into the tenant's
 * private media store under a generated key and is read only through `open`, by a person of the workspace.
 */
@Injectable()
export class CallRecordingsService {
  private readonly logger = new Logger(CallRecordingsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: CallsRepository,
    private readonly media: ChatMediaStore,
  ) {}

  async store(
    callUuid: string,
    file: { buffer: Buffer; originalname?: string },
  ): Promise<RecordingResult> {
    const { orgId } = caller();
    if (file.buffer.length < MIN_RECORDING_BYTES) {
      throw new AppError(
        ERROR_CODES.CALL_RECORDING_FAILED,
        'The recording is empty.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (file.buffer.length > CALL_RECORDING_MAX_BYTES) {
      throw new AppError(
        ERROR_CODES.CALL_RECORDING_FAILED,
        'The recording is larger than 50 MB.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const call = await this.db.tx((tx) => this.repo.byUuid(tx, orgId, callUuid));
    if (!call) throw notFound('CALL_NOT_FOUND', 'Call');

    let stored;
    try {
      stored = await this.media.store({
        orgId,
        filename: file.originalname || 'call.webm',
        buffer: file.buffer,
        allow: ['media'],
        displayName: `call-${call.uuid}.webm`,
      });
    } catch (err) {
      this.logger.warn({ orgId, err }, 'a call recording was refused by the media store');
      throw new AppError(
        ERROR_CODES.CALL_RECORDING_FAILED,
        err instanceof AppError ? err.message : 'The recording could not be stored.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const previous = call.recordingPath;
    await this.db.tx(async (tx) => {
      await this.repo.patchCall(tx, orgId, call.id, { recordingPath: stored.key });
      await this.repo.logEvent(tx, orgId, call.id, 'recording_stored', {
        size: stored.size,
        mime: stored.mime,
      });
    });
    // A second upload replaces the first (TW-CALL-019 rule 2): the old file must not stay behind unreachable.
    if (previous && previous !== stored.key)
      await this.media.remove(orgId, previous).catch(() => undefined);
    return { url: `/v2/calling/calls/${call.uuid}/recording` };
  }

  /** The recording's bytes for a person of the workspace; null when the call has none. */
  async open(
    callUuid: string,
    range?: { start: number; end?: number },
  ): Promise<{ media: OpenedMedia; mime: string; name: string } | null> {
    const { orgId } = caller();
    const call = await this.db.tx((tx) => this.repo.byUuid(tx, orgId, callUuid));
    if (!call) throw notFound('CALL_NOT_FOUND', 'Call');
    if (!call.recordingPath) return null;
    const media = await this.media.open(orgId, call.recordingPath, range);
    return media ? { media, mime: 'audio/webm', name: `call-${call.uuid}.webm` } : null;
  }
}
