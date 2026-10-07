import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  wizardDraftSchema,
  type SaveWizardDraftInput,
  type UpdateWizardDraftInput,
  type WizardAudience,
  type WizardDraft,
  type WizardDraftResponse,
  type CampaignStatus,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import {
  SENDER_DIRECTORY,
  TEMPLATE_DIRECTORY,
  type SenderDirectory,
  type TemplateDirectory,
} from '../../broadcasts';
import { CAMPAIGN_PLAN_GATE, type CampaignPlanGate } from '../_shims/tokens';
import { MODULE_KEY } from '../campaign-events';
import { CampaignsRepository } from '../campaigns.repository';
import { blankCampaignFor } from './wizard-blank';
import { WizardCsvService } from './wizard-csv.service';
import { WizardRepository, type WizardCampaignRow } from './wizard.repository';

const UNTITLED = 'Untitled broadcast';

const field = (path: string, message: string) =>
  AppError.validation('Request payload failed validation', [{ path, message }]);

/** The draft of a stored campaign, tolerant of a row written by an older shape. */
export function draftOf(row: Pick<WizardCampaignRow, 'wizard'>): WizardDraft {
  const parsed = wizardDraftSchema.safeParse(row.wizard?.draft ?? {});
  return parsed.success ? parsed.data : wizardDraftSchema.parse({});
}

export const draftResponse = (row: WizardCampaignRow): WizardDraftResponse => ({
  id: row.uuid,
  status: row.status as CampaignStatus,
  draft: draftOf(row),
  rowVersion: row.rowVersion,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

/**
 * The wizard's draft: one campaign row in status `draft` with `wizard.draft` holding what the person has filled in so far. Saved on
 * every step so they can leave and come back (a draft is listed with the campaigns, and opens in the wizard). It is lenient on
 * purpose, a half-filled draft is a normal thing to save; the strict checks run at launch.
 */
@Injectable()
export class WizardDraftsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: WizardRepository,
    private readonly csv: WizardCsvService,
    private readonly campaigns: CampaignsRepository,
    private readonly audit: AuditService,
    @Inject(SENDER_DIRECTORY) private readonly senders: SenderDirectory,
    @Inject(TEMPLATE_DIRECTORY) private readonly templates: TemplateDirectory,
    @Inject(CAMPAIGN_PLAN_GATE) private readonly plan: CampaignPlanGate,
  ) {}

  async create(input: SaveWizardDraftInput): Promise<WizardDraftResponse> {
    const ctx = RequestContextStore.require();
    const orgId = ctx.orgId;
    await this.plan.assertEnabled(orgId);
    await this.plan.assertWithinCap(
      orgId,
      await this.db.tx((tx) => this.campaigns.count(tx, orgId)),
    );
    const draft = wizardDraftSchema.parse(input);

    const row = await this.db.tx(async (tx) => {
      const templateId = await this.checked(tx, orgId, draft);
      const provider = await this.senders.defaultEngine(tx, orgId);
      const id = await this.campaigns.insert(
        tx,
        orgId,
        blankCampaignFor({
          name: draft.name.trim() || UNTITLED,
          provider,
          deviceId: null,
          templateId,
          createdBy: ctx.userId,
        }),
      );
      await this.repo.attach(tx, orgId, id, { wizard: { draft } });
      await this.audit.record(tx, { module: MODULE_KEY, recordId: id, action: 'insert' });
      const fresh = await this.repo.campaignById(tx, orgId, id);
      if (!fresh) throw AppError.notFound('Broadcast draft');
      return fresh;
    });
    return draftResponse(row);
  }

  async get(uuid: string): Promise<WizardDraftResponse> {
    const { orgId } = RequestContextStore.require();
    const row = await this.db.tx((tx) => this.repo.campaignByUuid(tx, orgId, uuid));
    if (!row) throw AppError.notFound('Broadcast draft', uuid);
    return draftResponse(row);
  }

  async update(uuid: string, input: UpdateWizardDraftInput): Promise<WizardDraftResponse> {
    const { orgId } = RequestContextStore.require();
    const { rowVersion, ...patch } = input;
    const row = await this.db.tx(async (tx) => {
      const locked = await this.repo.lockCampaign(tx, orgId, uuid);
      if (!locked) throw AppError.notFound('Broadcast draft', uuid);
      if (locked.status !== 'draft') {
        throw new AppError(
          ERROR_CODES.CAMP_WIZARD_LAUNCHED,
          'This broadcast was already launched, so its draft can no longer be edited.',
          HttpStatus.CONFLICT,
        );
      }
      if (locked.rowVersion !== rowVersion) throw AppError.rowVersionConflict('Broadcast draft');

      const draft = wizardDraftSchema.parse({ ...draftOf(locked), ...patch });
      const templateId = await this.checked(tx, orgId, draft);
      await this.repo.saveDraft(tx, orgId, locked.id, {
        wizard: { ...locked.wizard, draft },
        name: draft.name.trim() || UNTITLED,
        templateId,
      });
      await this.audit.record(tx, { module: MODULE_KEY, recordId: locked.id, action: 'update' });
      const fresh = await this.repo.campaignById(tx, orgId, locked.id);
      if (!fresh) throw AppError.notFound('Broadcast draft', uuid);
      return fresh;
    });
    return draftResponse(row);
  }

  /** The draft's references must belong to this organization (a forged id is refused, never stored). Returns the template's id. */
  private async checked(tx: Tx, orgId: number, draft: WizardDraft): Promise<number | null> {
    let templateId: number | null = null;
    if (draft.templateId) {
      const t = await this.templates.find(tx, orgId, draft.templateId);
      if (!t) throw field('templateId', 'Template not found in this workspace.');
      templateId = t.id;
    }
    if (draft.senderKey) {
      const [picked] = await this.senders.resolve(tx, orgId, [draft.senderKey]);
      if (!picked) throw field('senderKey', 'That number is not connected.');
    }
    await this.assertSources(tx, orgId, draft.audience);
    return templateId;
  }

  /** Launch only (a draft keeps a reference to an upload that may have expired in the meantime, and still saves). */
  async assertCsv(tx: Tx, orgId: number, audience: WizardAudience): Promise<void> {
    if (audience.csv && !(await this.csv.find(tx, orgId, audience.csv.id))) {
      throw field(
        'audience.csv',
        'The uploaded CSV is not in this workspace (or has expired). Upload it again.',
      );
    }
  }

  async assertSources(tx: Tx, orgId: number, audience: WizardAudience): Promise<void> {
    if (audience.groupIds.length === 0 && audience.segmentIds.length === 0) return;
    const found = await this.repo.existing(tx, orgId, audience.groupIds, audience.segmentIds);
    audience.groupIds.forEach((id, i) => {
      if (!found.groups.has(id))
        throw field(`audience.groupIds.${i}`, 'Group not found in this workspace.');
    });
    audience.segmentIds.forEach((id, i) => {
      if (!found.segments.has(id))
        throw field(`audience.segmentIds.${i}`, 'Segment not found in this workspace.');
    });
  }
}
