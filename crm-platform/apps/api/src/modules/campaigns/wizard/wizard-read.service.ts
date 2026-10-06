import { Inject, Injectable } from '@nestjs/common';
import {
  WIZARD_TEMPLATE_CATEGORIES,
  type WizardAudience,
  type WizardAudienceCount,
  type WizardAudienceSources,
  type WizardTemplate,
  type WizardTemplatesResponse,
} from '@crm/contracts';
import { RequestContextStore } from '../../../common/context/request-context';
import { DatabaseService } from '../../../infra/db/database.service';
import { TEMPLATE_DIRECTORY, templateRefusals, type TemplateDirectory } from '../../broadcasts';
import { WizardAudienceService } from './wizard-audience.service';
import { templateSlots } from './wizard-rules';
import { WizardRepository, type TemplateListRow } from './wizard.repository';

const CATEGORIES = new Set<string>(WIZARD_TEMPLATE_CATEGORIES);

/** Meta's category, else the local one when it is a WhatsApp category (a business vertical is not one), else utility. */
export function templateCategory(
  meta: string | null,
  local: string | null,
): WizardTemplate['category'] {
  const m = (meta ?? '').trim().toLowerCase();
  if (CATEGORIES.has(m)) return m as WizardTemplate['category'];
  const l = (local ?? '').trim().toLowerCase();
  return (CATEGORIES.has(l) ? l : 'utility') as WizardTemplate['category'];
}

/** What step 1 and step 2 list: the approved templates with their placeholders, and the groups and segments with member counts. */
@Injectable()
export class WizardReadService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: WizardRepository,
    private readonly audience: WizardAudienceService,
    @Inject(TEMPLATE_DIRECTORY) private readonly templates: TemplateDirectory,
  ) {}

  toTemplate(r: TemplateListRow): WizardTemplate {
    return {
      id: r.uuid,
      name: r.name,
      language: r.language,
      category: templateCategory(r.metaCategory, r.category),
      header: r.header,
      body: r.body,
      footer: r.footer,
      buttons: Array.isArray(r.buttons) ? (r.buttons as Array<Record<string, unknown>>) : [],
      attachmentType: r.attachmentType,
      attachmentUrl: r.attachmentFile ? this.templates.mediaUrl(r.attachmentFile) : null,
      senderLabel: r.senderLabel,
      slots: templateSlots({
        templateBody: r.body,
        header: r.header,
        variableMap: r.variableMap,
        buttons: r.buttons,
      }),
    };
  }

  /** Only templates a broadcast may use right now: approved, with no refusal the campaign gate would raise. */
  async listTemplates(): Promise<WizardTemplatesResponse> {
    const { orgId } = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const v2 = await this.templates.wabaTemplatesV2Enabled(tx);
      const rows = await this.repo.approvedTemplates(tx, orgId);
      const usable = rows.filter(
        (r) =>
          templateRefusals(
            {
              templateType: r.templateType,
              attachmentType: r.attachmentType,
              mediaUrl: r.attachmentFile ? this.templates.mediaUrl(r.attachmentFile) : null,
              metaTemplateId: r.metaTemplateId,
              metaStatus: r.metaStatus,
              pausedUntil: r.pausedUntil,
              qualityScore: r.qualityScore,
            },
            { wabaTemplatesV2: v2 },
          ).length === 0,
      );
      return { data: usable.map((r) => this.toTemplate(r)) };
    });
  }

  async audienceSources(): Promise<WizardAudienceSources> {
    const { orgId, userId } = RequestContextStore.require();
    return this.db.tx(async (tx) => ({
      groups: await this.repo.groups(tx, orgId),
      segments: await this.repo.segments(tx, orgId, userId),
    }));
  }

  /** The audience's size by the rules the launch applies. */
  countAudience(audience: WizardAudience): Promise<WizardAudienceCount> {
    const { orgId } = RequestContextStore.require();
    return this.db.tx((tx) => this.audience.count(tx, orgId, audience));
  }
}
