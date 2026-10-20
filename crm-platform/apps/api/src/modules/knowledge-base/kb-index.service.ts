import { Injectable } from '@nestjs/common';
import type { Tx } from '@crm/db';
import { chunkText } from './kb-chunker';
import { KbChunkRepository } from './kb-chunk.repository';
import { sourceText } from './kb.rules';

/**
 * Keeps an entry's passages in step with the entry. Called inside the transaction that makes an entry `ready`, so the passages are
 * queued in the same commit and an entry is never ready without them. The embedding itself is the worker's job (a save never waits
 * for the vendor).
 */
@Injectable()
export class KbIndexService {
  constructor(private readonly chunks: KbChunkRepository) {}

  /** Cuts the entry and queues its passages. Does nothing for an entry that is not ready or has no agent or text. */
  async indexSource(tx: Tx, orgId: number, sourceId: number): Promise<void> {
    const s = await this.chunks.sourceToIndex(tx, orgId, sourceId);
    if (!s) return;
    await this.chunks.replaceForSource(tx, orgId, s.id, s.assistantId, chunkText(sourceText(s)));
  }
}
