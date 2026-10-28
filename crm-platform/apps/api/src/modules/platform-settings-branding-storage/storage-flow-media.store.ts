import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { StorageCategory } from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import type { Env } from '../../config/env.schema';
import type {
  FlowMediaStore,
  StoredFlowMedia,
} from '../../infra/providers/flow-builder-editor/flow-media.port';
import {
  LocalFlowMediaAdapter,
  SAFE,
  SAFE_NAME,
  flowMediaMime,
} from '../../infra/providers/flow-builder-editor/local-flow-media.adapter';
import { MediaStorageService } from './media-storage.service';

/** The object key of a flow's uploaded file in the workspace bucket. */
const keyOf = (orgKey: string, name: string): string => `flow-media/${orgKey}/${name}`;

/**
 * A flow's file is sent in a message to a customer, the same kind of file as a broadcast attachment, so it counts as `campaign_media`.
 * A dedicated category would need a new value in the storage_usage CHECK constraint (a migration); this stays inside the existing list.
 */
const FLOW_MEDIA_CATEGORY: StorageCategory = 'campaign_media';

/**
 * Flow media (Send media and Sequence nodes) in the bucket, so a release or a restart does not lose it. The container's own disk
 * is wiped by every release, which is how an upload from yesterday ended up as a 404. Without a bucket (local development) the file
 * stays on the local disk, as before. A bucket that refuses a write fails the upload; it does not fall back to the disk.
 */
@Injectable()
export class StorageFlowMediaStore implements FlowMediaStore {
  private readonly local: LocalFlowMediaAdapter;

  constructor(
    private readonly storage: MediaStorageService,
    private readonly config: ConfigService<Env, true>,
  ) {
    this.local = new LocalFlowMediaAdapter(config);
  }

  async put(orgKey: string, name: string, data: Buffer): Promise<StoredFlowMedia> {
    if (!SAFE.test(orgKey) || !SAFE_NAME.test(name)) throw new Error('unsafe media path');
    // The key carries the workspace's uuid, not its numeric id the quota meter counts by, so the id comes from the request.
    const { orgId } = RequestContextStore.require();
    const stored = await this.storage.put(keyOf(orgKey, name), data, flowMediaMime(name), {
      orgId,
      category: FLOW_MEDIA_CATEGORY,
    });
    if (!stored) return this.local.put(orgKey, name, data);
    const base = String(this.config.get('APP_URL', { infer: true })).replace(/\/$/, '');
    return { url: `${base}/v2/flow-media/${orgKey}/${name}` };
  }

  async get(orgKey: string, name: string): Promise<{ data: Buffer; mime: string } | null> {
    if (!SAFE.test(orgKey) || !SAFE_NAME.test(name)) return null;
    const data = await this.storage.read(keyOf(orgKey, name));
    if (data) return { data, mime: flowMediaMime(name) };
    return this.local.get(orgKey, name);
  }
}
