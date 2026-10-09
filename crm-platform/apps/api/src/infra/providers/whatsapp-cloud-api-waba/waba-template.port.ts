import type { WabaConnection } from './waba-admin.port';

/**
 * Message templates on a WhatsApp Business Account: create, read back, delete, and the media handle a header example needs.
 * Written against the port so a second BSP is one more adapter. All calls go through the number's own route.
 */

export type TemplateParameterFormat = 'POSITIONAL' | 'NAMED';

export interface CreateRemoteTemplate {
  name: string;
  language: string;
  /** MARKETING | UTILITY | AUTHENTICATION */
  category: string;
  components: unknown[];
  /** Geta drops this; Meta then applies its default. We send it so a mis-categorised template is corrected, not rejected. */
  allowCategoryChange?: boolean;
  parameterFormat?: TemplateParameterFormat;
  messageSendTtlSeconds?: number;
}

/** An edit of a template Meta already holds (Meta keeps its name and language; it takes the category and the components). */
export interface EditRemoteTemplate {
  category?: string;
  components: unknown[];
  parameterFormat?: TemplateParameterFormat;
}

export interface CreatedRemoteTemplate {
  id: string;
  status: string;
  category: string | null;
}

export interface RemoteTemplate {
  id: string;
  name: string;
  language: string;
  status: string;
  category: string | null;
  components: unknown[];
  qualityScore: string | null;
  rejectedReason: string | null;
  correctCategory: string | null;
  parameterFormat: TemplateParameterFormat | null;
}

export interface TemplatePage {
  items: RemoteTemplate[];
  /** Cursor for the next page. Never `paging.next`: through Interakt that URL points at Graph, which rejects the Interakt key. */
  next: string | null;
}

export interface MediaUpload {
  bytes: Uint8Array;
  fileName: string;
  mimeType: string;
}

export interface WabaTemplatePort {
  create(conn: WabaConnection, input: CreateRemoteTemplate): Promise<CreatedRemoteTemplate>;
  /** Edits a template in place (`POST /{id}`); Meta sends it back to review. */
  edit(conn: WabaConnection, metaTemplateId: string, input: EditRemoteTemplate): Promise<void>;
  list(
    conn: WabaConnection,
    opts?: { name?: string; status?: string; limit?: number; after?: string },
  ): Promise<TemplatePage>;
  /** Every template of the WABA, followed by cursor. Bounded: stops at `maxPages`. */
  listAll(conn: WabaConnection, opts?: { maxPages?: number }): Promise<RemoteTemplate[]>;
  /** The first language variant Meta holds under this name, or null. */
  getByName(conn: WabaConnection, name: string): Promise<RemoteTemplate | null>;
  /** Deletes every language of that name (Meta deletes by name; `hsmId` narrows to one language). */
  deleteByName(conn: WabaConnection, name: string, hsmId?: string): Promise<void>;
  /** Uploads a header example and returns the handle Meta wants in `example.header_handle`. */
  uploadHeaderMedia(conn: WabaConnection, media: MediaUpload): Promise<string>;
}

export const WABA_TEMPLATES = Symbol('WABA_TEMPLATES');
