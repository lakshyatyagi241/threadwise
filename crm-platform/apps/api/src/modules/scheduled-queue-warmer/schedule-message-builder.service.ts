import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import { buildSend, type TemplateShape } from '../../infra/providers/whatsapp/meta-send-payload';
import {
  TEMPLATE_DIRECTORY,
  applyOverrides,
  buildRecipientVars,
  commandForText,
  effectiveCategory,
  renderPlainBody,
  sanitizeOverrides,
  templateRefusals,
  type TemplateDirectory,
  type TemplateOverrides,
  type TemplateRecord,
} from '../broadcasts';
import { MergeTagService, renderMergeTags, resolveToken, type MergeContext } from '../crm';
import { MediaStorageService } from '../platform-settings-branding-storage';
import { UnsupportedSendError, type SendCommand } from '../node-bridge-runtime';

/** A signed link on a private bucket has to outlive the longest run, not the longest schedule: it is made again for every run. */
const FILE_LINK_TTL_S = 24 * 3600;

/** What the builder needs of a schedule: the columns that say what is sent. */
export interface MessageSource {
  template_type: string;
  message_content: string | null;
  media_file: string | null;
  latitude: string | number | null;
  longitude: string | number | null;
  template_id: number | string | null;
  template_overrides: unknown;
}

/** Everything about the message that is the same for every recipient of one run. */
export interface PreparedMessage {
  kind: string;
  engine: string;
  body: string;
  /** The address the sender fetches the file from: the link as typed, or a fresh signed link for an uploaded file. */
  mediaUrl: string | null;
  mediaMime: string | null;
  mediaName: string | null;
  latitude: number | null;
  longitude: number | null;
  template: (TemplateRecord & { category: string }) | null;
  overrides: TemplateOverrides | null;
  /** Merge-tag context shared by all recipients; null when nothing in the message needs it. */
  mergeBase: Omit<MergeContext, 'contact'> | null;
}

export type RecipientContact = MergeContext['contact'];

/**
 * Turns a schedule row into the command one recipient is sent (TW-SCHED-006). One place for create's test message and every run, so
 * the test shows what the customer will get.
 *
 * Text and caption: the merge tags are filled from the contact. Template: on a Cloud API number the template goes out as Meta's own
 * template (the variables filled from the contact, the person's overrides laid on top, the 24-hour window not applying); on the
 * unofficial engine and Twilio the approved text goes out with the same variables filled. File: an uploaded file is signed for the
 * run, a pasted link is used as typed. All of it is decided once in `prepare`, so a message that cannot be sent fails the schedule
 * once, with the reason, instead of failing every recipient.
 */
@Injectable()
export class ScheduleMessageBuilder {
  constructor(
    private readonly merge: MergeTagService,
    private readonly storage: MediaStorageService,
    @Inject(TEMPLATE_DIRECTORY) private readonly templates: TemplateDirectory,
  ) {}

  async prepare(
    tx: Tx,
    orgId: number,
    row: MessageSource,
    engine: string,
  ): Promise<PreparedMessage> {
    const body = row.message_content ?? '';
    const kind = row.template_type;
    let template: PreparedMessage['template'] = null;
    let mediaUrl: string | null = null;
    let mediaMime: string | null = null;
    let mediaName: string | null = null;

    if (kind === 'location') {
      // A missing coordinate is not 0: `Number(null)` and `Number('')` are both 0, a valid point in the Atlantic.
      const coord = (v: string | number | null): number =>
        v === null || (typeof v === 'string' && v.trim() === '') ? Number.NaN : Number(v);
      const latitude = coord(row.latitude);
      const longitude = coord(row.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        throw new UnsupportedSendError('This location schedule has no coordinates.');
      }
    }

    if (kind === 'media' || kind === 'media_with_caption') {
      const file = row.media_file ?? '';
      if (/^https?:\/\//i.test(file)) {
        mediaUrl = file;
      } else if (file) {
        const up = await tx.execute(sql`
          SELECT mime, file_name FROM scheduled_media WHERE org_id = ${orgId} AND storage_key = ${file}`);
        const meta = up.rows[0] as { mime: string; file_name: string } | undefined;
        if (!meta) {
          throw new UnsupportedSendError(
            'The file of this schedule is no longer available. Edit the schedule and upload it again.',
          );
        }
        mediaMime = meta.mime;
        mediaName = meta.file_name;
        mediaUrl = await this.storage.url(file, FILE_LINK_TTL_S);
        // Local-disk storage hands back a path on this server, which no provider can fetch.
        if (!/^https?:\/\//i.test(mediaUrl)) {
          throw new UnsupportedSendError(
            'The file is stored on this server, which the sender cannot reach. Ask the platform admin to turn on cloud storage.',
          );
        }
      } else {
        throw new UnsupportedSendError('This media schedule has no file.');
      }
    }

    if (kind === 'template') {
      if (row.template_id === null) {
        throw new UnsupportedSendError('The template of this schedule was deleted.');
      }
      const tpl = await this.templates.findById(tx, orgId, Number(row.template_id));
      if (!tpl) throw new UnsupportedSendError('The template of this schedule was deleted.');
      const cat = await tx.execute(sql`
        SELECT category, meta_category FROM wa_templates WHERE org_id = ${orgId} AND id = ${tpl.id}`);
      const c = cat.rows[0] as { category: string | null; meta_category: string | null };
      template = { ...tpl, category: effectiveCategory(c.meta_category, c.category) };
      if (engine === 'waba') {
        // Approval, a pause for poor feedback and the quality score can change between the day it was scheduled and the day it runs.
        const refusals = templateRefusals(
          {
            ...tpl,
            mediaUrl: tpl.attachmentFile ? this.templates.mediaUrl(tpl.attachmentFile) : null,
          },
          { wabaTemplatesV2: await this.templates.wabaTemplatesV2Enabled(tx) },
        );
        if (refusals.length) throw new UnsupportedSendError(refusals[0]!);
        if (tpl.pausedUntil && tpl.pausedUntil.getTime() > Date.now()) {
          throw new UnsupportedSendError('The template is paused for poor customer feedback.');
        }
        if ((tpl.metaStatus ?? '').toUpperCase() !== 'APPROVED' || !tpl.metaTemplateId) {
          throw new UnsupportedSendError(
            `The template is not approved by Meta (status: ${tpl.metaStatus ?? 'not submitted'}).`,
          );
        }
      } else if (tpl.templateType === 'auth') {
        throw new UnsupportedSendError(
          'Authentication (OTP) templates cannot be scheduled: each recipient needs a unique code.',
        );
      }
    }

    const needsMerge = kind === 'template' || body.includes('{{');
    return {
      kind,
      engine,
      body,
      mediaUrl,
      mediaMime,
      mediaName,
      latitude: kind === 'location' ? Number(row.latitude) : null,
      longitude: kind === 'location' ? Number(row.longitude) : null,
      template,
      overrides: kind === 'template' ? sanitizeOverrides(row.template_overrides) : null,
      mergeBase: needsMerge ? await this.merge.baseContext(tx, orgId) : null,
    };
  }

