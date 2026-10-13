import type { Handler } from '../registry';
import { contacts, groupMembers } from './contacts';
import {
  fieldDefs,
  fieldDeps,
  fieldOptionDeps,
  fieldOptions,
  fieldSections,
  fieldUndeclared,
} from './fields';
import { automationFlows, automationNodes } from './automation';
import { campaigns, recipients } from './broadcast';
import { contactFiles } from './contactfiles';
import { creditTokens, creditWallet, usageCharges } from './credits';
import {
  faqReplies,
  flowBots,
  flowChatbots,
  flowHeaders,
  flowNodes,
  flowVersions,
  flowWorkspace,
  widgetAssistants,
  widgetConfig,
  widgetTheme,
  widgets,
} from './flows';
import { faqKnowledge } from './faq';
import { inbox } from './inbox';
import { knowledgeSources } from './knowledge';
import { attributions, leadEvents, leadEventsLeads, leadSources } from './leads';
import { groups, lifecycleStages, lifecycleStatuses, notes, tags } from './misc';
import { roles } from './roles';
import { savedViews, segments } from './segments';
import { apiLibrary, chatLabels, outboundWebhooks, waForms } from './portables';
import { templates } from './templates';
import { users } from './users';
import { badText } from '../util';
import type { Doc } from '../util';
import type { Ctx, HandlerSpec, Outcome } from './types';

/** Bulk-loaded steps in load order. The organization itself is created first by load/org.ts. */
export const STEPS: HandlerSpec[] = [
  roles, // roles and users BEFORE contacts: contacts.owner_id resolves through id_map, so no UPDATE (touch_row would reset updated_at)
  users,
  fieldSections,
  fieldDefs,
  fieldOptions,
  fieldDeps,
  fieldOptionDeps,
  lifecycleStages,
  lifecycleStatuses,
  tags,
  groups,
  fieldUndeclared, // needs only the field rows; placed before contacts so every data key has its fields row first
  contacts,
  groupMembers,
  notes,
  contactFiles, // files attached to a contact: the Waboo address until pilot/files/copy-files.cjs copies the bytes
  templates, // WhatsApp templates as they are at Meta (before campaigns, which will point at them)
  campaigns, // broadcasts: campaigns carry their final counters (pass 1), recipients point at the campaign row, so campaigns come first
  recipients,
  flowBots, // flows: one derived document per bot; imported flows are never published or active
  flowHeaders, // the source documents of a bot / its versions / its steps are adopted into the flow row (or excluded with a reason)
  flowVersions,
  flowNodes,
  flowWorkspace,
  faqReplies, // needs the flow ids
  faqKnowledge, // the FAQ feature (faqs, variations, settings): derived from the Intent / FAQ records and faq_variations; needs the flow ids
  widgetAssistants, // the assistant row first: the widget row points at it
  widgets,
  flowChatbots, // after the widgets: a website bot's document is adopted into its widget
  widgetConfig,
  widgetTheme,
  automationFlows, // advanced automations: one inactive, unpublished flow per automation_metadata document (needs the groups: lists resolve through id_map)
  automationNodes, // the runtime copy of the nodes: adopted into that flow
  creditWallet, // credits: wallet rows carry a balance_after computed in pass 1 (credits/plan.ts); the token counters and the billing log need no other step
  creditTokens,
  usageCharges,
  leadSources, // lead data: the inert import sources first, then the events that point at them, then the first-touch attributions
  leadEvents,
  leadEventsLeads,
  attributions,
  segments, // filters over the fields and owners above; a filter that cannot be converted exactly is quarantined, never guessed
  savedViews,
  knowledgeSources, // AI knowledge base: url entries as failed / not fetched (kb-reingest reads them later); no outbox event
  waForms, // Meta WhatsApp Flows as draft forms (never published, no provider)
  apiLibrary, // saved API definitions (secret headers and query values blanked)
  outboundWebhooks, // quarantine-only: the URL and secret need the app crypto
  chatLabels, // quarantine-only until the label -> conversation link can be resolved
  inbox, // last: it needs contacts (contact_id), users (agents) and the org; builds its own channels, partitions and plan
];

export const stepFor = (handler: Handler | HandlerSpec['handler']): HandlerSpec | undefined =>
  STEPS.find((s) => s.handler === handler);

/**
 * The ONE entry point that turns a source document into an outcome, for the loader and the verifier alike: documents PostgreSQL
 * cannot store (a NUL character) are quarantined here, before any handler sees them.
 */
export function transformDoc(spec: HandlerSpec, doc: Doc, ctx: Ctx): Outcome {
  const bad = badText(doc);
  if (bad) {
    return {
      kind: 'quarantine',
      code: bad,
      reason:
        bad === 'NUL_CHAR'
          ? 'a string contains a NUL character, which PostgreSQL cannot store'
          : 'a string contains a lone UTF-16 surrogate, which PostgreSQL cannot store',
    };
  }
  return spec.transform(doc, ctx);
}
