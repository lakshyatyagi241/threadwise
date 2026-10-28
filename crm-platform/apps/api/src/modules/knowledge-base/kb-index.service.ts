import { Injectable } from '@nestjs/common';
import type { Tx } from '@crm/db';
import { AppError } from '../../common/errors/app-error';
import { chunkText } from './kb-chunker';
import { KbChunkRepository } from './kb-chunk.repository';
import { MAX_CHUNKS_PER_SOURCE, sourceText } from './kb.rules';

/** The reason an entry that cuts into more passages than the index holds is refused. Shared by the save path and the URL worker. */
export function passageCapMessage(passages: number): string {
  return `This entry cuts into ${passages} passages, more than the ${MAX_CHUNKS_PER_SOURCE} one entry can hold. Split it into smaller entries and save each one.`;
}

/**
 * Keeps an entry's passages in step with the entry. Called inside the transaction that makes an entry `ready`, so the passages are
 * queued in the same commit and an entry is never ready without them. The embedding itself is the worker's job (a save never waits
 * for the vendor).
 */
@Injectable()
export class KbIndexService {
  constructor(private readonly chunks: KbChunkRepository) {}

  /** The refusal for text that cuts into more passages than the index holds, or null when it fits. */
  passageRefusal(text: string): string | null {
    const passages = chunkText(text).length;
    return passages > MAX_CHUNKS_PER_SOURCE ? passageCapMessage(passages) : null;
  }

  /**
   * Cuts the entry and queues its passages. Does nothing for an entry that is not ready or has no agent or text. An entry that cuts into
   * more than MAX_CHUNKS_PER_SOURCE passages is refused with a validation error, so the save rolls back and the operator is told.
   */
  async indexSource(tx: Tx, orgId: number, sourceId: number): Promise<void> {
    const s = await this.chunks.sourceToIndex(tx, orgId, sourceId);
    if (!s) return;
    const passages = chunkText(sourceText(s));
    if (passages.length > MAX_CHUNKS_PER_SOURCE) {
      throw AppError.validation('Request payload failed validation', [
        { path: 'content', message: passageCapMessage(passages.length) },
      ]);
    }
    await this.chunks.replaceForSource(tx, orgId, s.id, s.assistantId, passages);
  }
}
