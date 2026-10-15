import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../infra/db/database.service';
import { SavedRepliesRepository } from './saved-replies.repository';

/**
 * What other domains may read of the saved replies library: the SHARED replies, most used first. Never a personal reply, whoever asks
 * (an AI agent speaks for the workspace, not for one person). A system read: it carries no user and checks no permission, so only
 * server code reaches it; it is not exposed on any route.
 */
@Injectable()
export class SharedSavedRepliesReader {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: SavedRepliesRepository,
  ) {}

  top(
    orgId: number,
    limit: number,
  ): Promise<Array<{ title: string; body: string; usedCount: number }>> {
    return this.db.txAs({ orgId, userId: null }, (tx) => this.repo.topShared(tx, orgId, limit));
  }
}
