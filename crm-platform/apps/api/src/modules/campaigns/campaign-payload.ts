import { wizardVariablesSchema, type WizardVariables } from '@crm/contracts';
import { buildSend, type TemplateShape } from '../../infra/providers/whatsapp/meta-send-payload';
import { renderMergeTags, resolveToken, type MergeContext } from '../crm';
import {
  LinkTracker,
  applyOverrides,
  buildRecipientVars,
  type TemplateDirectory,
  type TemplateOverrides,
  type TemplateRecord,
} from '../broadcasts';
import type { DatabaseService } from '../../infra/db/database.service';
import { applyWizardVariables, resolveMapping, templateSlots } from './wizard/wizard-rules';

export interface PayloadDeps {
  db: DatabaseService;
  templates: TemplateDirectory;
  tracker: LinkTracker;
}

/** The wizard's variable mapping stored on a campaign, or null for a campaign the classic builder made. */
export function wizardVariablesOf(
  wizard: { draft?: unknown } | null,
  variant: string | null = null,
): WizardVariables | null {
  if (!wizard?.draft || typeof wizard.draft !== 'object') return null;
  // Variant B of an A/B test has its own template, so its own mapping.
  const key = variant === 'B' ? 'variablesB' : 'variables';
  const parsed = wizardVariablesSchema.safeParse(
    (wizard.draft as Record<string, unknown>)[key] ?? {},
  );
  return parsed.success ? parsed.data : null;
}

/**
 * The Cloud API template object for ONE recipient (variables, send-time overrides, the wizard's mapping, tracked links), the one place
 * a campaign's template message is built: the run, a frequency-cap retry and a wizard test send all call it, so a retry or a test is
 * the same message a run would have sent. `values` is what each wizard placeholder resolved to (empty without a wizard mapping).
 */
export async function buildTemplatePayload(
  deps: PayloadDeps,
  o: {
    orgId: number;
    campaign: { id: number; trackingEnabled: boolean };
    wizardVariables: WizardVariables | null;
    tpl: TemplateRecord;
    overrides: TemplateOverrides | null;
    contactId: number;
    to: string;
    ctx: MergeContext;
    /** A test send never wraps links: its clicks must not count toward a campaign. */
    tracking?: boolean;
  },
): Promise<{ name: string; components: unknown[]; values: Record<string, string> }> {
  const { tpl } = o;
  const shape: TemplateShape & { headerLocation: unknown } = {
    templateName: tpl.templateName,
    language: tpl.language,
    templateType: tpl.templateType,
    templateBody: tpl.templateBody,
    header: tpl.header,
    attachmentType: tpl.attachmentType,
    attachmentFile: tpl.attachmentFile,
    parameterFormat: tpl.parameterFormat,
    variableMap: tpl.variableMap,
    buttons: tpl.buttons,
    carouselData: tpl.carouselData,
    headerLocation: tpl.headerLocation,
  };
  const vars = buildRecipientVars(shape, {
    pull: (key) => resolveToken(key, o.ctx).value,
    mediaUrl: (path) => deps.templates.mediaUrl(path),
  });
  const applied = applyOverrides(
    vars,
    o.overrides,
    (text) => renderMergeTags(text, o.ctx).rendered,
  );

  let withWizard = applied.vars;
  let values: Record<string, string> = {};
  if (o.wizardVariables) {
    const slots = templateSlots({
      templateBody: tpl.templateBody,
      header: tpl.header,
      variableMap: tpl.variableMap,
      buttons: tpl.buttons,
    });
    values = resolveMapping(slots, o.wizardVariables, o.ctx).values;
    withWizard = applyWizardVariables(withWizard, slots, values);
  }

  const tracked =
    (o.tracking ?? o.campaign.trackingEnabled)
      ? await deps.db.txAs({ orgId: o.orgId }, (t) =>
          deps.tracker.wrapVars(
            t,
            o.orgId,
            withWizard,
            { campaignId: o.campaign.id, contactId: o.contactId, templateId: tpl.id, phone: o.to },
            { buttons: shape.buttons, carouselData: shape.carouselData },
          ),
        )
      : withWizard;
  const send = buildSend(shape, tracked);
  return { name: send.name, components: send.components, values };
}
