import { Injectable } from '@nestjs/common';
import type { CatalogSendMirrorInput, ConversationMirror } from './tokens';

/**
 * Blocked on team-inbox (TIB): WaDesk found or created the recipient's conversation and wrote an outbound message with
 * `kind: catalog` into it. Until the inbox exports that, nothing is mirrored; `cat_catalog_sends` keeps the record.
 */
@Injectable()
export class NoopConversationMirror implements ConversationMirror {
  async mirrorCatalogSend(_input: CatalogSendMirrorInput): Promise<void> {
    // intentionally empty
  }
}
