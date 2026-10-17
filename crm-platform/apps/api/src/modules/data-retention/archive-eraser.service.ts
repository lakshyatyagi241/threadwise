import { Inject, Injectable } from '@nestjs/common';
import {
  ARCHIVE_STORAGE,
  type ArchiveStorage,
} from '../../infra/providers/data-retention/archive-storage.port';
import { ARCHIVE_ROOT, parseObjectKey } from './archive-keys';

/**
 * Deletes a workspace's objects from the cold archive when the workspace is erased (docs/superpowers/specs/2026-10-16-event-based-analytics-design.md,
 * section 5). Objects are named per workspace, so this is a listing and a delete of exactly `<org>.ndjson.gz`; every stream and month is
 * covered, including a stream that has since left the registry. Month manifests are left alone: they hold workspace ids and row counts,
 * no personal data.
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
    const wanted = String(orgId);
    let deleted = 0;
    // One listing of the archive root, filtered here: about one request per 1,000 objects, so cheap until the archive holds hundreds of
    // thousands of objects (many thousands of workspaces times months). Past that, list streams and months by delimiter and delete
    // `archive/<stream>/<month>/<org>.ndjson.gz` directly, which costs requests per month and not per workspace.
    for (const object of await this.storage.list(ARCHIVE_ROOT)) {
      if (parseObjectKey(object.key)?.org !== wanted) continue;
      await this.storage.delete(object.key);
      deleted += 1;
    }
    return deleted;
  }
}
