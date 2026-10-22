import { Inject, Injectable } from '@nestjs/common';
import { WABA_ENV, type WabaEnv } from '../../../config/domains/whatsapp-cloud-api-waba.env';
import type { WabaConnection } from './waba-admin.port';
import { WabaHttp, type WabaAuth } from './waba-http';
import { uploadMediaHandle } from './waba-media-upload';
import type {
  CreateRemoteTemplate,
  CreatedRemoteTemplate,
  EditRemoteTemplate,
  MediaUpload,
  RemoteTemplate,
  TemplatePage,
  WabaTemplatePort,
} from './waba-template.port';

const FIELDS =
  'id,name,status,category,language,components,quality_score,rejected_reason,correct_category,parameter_format';
const PAGE = 100;

interface RawTemplate {
  id?: string;
  name?: string;
  status?: string;
  category?: string;
  language?: string;
  components?: unknown[];
  quality_score?: { score?: string } | string | null;
  rejected_reason?: string | null;
  correct_category?: string | null;
  parameter_format?: string | null;
}

const authOf = (c: WabaConnection, phone = false): WabaAuth =>
  c.registry
    ? c.registry
    : c.provider === 'interakt'
      ? {
          provider: 'interakt',
          authKey: c.authKey ?? '',
          wabaId: c.wabaId,
          ...(phone ? { phoneNumberId: c.phoneNumberId } : {}),
        }
      : { provider: 'meta', accessToken: c.accessToken ?? '' };

function toRemote(t: RawTemplate): RemoteTemplate {
  const q = t.quality_score;
  return {
    id: String(t.id ?? ''),
    name: t.name ?? '',
    language: t.language ?? '',
    status: (t.status ?? 'PENDING').toUpperCase(),
    category: t.category ? t.category.toUpperCase() : null,
    components: Array.isArray(t.components) ? t.components : [],
    qualityScore: (typeof q === 'string' ? q : q?.score)?.toUpperCase() ?? null,
    rejectedReason: t.rejected_reason ?? null,
    correctCategory: t.correct_category ?? null,
    parameterFormat:
      t.parameter_format === 'NAMED' || t.parameter_format === 'POSITIONAL'
        ? t.parameter_format
        : null,
  };
}

/** Template calls for Meta direct and Interakt (same Graph paths; only host and headers differ). */
@Injectable()
export class WabaTemplateClient implements WabaTemplatePort {
  constructor(
    private readonly http: WabaHttp,
    @Inject(WABA_ENV) private readonly env: WabaEnv,
  ) {}

  async create(conn: WabaConnection, input: CreateRemoteTemplate): Promise<CreatedRemoteTemplate> {
    const res = await this.http.call<{ id?: string; status?: string; category?: string }>(
      authOf(conn),
      {
        method: 'POST',
        path: `/${conn.wabaId}/message_templates`,
        json: {
          name: input.name,
          language: input.language,
          category: input.category,
          components: input.components,
          ...(input.allowCategoryChange !== undefined
            ? { allow_category_change: input.allowCategoryChange }
            : {}),
          ...(input.parameterFormat ? { parameter_format: input.parameterFormat } : {}),
          ...(input.messageSendTtlSeconds
            ? { message_send_ttl_seconds: input.messageSendTtlSeconds }
            : {}),
        },
      },
    );
    if (!res.id) throw new Error('Meta accepted the template but returned no id');
    return {
      id: String(res.id),
      status: (res.status ?? 'PENDING').toUpperCase(),
      category: res.category ?? null,
    };
  }

  async edit(
    conn: WabaConnection,
    metaTemplateId: string,
    input: EditRemoteTemplate,
  ): Promise<void> {
    await this.http.call(authOf(conn), {
      method: 'POST',
      path: `/${metaTemplateId}`,
      json: {
        ...(input.category ? { category: input.category } : {}),
        components: input.components,
      },
    });
  }

  async list(
    conn: WabaConnection,
    opts: { name?: string; status?: string; limit?: number; after?: string } = {},
  ): Promise<TemplatePage> {
    const res = await this.http.call<{
      data?: RawTemplate[];
      paging?: { cursors?: { after?: string }; next?: string };
    }>(authOf(conn), {
      method: 'GET',
      path: `/${conn.wabaId}/message_templates`,
      query: {
        fields: FIELDS,
        limit: opts.limit ?? PAGE,
        name: opts.name,
        status: opts.status,
        after: opts.after,
      },
    });
    // `paging.next` is only a "there is more" signal; the cursor is what we send back.
    const more = Boolean(res.paging?.next);
    return {
      items: (res.data ?? []).map(toRemote),
      next: more ? (res.paging?.cursors?.after ?? null) : null,
    };
  }

  async listAll(conn: WabaConnection, opts: { maxPages?: number } = {}): Promise<RemoteTemplate[]> {
    const out: RemoteTemplate[] = [];
    let after: string | undefined;
    for (let page = 0; page < (opts.maxPages ?? 50); page++) {
      const res = await this.list(conn, { after });
      out.push(...res.items);
      if (!res.next || res.next === after) return out;
      after = res.next;
    }
    return out;
  }

  async getByName(conn: WabaConnection, name: string): Promise<RemoteTemplate | null> {
    return (await this.list(conn, { name, limit: 10 })).items.find((t) => t.name === name) ?? null;
  }

  async deleteByName(conn: WabaConnection, name: string, hsmId?: string): Promise<void> {
    await this.http.call(authOf(conn), {
      method: 'DELETE',
      path: `/${conn.wabaId}/message_templates`,
      query: { name, hsm_id: hsmId },
    });
  }

  async uploadHeaderMedia(conn: WabaConnection, media: MediaUpload): Promise<string> {
    return uploadMediaHandle(this.http, this.env, conn, media, 'a template header example');
  }
}
