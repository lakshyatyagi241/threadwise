import type { Source } from '../extract/source';
import { STEPS } from '../transform';
import { sql, type Database } from './db';

/**
 * Running some steps only (`run --steps a,b --skip-steps c`), so a feature can be loaded into staging, looked at, and a failing feature
 * does not block the others. The ORGANIZATION is always ensured first (it is idempotent and every step needs it); everything else is a
 * step named after its handler. The dependency table says what a step reads from rows another step wrote.
 *
 * Rules: an unknown name is refused before anything is written; a selected step whose prerequisite is neither selected, nor already
 * loaded for this client (a `migration.run_log` row of that step), nor absent from the dump, is refused naming the prerequisite.
 */
export const STEP_DEPS: Record<string, string[]> = {
  roles: [],
  users: ['roles'],
  field_sections: [],
  field_defs: ['field_sections'],
  field_options: ['field_defs'],
  field_deps: ['field_defs'],
  field_option_deps: ['field_options'],
  lifecycle: [],
  lifecycle_status: ['lifecycle'],
  tags: [],
  groups: [],
  field_undeclared: ['field_defs'],
  contacts: ['field_defs', 'field_undeclared', 'lifecycle', 'lifecycle_status', 'users'],
  group_members: ['contacts', 'groups'],
  notes: ['contacts'],
  contact_files: ['contacts', 'users'],
  campaigns: ['contacts', 'templates'], // templates first: a campaign is linked to its wa_templates row when it is written
  recipients: ['campaigns', 'contacts'],
  flow_bots: [],
  flow_headers: ['flow_bots'],
  flow_versions: ['flow_bots'],
  flow_nodes: ['flow_bots'],
  flow_workspace: ['flow_bots'],
  faq_replies: ['flow_bots'],
  faq_knowledge: ['flow_bots'],
  widget_assistants: [],
  widgets: ['widget_assistants'],
  flow_chatbots: ['flow_bots', 'widgets'],
  widget_config: ['widgets'],
  widget_theme: ['widgets'],
  automation_flows: ['groups'],
  automation_nodes: ['automation_flows'],
  credit_wallet: [],
  credit_tokens: [],
  usage_charges: [],
  lead_sources: [],
  lead_events: ['contacts', 'lead_sources'],
  lead_events_leads: ['contacts', 'lead_sources'],
  attributions: ['contacts'],
  inbox: ['contacts'],
  templates: ['users'],
  knowledge_sources: [],
  segments: ['field_defs', 'users'],
  saved_views: ['field_defs', 'users'],
  wa_forms: [],
  api_library: [],
  outbound_webhooks: [],
  chat_labels: ['tags', 'inbox'],
};

/** Names that stand for several steps. */
export const STEP_GROUPS: Record<string, string[]> = {
  access: ['roles', 'users'],
  fields: [
    'field_sections',
    'field_defs',
    'field_options',
    'field_deps',
    'field_option_deps',
    'field_undeclared',
    'lifecycle',
    'lifecycle_status',
    'tags',
    'groups',
  ],
  broadcasts: ['templates', 'campaigns', 'recipients'],
  credits: ['credit_wallet', 'credit_tokens', 'usage_charges'],
  flows: [
    'flow_bots',
    'flow_headers',
    'flow_versions',
    'flow_nodes',
    'flow_workspace',
    'faq_replies',
    'faq_knowledge',
    'widget_assistants',
    'widgets',
    'flow_chatbots',
    'widget_config',
    'widget_theme',
  ],
  leads: ['lead_sources', 'lead_events', 'lead_events_leads', 'attributions'],
  automations: ['automation_flows', 'automation_nodes'],
  chat: ['inbox'],
  knowledge: ['knowledge_sources'],
  faq: ['faq_knowledge'],
  views: ['segments', 'saved_views'],
  forms: ['wa_forms'],
  integrations: ['api_library', 'outbound_webhooks'],
  labels: ['chat_labels'],
};

export class StepsError extends Error {
  constructor(message: string) {
    super(`STEPS: ${message}`);
  }
}

const ALL = (): string[] => STEPS.map((s) => s.handler);

/** `a,b,fields` -> handler names (the word `org` is accepted and means "only make sure the organization exists"). */
export function expandSteps(names: string[] | undefined, what: string): string[] | null {
  if (!names) return null;
  const known = new Set(ALL());
  const out: string[] = [];
  for (const raw of names) {
    const n = raw.trim();
    if (n === '' || n === 'org') continue;
    const group = STEP_GROUPS[n];
    if (group) out.push(...group.filter((g) => known.has(g)));
    else if (known.has(n)) out.push(n);
    else
      throw new StepsError(
        `unknown step "${n}" in ${what}; run \`steps\` for the list (groups: ${Object.keys(STEP_GROUPS).join(', ')})`,
      );
  }
  return out;
}

export interface Selection {
  /** handlers to run, in load order */
  selected: string[];
  /** true when no --steps / --skip-steps was given */
  all: boolean;
}

export function selectSteps(steps?: string[], skip?: string[]): Selection {
  const only = expandSteps(steps, '--steps');
  const skipped = new Set(expandSteps(skip, '--skip-steps') ?? []);
  const base = only ? new Set(only) : new Set(ALL());
  return {
    selected: ALL().filter((h) => base.has(h) && !skipped.has(h)),
    all: !steps && !skip,
  };
}

/** Steps of this client that already have a run_log row. */
export async function stepsLoaded(db: Database, client: string): Promise<Set<string>> {
  const r = await db.execute(
    sql`SELECT DISTINCT step FROM migration.run_log WHERE source_client = ${client}`,
  );
  return new Set((r.rows as Array<{ step: string }>).map((x) => x.step));
}

