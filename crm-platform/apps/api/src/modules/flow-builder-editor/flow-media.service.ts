import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ERROR_CODES } from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import {
  FLOW_MEDIA_STORE,
  type FlowMediaStore,
} from '../../infra/providers/flow-builder-editor/flow-media.port';
import { UploadPolicyService } from '../auth';

/** WaDesk's limit for a builder upload: 51200 KB. */
export const FLOW_MEDIA_MAX_BYTES = 51_200 * 1024;
export const FLOW_MEDIA_TYPES = ['image', 'video', 'audio', 'document'] as const;
export type FlowMediaType = (typeof FLOW_MEDIA_TYPES)[number];

/**
 * Media upload for Media and Sequence nodes (WD-FLB-027). The shared upload guard decides by content, not by the client's
 * name or declared type (extension allow-list, content signature, random stored name); the store decides where the bytes go.
 * As in WaDesk, `type` only names the kind the node asked for: it is not checked against the real file kind.
 */
@Injectable()
export class FlowMediaService {
  private readonly logger = new Logger(FlowMediaService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly policy: UploadPolicyService,
    @Inject(FLOW_MEDIA_STORE) private readonly store: FlowMediaStore,
  ) {}

  async upload(
    file: { originalname: string; buffer: Buffer },
    type: FlowMediaType,
    orgKey: string,
  ): Promise<{ url: string; filename: string; type: FlowMediaType; mimeType: string }> {
    const v = this.policy.validate({
      filename: file.originalname,
      buffer: file.buffer,
      allow: ['image', 'media', 'document'],
      maxBytes: FLOW_MEDIA_MAX_BYTES,
    });
    try {
      const stored = await this.store.put(orgKey, v.storedName, file.buffer, v.mime);
      // `filename` is the server name (WaDesk's quirk, kept): the builder prefers the node's own label when it has one.
      return { url: stored.url, filename: v.storedName, type, mimeType: v.mime };
    } catch (err) {
      this.logger.error(`flow media store failed: ${(err as Error).message}`);
      throw new AppError(
        ERROR_CODES.FLB_STORAGE_UNAVAILABLE,
        'Upload failed: media storage is not available.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  async read(orgKey: string, name: string) {
    return this.store.get(orgKey, name);
  }

  /** The key a file is stored under for the caller's organization: its public uuid, never the internal id. */
  async orgUuid(): Promise<string> {
    const { orgId } = RequestContextStore.require();
    const res = await this.db.privileged((tx) =>
      tx.execute(sql`SELECT uuid FROM organizations WHERE id = ${orgId}`),
    );
    return String((res.rows[0] as { uuid: string }).uuid);
  }
}
