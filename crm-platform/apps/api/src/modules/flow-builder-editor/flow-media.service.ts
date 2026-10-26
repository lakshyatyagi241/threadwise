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
import {
  type FetchedMedia,
  SafeFetch,
  UnsafeMediaUrlError,
} from '../../infra/providers/node-bridge-runtime/safe-fetch';
import { UploadPolicyService, type ValidatedUpload } from '../auth';

/** Reference's limit for a builder upload: 51200 KB. */
export const FLOW_MEDIA_MAX_BYTES = 51_200 * 1024;
export const FLOW_MEDIA_TYPES = ['image', 'video', 'audio', 'document'] as const;
export type FlowMediaType = (typeof FLOW_MEDIA_TYPES)[number];

/** A carousel picture kept from a web address: a picture, not a file, so a far smaller cap than an upload. */
export const FLOW_MEDIA_COPY_MAX_BYTES = 5 * 1024 * 1024;
const FLOW_MEDIA_COPY_TIMEOUT_MS = 15_000;
/** The pictures a copy may be, by the type the host answers with; the bytes are checked against the extension after. */
const COPY_EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

const copyRefused = (message: string): AppError =>
  AppError.validation(message, [{ path: 'url', message }]);
const copyNotPicture = (): AppError =>
  copyRefused('This address does not point to a JPG, PNG, WebP or GIF picture.');

/**
 * Media upload for Media and Sequence nodes (TW-FLB-027). The shared upload guard decides by content, not by the client's
 * name or declared type (extension allow-list, content signature, random stored name); the store decides where the bytes go.
 * As in Reference, `type` only names the kind the node asked for: it is not checked against the real file kind.
 */
@Injectable()
export class FlowMediaService {
  private readonly logger = new Logger(FlowMediaService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly policy: UploadPolicyService,
    @Inject(FLOW_MEDIA_STORE) private readonly store: FlowMediaStore,
    private readonly fetcher: SafeFetch,
  ) {}

  async upload(
    file: { originalname: string; buffer: Buffer },
    type: FlowMediaType,
    orgKey: string,
  ): Promise<{ url: string; filename: string; type: FlowMediaType; mimeType: string }> {
    const v = await this.policy.validateScanned({
      filename: file.originalname,
      buffer: file.buffer,
      allow: ['image', 'media', 'document'],
      maxBytes: FLOW_MEDIA_MAX_BYTES,
    });
    const url = await this.save(orgKey, v.storedName, file.buffer, v.mime);
    // `filename` is the server name (Reference's quirk, kept): the builder prefers the node's own label when it has one.
    return { url, filename: v.storedName, type, mimeType: v.mime };
  }

  /**
   * Keeps a copy of a picture found at `address`, so the chat can show it without the picture's own host (which may refuse
   * a visitor's browser). The copy is checked the way an upload is: the bytes must be a picture of the type the host named.
   * A host that refuses this server's request (for example one that wants a referring page) is reported as unreachable; this
   * never sends a made-up referrer to get past a host's rule.
   */
  async importFromUrl(
    address: string,
    orgKey: string,
  ): Promise<{ url: string; filename: string; type: 'image'; mimeType: string }> {
    let fetched: FetchedMedia;
    try {
      fetched = await this.fetcher.fetchMedia(address, {
        maxBytes: FLOW_MEDIA_COPY_MAX_BYTES,
        timeoutMs: FLOW_MEDIA_COPY_TIMEOUT_MS,
      });
    } catch (err) {
      if (err instanceof UnsafeMediaUrlError) {
        throw copyRefused('That address cannot be used. Paste a public web address.');
      }
      this.logger.warn(`carousel picture copy failed: ${(err as Error).message}`);
      throw copyRefused(
        'The picture could not be fetched from that address. Check that it opens in a browser, or upload the picture instead.',
      );
    }
    const extension = COPY_EXTENSION_BY_MIME[fetched.mimetype];
    if (!extension) throw copyNotPicture();
    let v: ValidatedUpload;
    try {
      v = await this.policy.validateScanned({
        filename: `copy.${extension}`,
        buffer: fetched.buffer,
        allow: ['image'],
        maxBytes: FLOW_MEDIA_COPY_MAX_BYTES,
      });
    } catch (err) {
      if (err instanceof AppError && err.code === ERROR_CODES.AUTH_UPLOAD_REJECTED)
        throw copyNotPicture();
      throw err;
    }
    const url = await this.save(orgKey, v.storedName, fetched.buffer, v.mime);
    return { url, filename: v.storedName, type: 'image', mimeType: v.mime };
  }

  private async save(orgKey: string, name: string, data: Buffer, mime: string): Promise<string> {
    try {
      const stored = await this.store.put(orgKey, name, data, mime);
      return stored.url;
    } catch (err) {
      this.logger.error(`flow media store failed: ${(err as Error).message}`);
      throw new AppError(
        ERROR_CODES.FLB_STORAGE_UNAVAILABLE,
        'Media storage is not available right now. Paste a file URL instead, or try again later.',
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
