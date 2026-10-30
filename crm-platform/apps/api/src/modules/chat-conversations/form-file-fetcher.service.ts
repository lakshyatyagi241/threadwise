import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../infra/db/database.service';
import type { StoredMedia } from '../../infra/providers/chat-conversations/media';
import type { WaMediaKind } from '../../infra/providers/whatsapp/media';
import { ChannelAdapterRegistry } from './channel-adapter.registry';
import { ChannelRegistryService } from './channel-registry.service';
import { ChannelsRepository } from './channels.repository';

/** One file a customer attached in a WhatsApp Form, as Meta lists it in the response (`response_json`). */
export interface FormFileRef {
  mediaId: string;
  mime: string;
  name: string | null;
  sha256: string | null;
}

/**
 * Copies the files of a WhatsApp Form response into the chat media store. A form without an endpoint hands over plain Cloud API media
 * ids (no encryption), so this is the same download the inbox does for an image or a document: through the channel's own connection,
 * size-capped, checksum-verified and type-checked by the store. A file that cannot be had is returned as null, never thrown: the
 * submission is kept either way and says which file is missing.
 */
@Injectable()
export class FormFileFetcher {
  private readonly logger = new Logger(FormFileFetcher.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly channelsRepo: ChannelsRepository,
    private readonly channels: ChannelRegistryService,
    private readonly adapters: ChannelAdapterRegistry,
  ) {}

  async fetchAll(
    orgId: number,
    channelId: number,
    refs: FormFileRef[],
    ref: string,
  ): Promise<Array<StoredMedia | null>> {
    if (refs.length === 0) return [];
    const loaded = await this.db.txAs({ orgId }, async (tx) => {
      const channel = await this.channelsRepo.byId(tx, orgId, channelId);
      if (!channel) return null;
      return {
        runtime: await this.channels.runtime(tx, orgId, channel),
        fetcher: this.adapters.find(channel.kind)?.inboundMedia,
      };
    });
    if (!loaded?.fetcher) return refs.map(() => null);
    const out: Array<StoredMedia | null> = [];
    for (const r of refs) {
      try {
        out.push(
          await loaded.fetcher.fetchAndStore({
            channel: loaded.runtime,
            mediaId: r.mediaId,
            mediaKind: (r.mime.startsWith('image/') ? 'image' : 'document') as WaMediaKind,
            declaredMime: r.mime,
            sha256: r.sha256,
            filename: r.name,
            ref,
          }),
        );
      } catch (err) {
        this.logger.warn({ orgId, ref, err: (err as Error).message }, 'form file not fetched');
        out.push(null);
      }
    }
    return out;
  }
}
