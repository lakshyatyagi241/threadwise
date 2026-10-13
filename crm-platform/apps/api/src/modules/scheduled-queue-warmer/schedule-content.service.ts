import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  scheduleMediaProblem,
  scheduleMediaProblemText,
  type ScheduleMediaKind,
} from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import {
  TEMPLATE_DIRECTORY,
  mediaUrlProblem,
  sanitizeOverrides,
  templateRefusals,
  type TemplateDirectory,
  type TemplateOverrides,
} from '../broadcasts';

const fail = (message: string, path: string): AppError =>
  AppError.validation(message, [{ path, message }]);

/** What the composer's message step asks for, create or edit (the fields both inputs share). */
export interface ContentInput {
  messageType: 'plain' | 'template' | 'media' | 'location';
  message?: string | undefined;
  templateId?: string | undefined;
  templateOverrides?: Record<string, unknown> | undefined;
  media?: string | undefined;
  mediaId?: string | undefined;
  latitude?: number | undefined;
  longitude?: number | undefined;
}

/** A sender the content will go through: its engine, and for a Cloud API number the row it is. */
export interface ContentSender {
  engine: string;
  id: number;
}

export interface ResolvedContent {
  /** The message text: the plain body, the media caption, the place name, or the template's own text. */
  body: string;
  templateRowId: number | null;
  /** `text`, `template`, `media`, `media_with_caption` or `location`: the `template_type` column. */
  templateType: 'text' | 'template' | 'media' | 'media_with_caption' | 'location';
  overrides: TemplateOverrides | null;
  /** The https link, or the object key of an uploaded file. */
  media: string | null;
  /** The upload row when the file was uploaded (so it can be kept or removed with the schedule). */
  mediaUploadId: number | null;
  latitude: number | null;
  longitude: number | null;
}

/**
 * What a schedule sends, checked once for create and edit (TW-SCHED-006): the plain text, the approved template with its filled
 * variables, the file (an upload of this workspace or an https link) or the pin. Everything that can be refused is refused here, before
 * anything is written, and the refusals are the same for both (a template Meta has not approved cannot go to a Cloud API number; a file
 * the channel would refuse is refused with the channel's limit).
 */
@Injectable()
export class ScheduleContentService {
  constructor(
    private readonly db: DatabaseService,
    @Inject(TEMPLATE_DIRECTORY) private readonly templates: TemplateDirectory,
  ) {}

