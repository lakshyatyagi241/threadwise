import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../../infra/db/database.service';

/** Write at most once per org per window per process. */
const TOUCH_WINDOW_MS = 10 * 60_000;
const MAX_TRACKED = 50_000;

/**
 * Resets the inactivity clock. Called from the authentication guards, so any
 * authenticated request counts as activity.
 *
 * Throttled twice: in memory (one write per org per 10 minutes per process)
 * and in SQL (the UPDATE is a no-op unless the stored value is stale), so a
 * busy tenant costs one tiny write per window instead of one per request.
 * Runs in the org's OWN tenant scope (RLS allows an org to update its own row),
 * so no privileged transaction is needed on the request path. Fire-and-forget: a failed touch must never fail the request.
 */
@Injectable()
export class ActivityService {
  private readonly logger = new Logger(ActivityService.name);
  private readonly lastTouch = new Map<number, number>();

  constructor(private readonly db: DatabaseService) {}

  touch(orgId: number): void {
    const now = Date.now();
    const prev = this.lastTouch.get(orgId);
    if (prev !== undefined && now - prev < TOUCH_WINDOW_MS) return;
    if (this.lastTouch.size >= MAX_TRACKED) this.lastTouch.clear();
    this.lastTouch.set(orgId, now);

    void this.db
      .txAs({ orgId, userId: null }, (tx) =>
        tx.execute(sql`
          UPDATE organizations SET last_activity_at = now()
           WHERE id = ${orgId} AND status = 'active'
             AND last_activity_at < now() - interval '10 minutes'`),
      )
      .catch((err: unknown) => {
        this.lastTouch.delete(orgId);
        this.logger.warn({ err, orgId }, 'activity touch failed');
      });
  }
}
