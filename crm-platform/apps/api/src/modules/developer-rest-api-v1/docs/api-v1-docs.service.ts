import { Injectable, type INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import { AppError } from '../../../common/errors/app-error';
import { BrandingService } from '../../platform-settings-branding-storage';
import { V1AutomationModule } from '../resources/automation/automation.module';
import { V1BulkModule } from '../resources/bulk/bulk.module';
import { V1CrmModule } from '../resources/crm/crm.module';
import { V1MessagingModule } from '../resources/messaging/messaging.module';
import { API_V1_TAGS } from './api-v1-tags';
import { cacheMetrics } from '@crm/observability';

const cache = cacheMetrics('api_v1_docs');

const BRAND_TOKEN = '{{brand}}';
/** The spec is rebuilt at most this often; the brand is read from settings (a few seconds old at most) and re-applied each time. */
const TTL_MS = 60_000;

/**
 * The customer API's OpenAPI document (TW-API-150), generated from the controllers: only the `/api/v1` resources, never the staff routes
 * or the signed partner surface.
 *
 * Descriptions are written with a `{{brand}}` token and the document is rewritten per brand when it is served, so a re-brand needs no
 * rebuild and no string of another product's name can survive in it (Reference rewrote its own name the same way, after generation).
 */
@Injectable()
export class ApiV1DocsService {
  private app: INestApplication | undefined;
  private cached: { at: number; doc: OpenAPIObject } | undefined;

  constructor(private readonly branding: BrandingService) {}

  /** Called once from `main.ts` (and by tests): swagger scans the live application, so it needs the instance. */
  attach(app: INestApplication): void {
    this.app = app;
    this.cached = undefined;
  }

  async spec(): Promise<OpenAPIObject> {
    if (!this.app) throw new AppError('INTERNAL', 'The API reference is not available yet.', 503);
    const now = Date.now();
    if (!this.cached || now - this.cached.at > TTL_MS) {
      cache.miss();
      this.cached = { at: now, doc: this.build(this.app) };
    } else cache.hit();
    const brand = await this.branding.name();
    return withBrand(this.cached.doc, brand);
  }

  private build(app: INestApplication): OpenAPIObject {
    const builder = new DocumentBuilder()
      .setTitle(`${BRAND_TOKEN} API`)
      .setVersion('v1')
      .setDescription(
        [
          `${BRAND_TOKEN} REST API. Authenticate with a workspace API key: send it as \`Authorization: Bearer <key>\` (or in an \`X-Api-Key\` header). Generate keys in the dashboard under Developers / API.`,
          '',
          '**Answers.** Success is `{ "data": ..., "meta": ... }`; a failure is `{ "error": { "code", "message", "details"? } }` with a stable snake_case `code`. Validation failures are always HTTP 422 with `details` listing the messages per field.',
          '',
          '**Lists** are paged with a cursor: pass `limit` (1 to 100, default 25; `per_page` is accepted as an alias) and the `cursor` from `meta.next_cursor` of the previous page. Page numbers are not supported. Identifiers are UUIDs.',
          '',
          '**Rate limit.** Each key is held to a number of requests per minute set by the workspace plan (the platform default applies when the plan sets none). Every answer carries `X-RateLimit-Limit` and `X-RateLimit-Remaining`; over the limit the answer is HTTP 429 with `Retry-After`.',
        ].join('\n'),
      )
      .addBearerAuth({ type: 'http', scheme: 'bearer' }, 'api-key')
      .build();
    const doc = SwaggerModule.createDocument(app, builder, {
      include: [V1CrmModule, V1AutomationModule, V1BulkModule, V1MessagingModule],
    });
    doc.tags = API_V1_TAGS.map((t) => ({ name: t.name, description: t.description }));
    doc.security = [{ 'api-key': [] }];
    return doc;
  }
}

/** A copy of the document with the brand token replaced in every string (keys included are left alone). */
export function withBrand<T>(value: T, brand: string): T {
  if (typeof value === 'string') return value.split(BRAND_TOKEN).join(brand) as T;
  if (Array.isArray(value)) return value.map((v) => withBrand(v, brand)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, withBrand(v, brand)]),
    ) as T;
  }
  return value;
}