  async resolve(
    orgId: number,
    input: ContentInput,
    senders: readonly ContentSender[],
  ): Promise<ResolvedContent> {
    const message = (input.message ?? '').trim();
    const engines = new Set(senders.map((s) => s.engine));
    let body = message;
    let templateRowId: number | null = null;
    let overrides: TemplateOverrides | null = null;

    if (input.messageType === 'template') {
      if (!input.templateId) throw fail('Choose a template.', 'templateId');
      const tpl = await this.db.tx((tx) => this.templates.find(tx, orgId, input.templateId!));
      if (!tpl) throw fail('That template was not found.', 'templateId');
      body = tpl.templateBody;
      templateRowId = tpl.id;
      overrides = sanitizeOverrides(input.templateOverrides);
      if (engines.has('waba')) await this.assertCloudApiCan(orgId, tpl, senders);
      else if (tpl.templateType === 'auth') {
        throw fail(
          'Authentication (OTP) templates cannot be scheduled: each recipient needs a unique code.',
          'templateId',
        );
      }
    }

    const hasLocation = input.latitude !== undefined && input.longitude !== undefined;
    let media: string | null = null;
    let mediaUploadId: number | null = null;
    if (input.messageType === 'media' || input.mediaId || input.media) {
      if (input.mediaId) {
        const up = await this.db.tx((tx) =>
          tx.execute(sql`
            SELECT id, storage_key, mime, kind, size_bytes FROM scheduled_media
             WHERE org_id = ${orgId} AND uuid = ${input.mediaId}::uuid`),
        );
        const r = up.rows[0] as
          | {
              id: number | string;
              storage_key: string;
              mime: string;
              kind: ScheduleMediaKind;
              size_bytes: number;
            }
          | undefined;
        if (!r) throw fail('That file was not found. Upload it again.', 'mediaId');
        for (const engine of engines) {
          const problem = scheduleMediaProblem(engine, {
            kind: r.kind,
            mime: r.mime,
            size: Number(r.size_bytes),
          });
          if (problem) throw fail(scheduleMediaProblemText(problem), 'mediaId');
        }
        media = r.storage_key;
        mediaUploadId = Number(r.id);
      } else if (input.media) {
        // A link the sender can fetch. A Cloud API number needs one Meta can reach: https and a public host.
        if (!/^https?:\/\//i.test(input.media)) {
          throw fail('Give the file as a link (https://...) or upload it.', 'media');
        }
        if (engines.has('waba')) {
          const problem = mediaUrlProblem(input.media);
          if (problem) throw fail(problem, 'media');
        }
        media = input.media;
      }
    }

    const templateType: ResolvedContent['templateType'] =
      input.messageType === 'template'
        ? 'template'
        : hasLocation
          ? 'location'
          : media
            ? body
              ? 'media_with_caption'
              : 'media'
            : 'text';
    // Reference let an empty plain message through and then failed every recipient; refuse it here.
    if (templateType === 'text' && !body) throw fail('Write the message to send.', 'message');
    if (input.messageType === 'media' && !media) throw fail('Upload the file to send.', 'media');
    if (input.messageType === 'location' && !hasLocation)
      throw fail('Pick the place to send.', 'latitude');
    return {
      body,
      templateRowId,
      templateType,
      overrides,
      media: input.messageType === 'template' ? null : media,
      mediaUploadId: input.messageType === 'template' ? null : mediaUploadId,
      latitude: hasLocation && input.messageType !== 'template' ? input.latitude! : null,
      longitude: hasLocation && input.messageType !== 'template' ? input.longitude! : null,
    };
  }

  /**
   * The gates Reference ran before a schedule could use a template on a Cloud API number: not an authentication template, approved by
   * Meta (and not paused for poor feedback), media Meta can fetch, and the template lives on the number it is sent from.
   */
  private async assertCloudApiCan(
    orgId: number,
    tpl: Awaited<ReturnType<TemplateDirectory['find']>> & object,
    senders: readonly ContentSender[],
  ): Promise<void> {
    const v2 = await this.db.tx((tx) => this.templates.wabaTemplatesV2Enabled(tx));
    const mediaUrl = tpl.attachmentFile ? this.templates.mediaUrl(tpl.attachmentFile) : null;
    const refusals = templateRefusals({ ...tpl, mediaUrl }, { wabaTemplatesV2: v2 });
    if (refusals.length) throw fail(refusals[0]!, 'templateId');
    if (!tpl.metaTemplateId || (tpl.metaStatus ?? '').toUpperCase() !== 'APPROVED') {
      throw fail(
        `Template is not approved by Meta yet (status: ${tpl.metaStatus ?? 'not submitted'}). A Cloud API number can only send an approved template.`,
        'templateId',
      );
    }
    const tied = await this.db.tx((tx) =>
      tx.execute(sql`
        SELECT provider_config_id FROM wa_templates WHERE org_id = ${orgId} AND id = ${tpl.id}`),
    );
    const config = (tied.rows[0] as { provider_config_id: number | string | null } | undefined)
      ?.provider_config_id;
    if (config !== null && config !== undefined) {
      const other = senders.find((s) => s.engine === 'waba' && s.id !== Number(config));
      if (other) {
        throw fail(
          'This template belongs to another WhatsApp Cloud API number. Pick a template of the number you send from.',
          'templateId',
        );
      }
    }
  }
}
