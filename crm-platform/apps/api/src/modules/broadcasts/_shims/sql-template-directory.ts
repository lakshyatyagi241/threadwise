import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import { MediaStorageService } from '../../platform-settings-branding-storage';
import type { TemplateDirectory, TemplateRecord } from './tokens';

interface Raw {
  id: number | string;
  uuid: string;
  template_name: string;
  language: string;
  template_body: string;
  header: string | null;
  footer: string | null;
  header_location: unknown;
  parameter_format: string | null;
  variable_map: unknown;
  buttons: unknown;
  carousel_data: unknown;
  template_type: string;
  attachment_type: string | null;
  attachment_file: string | null;
  header_media_key: string | null;
  meta_template_id: string | null;
  meta_status: string | null;
  paused_until: Date | string | null;
  quality_score: string | null;
}

/** Long enough for Meta to fetch the file at send time, also for a slow run. */
const MEDIA_LINK_TTL_S = 24 * 3600;
const MEDIA_LINK_REUSE_MS = 60_000;

/** Reads `wa_templates` directly until the templates domain exports its own lookup. */
@Injectable()
export class SqlTemplateDirectory implements TemplateDirectory {
  /** A link is good for a day; one is reused for a minute so a run does not ask storage once per recipient. */
  private readonly linked = new Map<string, { url: string | null; until: number }>();

  constructor(private readonly storage: MediaStorageService) {}

  async find(tx: Tx, orgId: number, uuid: string): Promise<TemplateRecord | undefined> {
    return this.one(tx, sql`uuid = ${uuid}::uuid`, orgId);
  }

  async findById(tx: Tx, orgId: number, id: number): Promise<TemplateRecord | undefined> {
    return this.one(tx, sql`id = ${id}`, orgId);
  }

  private async one(
    tx: Tx,
    where: ReturnType<typeof sql>,
    orgId: number,
  ): Promise<TemplateRecord | undefined> {
    const res = await tx.execute(sql`
      SELECT id, uuid, template_name, language, template_body, header, footer, header_location, parameter_format,
             variable_map, buttons, carousel_data, template_type, attachment_type, attachment_file, header_media_key, meta_template_id,
             meta_status, paused_until, quality_score
      FROM wa_templates WHERE org_id = ${orgId} AND ${where}`);
    const r = res.rows[0] as unknown as Raw | undefined;
    if (!r) return undefined;
    return {
      id: Number(r.id),
      uuid: r.uuid,
      templateName: r.template_name,
      language: r.language,
      templateBody: r.template_body,
      header: r.header,
      footer: r.footer,
      headerLocation: r.header_location,
      parameterFormat: r.parameter_format,
      variableMap: r.variable_map,
      buttons: r.buttons,
      carouselData: r.carousel_data,
      templateType: r.template_type,
      attachmentType: r.attachment_type,
      attachmentFile: r.attachment_file,
      headerMediaKey: r.header_media_key,
      metaTemplateId: r.meta_template_id,
      metaStatus: r.meta_status,
      pausedUntil: r.paused_until ? new Date(r.paused_until) : null,
      qualityScore: r.quality_score,
    };
  }

  /** Only an absolute URL can be checked; a stored path needs the storage domain, so its check is skipped for now. */
  mediaUrl(path: string): string | null {
    return /^https?:\/\//i.test(path) ? path : null;
  }

  async mediaUrls(
    paths: readonly string[],
    ttlSeconds: number = MEDIA_LINK_TTL_S,
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const stored = [...new Set(paths.filter((p) => p.trim() !== ''))].filter((p) => {
      const direct = this.mediaUrl(p);
      if (direct) out.set(p, direct);
      return !direct;
    });
    const now = Date.now();
    const missing = stored.filter((path) => {
      const hit = this.linked.get(`${ttlSeconds}:${path}`);
      if (!hit || hit.until <= now) return true;
      if (hit.url) out.set(path, hit.url);
      return false;
    });
    if (missing.length === 0) return out;
    for (const [k, v] of this.linked) if (v.until <= now) this.linked.delete(k);
    const link = await this.storage.linker(ttlSeconds);
    for (const path of missing) {
      const url = await link(path);
      if (url) out.set(path, url);
      // A key with no link (local disk) is remembered too, so a run does not ask storage again for every recipient.
      this.linked.set(`${ttlSeconds}:${path}`, { url, until: now + MEDIA_LINK_REUSE_MS });
    }
    return out;
  }

  /** The platform setting lives in the settings domain; off until that domain exposes it (the guard then does not run). */
  async wabaTemplatesV2Enabled(_tx: Tx): Promise<boolean> {
    return false;
  }
}
