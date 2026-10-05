import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_RETENTION,
  isDumpName,
  planRetention,
  takenAt,
  type RetentionPolicy,
} from './retention';
import type { S3Client } from './s3-client';
import { sealFile } from './seal';

export interface SyncOptions {
  /** Where the backup service writes verified dumps. */
  dir: string;
  client: Pick<S3Client, 'put' | 'head' | 'list' | 'delete'>;
  /** Folder in the bucket, no leading or trailing slash. */
  prefix: string;
  key: Buffer;
  now?: Date;
  prune?: boolean;
  retention?: RetentionPolicy;
  log?: (line: string) => void;
}

export interface SyncResult {
  uploaded: string[];
  alreadyThere: number;
  failed: Array<{ file: string; error: string }>;
  pruned: string[];
  /** Dumps found locally. 0 means there is nothing to protect yet. */
  local: number;
}

async function digests(path: string): Promise<{ sha256: string; md5: string; size: number }> {
  const sha = createHash('sha256');
  const md5 = createHash('md5');
  for await (const chunk of createReadStream(path)) {
    sha.update(chunk as Buffer);
    md5.update(chunk as Buffer);
  }
  return { sha256: sha.digest('hex'), md5: md5.digest('hex'), size: (await stat(path)).size };
}

/**
 * One pass: seal and upload every verified dump the bucket does not have yet, check each upload by size and MD5, then thin the
 * bucket to the retention policy. Safe to run as often as you like and to interrupt: a dump counts as uploaded only once its
 * sealed copy is in the bucket with the right size and checksum. The local dumps are never touched.
 */
export async function syncOffsite(o: SyncOptions): Promise<SyncResult> {
  const log = o.log ?? (() => undefined);
  const now = o.now ?? new Date();
  const files = (await readdir(o.dir)).filter(isDumpName).sort();
  const remote = await o.client.list(`${o.prefix}/`);
  const have = new Set(remote.map((r) => r.key));
  const result: SyncResult = {
    uploaded: [],
    alreadyThere: 0,
    failed: [],
    pruned: [],
    local: files.length,
  };

  for (const file of files) {
    const remoteKey = `${o.prefix}/${file}.enc`;
    if (have.has(remoteKey)) {
      result.alreadyThere += 1;
      continue;
    }
    const sealed = join(tmpdir(), `offsite-${process.pid}-${file}.enc`);
    try {
      await sealFile(join(o.dir, file), sealed, o.key);
      const d = await digests(sealed);
      await o.client.put(remoteKey, sealed, d.size, d.sha256);
      const head = await o.client.head(remoteKey);
      if (!head) throw new Error('uploaded but not found afterwards');
      if (head.size !== d.size)
        throw new Error(`size differs: sent ${d.size}, stored ${head.size}`);
      if (head.etag && /^[0-9a-f]{32}$/.test(head.etag) && head.etag !== d.md5) {
        throw new Error('checksum differs after upload');
      }
      result.uploaded.push(file);
      have.add(remoteKey);
      log(`uploaded ${file} (${d.size} bytes sealed)`);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      result.failed.push({ file, error });
      log(`FAILED ${file}: ${error}`);
    } finally {
      await rm(sealed, { force: true });
    }
  }

  if (o.prune !== false) {
    const plan = planRetention(
      [...have].map((key) => ({ key, at: takenAt(key) })),
      now,
      o.retention ?? DEFAULT_RETENTION,
    );
    for (const key of plan.remove) {
      try {
        await o.client.delete(key);
        result.pruned.push(key);
        log(`pruned ${key}`);
      } catch (err) {
        log(`could not prune ${key}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  return result;
}
