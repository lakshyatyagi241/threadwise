import { Inject, Injectable } from '@nestjs/common';
import {
  ARCHIVE_STORAGE,
  type ArchiveStorage,
} from '../../infra/providers/data-retention/archive-storage.port';
import { ARCHIVE_ROOT, parseObjectKey } from './archive-keys';

/**
 * Deletes a workspace's objects from the cold archive when the workspace is erased (docs/superpowers/specs/2026-10-16-event-based-analytics-design.md,
 * section 5). Objects are named per workspace (`archive/<stream>/<month>/<org>.ndjson.gz`), so the eraser walks the stream and month
 * directories and deletes that one name in each. The cost is a few requests per stream and month, not a listing of every object of every
 * workspace. Every stream and month is covered, including a stream that has since left the registry. Month manifests are left alone:
 * they hold workspace ids and row counts, no personal data.
 */
@Injectable()
export class ArchiveEraser {
  constructor(@Inject(ARCHIVE_STORAGE) private readonly storage: ArchiveStorage) {}

  /** Returns how many objects were deleted. Safe to repeat. */
  async eraseOrg(orgId: number): Promise<number> {
    // Workspace 0 holds platform-wide rows, not a tenant's data; it is never erased this way.
    if (!Number.isSafeInteger(orgId) || orgId <= 0) {
      throw new Error(`workspace id must be a positive integer, got ${orgId}`);
    }
    let deleted = 0;
    for (const streamDir of await this.storage.listDirs(ARCHIVE_ROOT)) {
      for (const monthDir of await this.storage.listDirs(streamDir)) {
        const key = `${monthDir}${orgId}.ndjson.gz`;
        // A directory that is not `<stream>/<yyyy-mm>/` is somebody else's; leave it alone.
        if (parseObjectKey(key) === null) continue;
        if (await this.storage.delete(key)) deleted += 1;
      }
    }
    return deleted;
  }
}