/** The prerequisites of the selected steps that nothing satisfies; empty = fine. */
export function missingPrerequisites(a: {
  selected: string[];
  loaded: Set<string>;
  source: Source;
  client: string;
}): string[] {
  const chosen = new Set(a.selected);
  const have = new Set(a.source.collections(a.client));
  const absent = (h: string): boolean => {
    const spec = STEPS.find((s) => s.handler === h);
    return Boolean(spec && !have.has(spec.collection));
  };
  const out: string[] = [];
  for (const step of a.selected)
    for (const dep of STEP_DEPS[step] ?? [])
      if (!chosen.has(dep) && !a.loaded.has(dep) && !absent(dep))
        out.push(`${step} needs ${dep} (not selected, not loaded for this client)`);
  return out;
}

export const STEP_SELECTION = '_steps';

/** Remembers what the last run selected, so reconcile can tell "never run" from "run and wrong". */
export async function recordSelection(
  db: Database,
  client: string,
  runId: string,
  sel: Selection,
): Promise<void> {
  await db.execute(sql`
    INSERT INTO migration.run_log (source_client, collection, step, run_id, last_key, state, counts)
    VALUES (${client}, ${STEP_SELECTION}, 'selection', ${runId}, 0, 'done', ${JSON.stringify({ selected: sel.selected, all: sel.all })}::jsonb)
    ON CONFLICT (source_client, collection, step) DO UPDATE SET run_id = EXCLUDED.run_id, counts = EXCLUDED.counts, updated_at = now()`);
}

/** Steps that have never run for this client; null = the client was loaded before partial runs existed (everything counts as run). */
export async function stepsNotRun(db: Database, client: string): Promise<Set<string> | null> {
  const r = await db.execute(
    sql`SELECT 1 AS x FROM migration.run_log WHERE source_client = ${client} AND collection = ${STEP_SELECTION} AND step = 'selection'`,
  );
  if (r.rows.length === 0) return null;
  const loaded = await stepsLoaded(db, client);
  return new Set(ALL().filter((h) => !loaded.has(h)));
}

const REASON: Record<string, string> = {
  roles: 'Waboo roles -> custom roles',
  users: 'Waboo users (no password), role through role-map',
  field_sections: 'contact property sections',
  field_defs: 'contact property definitions',
  field_options: 'option lists',
  field_deps: 'field dependencies',
  field_option_deps: 'option dependencies',
  lifecycle: 'lifecycle stages',
  lifecycle_status: 'lifecycle statuses',
  tags: 'tag dictionary',
  groups: 'contact lists',
  field_undeclared: 'fields for undeclared contact keys',
  contacts: 'contacts (owner resolved through users)',
  group_members: 'list membership',
  notes: 'contact notes',
  contact_files: 'files attached to a contact (storage_key = Waboo address until copy-files)',
  campaigns: 'broadcast campaigns',
  recipients: 'broadcast recipient logs',
  flow_bots: 'one chatbot flow per bot (inactive, unpublished)',
  flow_headers: 'journey headers (adopted into the flow)',
  flow_versions: 'version headers (adopted / OLDER_VERSION)',
  flow_nodes: 'steps of the latest version (adopted / excluded)',
  flow_workspace: 'draft copy, Intent / FAQ records',
  faq_replies: 'FAQ phrases -> inactive keyword replies',
  faq_knowledge: 'FAQ feature: paused FAQs + pending variations + disabled per-flow settings',
  widget_assistants: 'paused AI assistants of the widgets',
  widgets: 'paused chatbot widgets',
  flow_chatbots: 'bot documents (adopted into flow / widget)',
  widget_config: 'widget configuration documents',
  widget_theme: 'widget theme documents',
  automation_flows: 'advanced automations -> one inactive, unpublished flow each (needs the lists)',
  automation_nodes: 'runtime node rows of the automations (adopted into the flow / excluded)',
  credit_wallet: 'wallet ledger (needs credit-opening.json) and the wallet row',
  credit_tokens: 'AI token counters',
  usage_charges: 'billing log as inert usage charges',
  lead_sources: 'inert import sources (paused connectors) of leadrepo / leads',
  lead_events: 'leadrepo -> lead_events (finished history, no ingest)',
  lead_events_leads: 'leads -> lead_events (sessions already in leadrepo are excluded)',
  attributions: 'first-touch attribution -> contact_attributions',
  inbox: 'chat history (needs the channel map)',
  wa_forms: 'WhatsApp Flows -> draft forms (raw definition kept)',
  api_library: 'saved API definitions (secrets blanked)',
  outbound_webhooks: 'outbound webhooks (quarantined: need the app crypto)',
  chat_labels: 'conversation labels (quarantined: link unverified)',
  knowledge_sources: 'AI knowledge base url entries (failed / not fetched; kb-reingest reads them)',
};

export function formatSteps(): string {
  const lines = [
    'step                 needs                                                  loads',
    'org                  (always first; the organization and its owner)         organizations, presets',
  ];
  for (const h of ALL())
    lines.push(
      `${h.padEnd(20)} ${(STEP_DEPS[h] ?? []).join(', ').padEnd(54) || ''.padEnd(54)} ${REASON[h] ?? ''}`,
    );
  lines.push(
    '',
    `groups: ${Object.entries(STEP_GROUPS)
      .map(([g, m]) => `${g} = ${m.join('+')}`)
      .join('; ')}`,
  );
  return lines.join('\n');
}
