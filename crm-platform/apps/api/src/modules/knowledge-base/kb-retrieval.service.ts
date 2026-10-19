import { Injectable, Logger } from '@nestjs/common';
import { KB_RETRIEVAL, kbFloorFor } from '@crm/contracts';
import { DatabaseService } from '../../infra/db/database.service';
import { KbChunkRepository } from './kb-chunk.repository';
import { KbConfigService } from './kb-config.service';
import { KbEmbeddingService, KbUnavailableError } from './kb-embedding.service';
import {
  UNINDEXED_BUDGET_CHARS,
  isSearchable,
  pickPassages,
  queryText,
  sourceText,
  toVectorLiteral,
} from './kb.rules';

export interface KbPassage {
  label: string;
  text: string;
}

export interface KbRetrieval {
  /**
   * True when `passages` are the best matches for the message (the agent must answer only from them); false when they are the agent's
   * whole knowledge base (the search is off, not built yet, or could not run).
   */
  grounded: boolean;
  passages: KbPassage[];
}

/**
 * What an AI agent reads for one customer message. One door for every reader (flow AI step, website chat): the agent's own entries,
 * searched by meaning, a few passages. Never throws: when the search cannot run (switched off, nothing indexed yet, no key, vendor
 * down) the agent reads its whole base exactly as it did before, so a search problem never costs a customer an answer.
 */
@Injectable()
export class KbRetrievalService {
  private readonly logger = new Logger(KbRetrievalService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly config: KbConfigService,
    private readonly embeddings: KbEmbeddingService,
    private readonly chunks: KbChunkRepository,
  ) {}

  async retrieve(orgId: number, assistantId: number, message: string): Promise<KbRetrieval> {
    try {
      const searched = await this.search(orgId, assistantId, message);
      if (searched) return searched;
    } catch (err) {
      if (!(err instanceof KbUnavailableError)) {
        this.logger.warn({ orgId, assistantId, err: String(err) }, 'knowledge search failed');
      }
    }
    return this.whole(orgId, assistantId);
  }

  /** The agent's entries whole, in the order they were added. */
  async whole(orgId: number, assistantId: number): Promise<KbRetrieval> {
    const rows = await this.db.txAs({ orgId, userId: null }, (tx) =>
      this.chunks.wholeBase(tx, orgId, assistantId),
    );
    const passages = rows
      .map((s) => ({ label: s.label, text: sourceText(s) }))
      .filter((p) => p.text !== '');
    return { grounded: false, passages };
  }

  /** Null when a search cannot be made (the caller then reads the whole base). */
  private async search(
    orgId: number,
    assistantId: number,
    message: string,
  ): Promise<KbRetrieval | null> {
    if (!isSearchable(message)) return null;
    const cfg = await this.config.get();
    if (!cfg.engineEnabled) return null;
    const model = cfg.embeddingModel;

    const ready = await this.db.txAs({ orgId, userId: null }, (tx) =>
      this.chunks.readyCount(tx, orgId, assistantId, model),
    );
    if (ready === 0) return null;

    const q = await this.embeddings.embedQuery(orgId, queryText(message));
    const { near, unindexed } = await this.db.txAs({ orgId, userId: null }, async (tx) => ({
      near: await this.chunks.nearest(
        tx,
        orgId,
        assistantId,
        toVectorLiteral(q.vector),
        q.model,
        KB_RETRIEVAL.fetch,
      ),
      unindexed: await this.chunks.unindexedPassages(tx, orgId, assistantId, q.model),
    }));

    const picked = pickPassages(near, kbFloorFor(q.model)).map((p) => ({
      label: p.label,
      text: p.text,
    }));
    // Text the vectors do not cover yet is read as written, up to a budget: a new entry works at once.
    let budget = UNINDEXED_BUDGET_CHARS;
    for (const u of unindexed) {
      if (budget <= 0) break;
      picked.push({ label: u.label, text: u.text.slice(0, budget) });
      budget -= u.text.length;
    }
    return { grounded: true, passages: picked };
  }
}