  /** The command for one recipient. `spin` varies the wording of free text on a warming number; it never touches a template. */
  command(
    p: PreparedMessage,
    to: string,
    contact: RecipientContact,
    spin: (text: string) => string = (s) => s,
    clientReference = 'sched',
  ): SendCommand {
    const ctx = p.mergeBase ? ({ ...p.mergeBase, contact } satisfies MergeContext) : null;
    const text = (s: string) =>
      spin(ctx && s.includes('{{') ? renderMergeTags(s, ctx).rendered : s);

    switch (p.kind) {
      case 'text':
        return { type: 'text', to, body: text(p.body) };
      case 'media':
      case 'media_with_caption': {
        const caption = p.kind === 'media_with_caption' ? text(p.body) : '';
        return {
          type: 'media',
          to,
          mediaUrl: p.mediaUrl!,
          ...(p.mediaMime ? { mimeType: p.mediaMime } : {}),
          ...(p.mediaName ? { fileName: p.mediaName } : {}),
          ...(caption ? { caption } : {}),
        };
      }
      case 'location':
        return {
          type: 'location',
          to,
          latitude: p.latitude!,
          longitude: p.longitude!,
          ...(p.body ? { name: text(p.body) } : {}),
        };
      case 'template':
        return p.engine === 'waba'
          ? this.metaTemplate(p, to, ctx!)
          : this.templateText(p, to, ctx!, clientReference);
      default:
        throw new UnsupportedSendError(`Scheduled ${p.kind} messages cannot be sent.`);
    }
  }

  private shape(t: TemplateRecord): TemplateShape & { headerLocation: unknown } {
    return {
      templateName: t.templateName,
      language: t.language,
      templateType: t.templateType,
      templateBody: t.templateBody,
      header: t.header,
      attachmentType: t.attachmentType,
      attachmentFile: t.attachmentFile,
      parameterFormat: t.parameterFormat,
      variableMap: t.variableMap,
      buttons: t.buttons,
      carouselData: t.carouselData,
      headerLocation: t.headerLocation,
    };
  }

  /** The Cloud API template for one recipient: variables from the contact, the overrides on top, Meta's rules applied. */
  private metaTemplate(p: PreparedMessage, to: string, ctx: MergeContext): SendCommand {
    const t = p.template!;
    const shape = this.shape(t);
    const vars = buildRecipientVars(shape, {
      pull: (key) => resolveToken(key, ctx).value,
      mediaUrl: (path) => this.templates.mediaUrl(path),
    });
    const applied = applyOverrides(vars, p.overrides, (s) => renderMergeTags(s, ctx).rendered);
    const send = buildSend(shape, applied.vars);
    return {
      type: 'template',
      to,
      templateName: send.name,
      language: t.language,
      category: t.category,
      components: send.components,
    };
  }

  /** The approved text for the engines that send plain text, with the template's variables filled for this recipient. */
  private templateText(
    p: PreparedMessage,
    to: string,
    ctx: MergeContext,
    clientReference: string,
  ): SendCommand {
    const t = p.template!;
    const shape = this.shape(t);
    const vars = buildRecipientVars(shape, {
      pull: (key) => resolveToken(key, ctx).value,
      mediaUrl: (path) => this.templates.mediaUrl(path),
    });
    const applied = applyOverrides(vars, p.overrides, (s) => renderMergeTags(s, ctx).rendered);
    const kind = (t.attachmentType ?? '').toLowerCase();
    const media =
      applied.vars.headerMediaUrl && (kind === 'image' || kind === 'video' || kind === 'document')
        ? { kind: kind as 'image' | 'video' | 'document', url: applied.vars.headerMediaUrl }
        : null;
    return commandForText({
      to,
      text: renderPlainBody(t.templateBody, applied.vars.body),
      header: applied.vars.header ?? (t.header && !media ? t.header : null),
      footer: applied.vars.footer?.length
        ? renderPlainBody(t.footer ?? '', applied.vars.footer)
        : t.footer,
      media,
      clientReference,
    });
  }
}
