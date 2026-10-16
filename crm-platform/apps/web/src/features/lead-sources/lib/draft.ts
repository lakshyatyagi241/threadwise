import {
  LEAD_RAW_RETENTION_DEFAULT_DAYS,
  LEAD_RAW_RETENTION_MAX_DAYS,
  SPEED_TO_LEAD_MAX_DELAY_MINUTES,
  SPEED_TO_LEAD_OFF,
  createLeadSourceSchema,
  leadFieldMappingSchema,
  leadSourceDefaultsSchema,
  updateLeadSourceSchema,
  type CreateLeadSourceInput,
  type LeadFieldMapping,
  type LeadOwnerMode,
  type LeadSourceDefaults,
  type LeadSourceResponse,
  type PreviewLeadMappingInput,
  type SpeedToLeadChannel,
  type UpdateLeadSourceInput,
} from '@crm/contracts';

/**
 * The form state for creating or changing a source, and the pure functions that turn it into the requests the contract accepts.
 * Nothing here reads the DOM, so it is tested directly. The contract's own zod schemas have the last word (`contractIssues`); the
 * checks above them exist to say it in the person's words and to point at one input.
 */

export const WIZARD_STEPS = ['basics', 'rules', 'connect', 'mapping'] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

/** The steps a person fills in before the source exists; `connect` and `mapping` come after the create call. */
export const FORM_STEPS = ['basics', 'rules'] as const;

export const NAME_MAX = 120;
export const PLATFORM_MAX = 60;
export const PATH_MAX = 200;
export const SECRET_MIN = 12;
export const SECRET_MAX = 200;
export const DEAL_TITLE_MAX = 160;
export const MAX_CUSTOM_FIELDS = 40;
export const MAX_OWNER_USERS = 50;
export const MAX_NOTIFY_USERS = 20;
export const DEFAULT_TAG = 'Lead';
/** The title the API itself applies; built here so no message file has to carry the literal braces. */
export const DEFAULT_DEAL_TITLE = '{{name}} ({{source}})';
/** The placeholders a deal title may use. */
export const DEAL_TITLE_TOKENS = ['name', 'source', 'campaign'].map((v) => `{{${v}}}`);
export const PROPERTY_KEY = /^[a-z][a-z0-9_]{0,63}$/;

/** The property types a lead can write into (a formula or a lookup never). Mirrors the API's own list. */
export const MAPPABLE_FIELD_TYPES: ReadonlySet<string> = new Set([
  'text',
  'long_text',
  'integer',
  'big_integer',
  'decimal',
  'percentage',
  'currency',
  'boolean',
  'checkbox',
  'radio',
  'date',
  'datetime',
  'url',
  'email',
  'phone',
  'select',
  'multiselect',
  'rating',
  'timezone',
]);

/** A write-only secret as the person edits it: `keep` leaves the stored one, `set` replaces it, `clear` removes it. */
export interface SecretEdit {
  mode: 'keep' | 'set' | 'clear';
  value: string;
}
export const keepSecret = (): SecretEdit => ({ mode: 'keep', value: '' });

export interface CustomFieldRow {
  id: string;
  key: string;
  path: string;
}

export const MAPPING_FIELDS = ['name', 'firstName', 'lastName', 'email', 'phone'] as const;
export type MappingField = (typeof MAPPING_FIELDS)[number];
export const ATTRIBUTION_FIELDS = ['platform', 'campaign', 'adset', 'ad', 'form'] as const;
export type AttributionField = (typeof ATTRIBUTION_FIELDS)[number];

export interface MappingDraft {
  fields: Record<MappingField, string>;
  customFields: CustomFieldRow[];
  attribution: Record<AttributionField, string>;
}

/** The first-message setting as the person edits it (BL-014). The delay is text while typed; empty ids mean "none chosen". */
export interface SpeedDraft {
  enabled: boolean;
  channel: SpeedToLeadChannel;
  templateId: string;
  /** SMS and email only; empty = the workspace's first connected sender. */
  senderId: string;
  delay: string;
  businessHoursOnly: boolean;
}

export const emptySpeed = (): SpeedDraft => ({
  enabled: false,
  channel: 'whatsapp',
  templateId: '',
  senderId: '',
  delay: '0',
  businessHoursOnly: false,
});

export interface SourceDraft {
  name: string;
  /** `defaults.platform`: what `contacts.source` and the attribution say. */
  platform: string;
  secret: SecretEdit;
  externalIdPath: string;
  retentionDays: string;
  countryCode: string;
  /** The `value` of a contact lifecycle stage; empty = the workspace default. */
  lifecycleStage: string;
  /** Empty = no tag. */
  tag: string;
  ownerMode: LeadOwnerMode;
  ownerUserIds: string[];
  dealEnabled: boolean;
  /** Empty = the workspace's default pipeline. */
  pipelineId: string;
  /** Empty = the pipeline's first stage. */
  stageId: string;
  dealTitle: string;
  notifyOwner: boolean;
  notifyUserIds: string[];
  speed: SpeedDraft;
  mapping: MappingDraft;
}

let rowCounter = 0;
/** A fresh id for a custom-field row added by the person (loaded rows are numbered by position, so a server render is stable). */
export const newRowId = (): string => `n${++rowCounter}`;
export const newRow = (key = '', path = ''): CustomFieldRow => ({ id: newRowId(), key, path });

const blankFields = (): Record<MappingField, string> => ({
  name: '',
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
});
const blankAttribution = (): Record<AttributionField, string> => ({
  platform: '',
  campaign: '',
  adset: '',
  ad: '',
  form: '',
});

export function emptyDraft(): SourceDraft {
  return {
    name: '',
    platform: '',
    secret: keepSecret(),
    externalIdPath: '',
    retentionDays: String(LEAD_RAW_RETENTION_DEFAULT_DAYS),
    countryCode: '',
    lifecycleStage: '',
    tag: DEFAULT_TAG,
    ownerMode: 'unassigned',
    ownerUserIds: [],
    dealEnabled: false,
    pipelineId: '',
    stageId: '',
    dealTitle: DEFAULT_DEAL_TITLE,
    notifyOwner: true,
    notifyUserIds: [],
    speed: emptySpeed(),
    mapping: { fields: blankFields(), customFields: [], attribution: blankAttribution() },
  };
}

function speedFromDefaults(v: NonNullable<LeadSourceDefaults['speedToLead']>): SpeedDraft {
  return {
    enabled: v.enabled,
    channel: v.channel,
    templateId: v.templateId ?? '',
    senderId: v.senderId ?? '',
    delay: String(v.delayMinutes),
    businessHoursOnly: v.businessHoursOnly,
  };
}

export function draftFromSource(s: LeadSourceResponse): SourceDraft {
  const d = s.defaults;
  const m = s.mapping;
  return {
    name: s.name,
    platform: d.platform ?? '',
    secret: keepSecret(),
    externalIdPath: s.externalIdPath ?? '',
    retentionDays: String(s.rawRetentionDays),
    countryCode: d.countryCode ?? '',
    lifecycleStage: d.lifecycleStage ?? '',
    // A source stored without a tag key gets the API's default tag; an explicit null means none.
    tag: d.tag === undefined ? DEFAULT_TAG : (d.tag ?? ''),
    ownerMode: d.owner.mode,
    ownerUserIds: [...d.owner.userIds],
    dealEnabled: d.deal.enabled,
    pipelineId: d.deal.pipelineId ?? '',
    stageId: d.deal.stageId ?? '',
    dealTitle: d.deal.title,
    notifyOwner: d.notify.owner,
    notifyUserIds: [...d.notify.userIds],
    speed: speedFromDefaults(d.speedToLead ?? SPEED_TO_LEAD_OFF),
    mapping: {
      fields: {
        name: m.name ?? '',
        firstName: m.firstName ?? '',
        lastName: m.lastName ?? '',
        email: m.email ?? '',
        phone: m.phone ?? '',
      },
      customFields: Object.entries(m.customFields ?? {}).map(([key, path], i) => ({
        id: `r${i}`,
        key,
        path,
      })),
      attribution: {
        platform: m.attribution?.platform ?? '',
        campaign: m.attribution?.campaign ?? '',
        adset: m.attribution?.adset ?? '',
        ad: m.attribution?.ad ?? '',
        form: m.attribution?.form ?? '',
      },
    },
  };
}

// --- normalising ----------------------------------------------------------------------------------------------------------------

/** "+91", "0091", " 91 " and "(91)" all mean the dial code 91; what is left is digits only. */
export function normaliseCountryCode(raw: string): string {
  const stripped = raw.replace(/[\s\-().]/g, '');
  const noPrefix = stripped.startsWith('+')
    ? stripped.slice(1)
    : stripped.startsWith('00')
      ? stripped.slice(2)
      : stripped;
  return noPrefix;
}

const blank = (v: string): boolean => v.trim() === '';
const orNull = (v: string): string | null => (blank(v) ? null : v.trim());

// --- draft -> request ---------------------------------------------------------------------------------------------------------

export function buildMapping(m: MappingDraft): LeadFieldMapping {
  const out: LeadFieldMapping = {};
  for (const f of MAPPING_FIELDS) if (!blank(m.fields[f])) out[f] = m.fields[f].trim();
  const custom: Record<string, string> = {};
  for (const r of m.customFields) {
    if (!blank(r.key) && !blank(r.path)) custom[r.key.trim()] = r.path.trim();
  }
  if (Object.keys(custom).length > 0) out.customFields = custom;
  const attribution: NonNullable<LeadFieldMapping['attribution']> = {};
  for (const f of ATTRIBUTION_FIELDS)
    if (!blank(m.attribution[f])) attribution[f] = m.attribution[f].trim();
  if (Object.keys(attribution).length > 0) out.attribution = attribution;
  return out;
}

export function buildDefaults(d: SourceDraft): LeadSourceDefaults {
  const pipelineId = blank(d.pipelineId) ? null : d.pipelineId;
  const normalised = normaliseCountryCode(d.countryCode);
  return {
    countryCode: normalised === '' ? null : normalised,
    platform: orNull(d.platform),
    lifecycleStage: orNull(d.lifecycleStage),
    tag: orNull(d.tag),
    owner: { mode: d.ownerMode, userIds: d.ownerMode === 'unassigned' ? [] : [...d.ownerUserIds] },
    deal: {
      enabled: d.dealEnabled,
      pipelineId,
      // A stage belongs to a pipeline: without one the API refuses it, so it is not sent.
      stageId: pipelineId && !blank(d.stageId) ? d.stageId : null,
      title: blank(d.dealTitle) ? DEFAULT_DEAL_TITLE : d.dealTitle.trim(),
    },
    notify: { owner: d.notifyOwner, userIds: [...d.notifyUserIds] },
    speedToLead: buildSpeed(d.speed),
  };
}

/** The delay as a whole number of minutes, or null when it is not one (the form says so before anything is sent). */
export function speedDelay(raw: string): number | null {
  const text = raw.trim();
  // Digits only: Number() would also read "1e1" as ten and " 0x10 " as sixteen.
  if (!/^\d{1,3}$/.test(text)) return null;
  const n = Number(text);
  return n <= SPEED_TO_LEAD_MAX_DELAY_MINUTES ? n : null;
}

export function buildSpeed(v: SpeedDraft): NonNullable<LeadSourceDefaults['speedToLead']> {
  return {
    enabled: v.enabled,
    channel: v.channel,
    templateId: orNull(v.templateId),
    // WhatsApp is sent by the template's own number; a sender chosen for another channel is not carried along.
    senderId: v.channel === 'whatsapp' ? null : orNull(v.senderId),
    delayMinutes: speedDelay(v.delay) ?? 0,
    businessHoursOnly: v.businessHoursOnly,
  };
}

const retention = (d: SourceDraft): number => Number(d.retentionDays.trim());

export function buildCreateBody(d: SourceDraft): CreateLeadSourceInput {
  return {
    name: d.name.trim(),
    kind: 'webhook',
    secret: d.secret.mode === 'set' ? d.secret.value : null,
    externalIdPath: orNull(d.externalIdPath),
    mapping: buildMapping(d.mapping),
    defaults: buildDefaults(d),
    rawRetentionDays: retention(d),
  };
}

/** The full edit of a source. A secret goes only when the person set or cleared it: absent keeps the stored one. */
export function buildUpdateBody(d: SourceDraft, rowVersion: number): UpdateLeadSourceInput {
  return {
    rowVersion,
    name: d.name.trim(),
    ...(d.secret.mode === 'set' ? { secret: d.secret.value } : {}),
    ...(d.secret.mode === 'clear' ? { secret: null } : {}),
    externalIdPath: orNull(d.externalIdPath),
    mapping: buildMapping(d.mapping),
    defaults: buildDefaults(d),
    rawRetentionDays: retention(d),
  };
}

/** The wizard's mapping step saves only what that step edits. */
export function buildMappingUpdate(d: SourceDraft, rowVersion: number): UpdateLeadSourceInput {
  return { rowVersion, mapping: buildMapping(d.mapping), externalIdPath: orNull(d.externalIdPath) };
}

/**
 * What the preview call carries: the draft mapping and external id path and, from the defaults, only the country code (the one
 * default that changes how a phone reads). Owners and pickers are not sent: the preview is not the place they are validated.
 */
export function buildPreviewBody(
  d: SourceDraft,
  pick: { payload?: Record<string, unknown>; eventId?: string } = {},
): PreviewLeadMappingInput {
  const cc = normaliseCountryCode(d.countryCode);
  return {
    mapping: buildMapping(d.mapping),
    defaults: leadSourceDefaultsSchema.parse({ countryCode: cc === '' ? null : cc }),
    externalIdPath: orNull(d.externalIdPath),
    ...(pick.payload ? { payload: pick.payload } : {}),
    ...(pick.eventId ? { eventId: pick.eventId } : {}),
  };
}

// --- validation ---------------------------------------------------------------------------------------------------------------

export interface Problem {
  /** Message key under `lead-sources.problems`. */
  key: string;
  values?: Record<string, string | number>;
}
export type Problems = Record<string, Problem>;

/** Field paths are the contract's own (`defaults.owner.userIds`); a custom-field row is `mapping.customFields.row.<id>.key|path`. */
export const rowPath = (id: string, part: 'key' | 'path') =>
  `mapping.customFields.row.${id}.${part}`;

function pathProblems(value: string, out: Problems, path: string) {
  if (value.trim().length > PATH_MAX) out[path] = { key: 'pathLength', values: { max: PATH_MAX } };
  // eslint-disable-next-line no-control-regex -- control characters are exactly what the contract refuses
  else if (/[\u0000-\u001f]/.test(value)) out[path] = { key: 'pathCharacters' };
}

export function validateDraft(d: SourceDraft): Problems {
  const p: Problems = {};
  const name = d.name.trim();
  if (name === '') p.name = { key: 'nameRequired' };
  else if (name.length > NAME_MAX) p.name = { key: 'nameLength', values: { max: NAME_MAX } };

  if (d.platform.trim().length > PLATFORM_MAX)
    p['defaults.platform'] = { key: 'platformLength', values: { max: PLATFORM_MAX } };

  if (d.secret.mode === 'set') {
    const n = d.secret.value.length;
    if (n < SECRET_MIN || n > SECRET_MAX)
      p.secret = { key: 'secretLength', values: { min: SECRET_MIN, max: SECRET_MAX } };
  }

  pathProblems(d.externalIdPath, p, 'externalIdPath');

  const days = d.retentionDays.trim();
  const n = Number(days);
  if (days === '' || !Number.isInteger(n) || n < 1 || n > LEAD_RAW_RETENTION_MAX_DAYS)
    p.rawRetentionDays = { key: 'retentionRange', values: { max: LEAD_RAW_RETENTION_MAX_DAYS } };

  const cc = normaliseCountryCode(d.countryCode);
  if (cc !== '' && !/^\d{1,4}$/.test(cc)) p['defaults.countryCode'] = { key: 'countryCode' };

  if (d.lifecycleStage.trim().length > 60)
    p['defaults.lifecycleStage'] = { key: 'textLength', values: { max: 60 } };
  if (d.tag.trim().length > 60) p['defaults.tag'] = { key: 'textLength', values: { max: 60 } };

  const owners = new Set(d.ownerUserIds).size;
  if (d.ownerMode === 'fixed' && owners !== 1) p['defaults.owner.userIds'] = { key: 'ownerFixed' };
  if (d.ownerMode === 'round_robin' && owners < 2)
    p['defaults.owner.userIds'] = { key: 'ownerRoundRobin' };
  if (owners > MAX_OWNER_USERS)
    p['defaults.owner.userIds'] = { key: 'ownerTooMany', values: { max: MAX_OWNER_USERS } };

  if (new Set(d.notifyUserIds).size > MAX_NOTIFY_USERS)
    p['defaults.notify.userIds'] = { key: 'notifyTooMany', values: { max: MAX_NOTIFY_USERS } };

  if (d.dealTitle.trim().length > DEAL_TITLE_MAX)
    p['defaults.deal.title'] = { key: 'dealTitleLength', values: { max: DEAL_TITLE_MAX } };

  if (d.speed.enabled && blank(d.speed.templateId))
    p['defaults.speedToLead.templateId'] = { key: 'speedTemplateRequired' };
  if (speedDelay(d.speed.delay) === null)
    p['defaults.speedToLead.delayMinutes'] = {
      key: 'speedDelayRange',
      values: { max: SPEED_TO_LEAD_MAX_DELAY_MINUTES },
    };

  for (const f of MAPPING_FIELDS) pathProblems(d.mapping.fields[f], p, `mapping.${f}`);
  for (const f of ATTRIBUTION_FIELDS)
    pathProblems(d.mapping.attribution[f], p, `mapping.attribution.${f}`);

  const seen = new Set<string>();
  let used = 0;
  for (const r of d.mapping.customFields) {
    const key = r.key.trim();
    const path = r.path.trim();
    if (key === '' && path === '') continue;
    used += 1;
    if (key === '') p[rowPath(r.id, 'key')] = { key: 'propertyRequired' };
    else if (!PROPERTY_KEY.test(key)) p[rowPath(r.id, 'key')] = { key: 'propertyKey' };
    else if (seen.has(key)) p[rowPath(r.id, 'key')] = { key: 'propertyDuplicate' };
    seen.add(key);
    if (path === '') p[rowPath(r.id, 'path')] = { key: 'pathRequired' };
    else pathProblems(r.path, p, rowPath(r.id, 'path'));
  }
  if (used > MAX_CUSTOM_FIELDS)
    p['mapping.customFields'] = { key: 'customFieldsTooMany', values: { max: MAX_CUSTOM_FIELDS } };

  return p;
}

/**
 * The contract's verdict on the request this draft would send. It agrees with `validateDraft` for every rule above; anything it
 * still refuses (a rule added to the contract later) is returned with the contract's own text so it is never swallowed.
 */
export function contractIssues(d: SourceDraft, mode: 'create' | 'update' = 'create'): Problems {
  const out: Problems = {};
  const parsed =
    mode === 'create'
      ? createLeadSourceSchema.safeParse(buildCreateBody(d))
      : updateLeadSourceSchema.safeParse(buildUpdateBody(d, 1));
  if (parsed.success) return out;
  for (const issue of parsed.error.issues) {
    const path = issue.path.join('.');
    if (!(path in out)) out[path] = { key: 'contract', values: { message: issue.message } };
  }
  return out;
}

/** The problems to show: the plain-language ones first, then anything only the contract caught. */
export function allProblems(d: SourceDraft, mode: 'create' | 'update' = 'create'): Problems {
  const own = validateDraft(d);
  if (Object.keys(own).length > 0) return own;
  return contractIssues(d, mode);
}

export function stepOfField(path: string): WizardStep {
  if (path.startsWith('defaults.') && path !== 'defaults.platform') return 'rules';
  if (path.startsWith('mapping.')) return 'mapping';
  return 'basics';
}

export function firstStepWithProblem(problems: Problems): WizardStep | null {
  const steps = new Set(Object.keys(problems).map(stepOfField));
  return WIZARD_STEPS.find((s) => steps.has(s)) ?? null;
}

export const problemsOfSteps = (problems: Problems, steps: readonly WizardStep[]): Problems =>
  Object.fromEntries(
    Object.entries(problems).filter(([path]) => steps.includes(stepOfField(path))),
  );

// --- mapping editing -----------------------------------------------------------------------------------------------------------

/** The mapping input a click on an available path fills: the last one the person focused. */
export type PathTarget =
  | { kind: 'field'; field: MappingField }
  | { kind: 'attribution'; field: AttributionField }
  | { kind: 'custom'; rowId: string }
  | { kind: 'externalId' };

export function applyPath(d: SourceDraft, target: PathTarget, path: string): SourceDraft {
  switch (target.kind) {
    case 'field':
      return {
        ...d,
        mapping: { ...d.mapping, fields: { ...d.mapping.fields, [target.field]: path } },
      };
    case 'attribution':
      return {
        ...d,
        mapping: { ...d.mapping, attribution: { ...d.mapping.attribution, [target.field]: path } },
      };
    case 'custom':
      return {
        ...d,
        mapping: {
          ...d.mapping,
          customFields: d.mapping.customFields.map((r) =>
            r.id === target.rowId ? { ...r, path } : r,
          ),
        },
      };
    case 'externalId':
      return { ...d, externalIdPath: path };
  }
}

/** The paths a preview depends on: when any is wrong the draft is not sent (the person is told to fix the highlighted inputs). */
const PREVIEW_PATHS = (path: string) =>
  path.startsWith('mapping.') || path === 'externalIdPath' || path === 'defaults.countryCode';

/** True when the draft's mapping, external id path and country code can be sent to the preview. */
export const previewIsPossible = (d: SourceDraft): boolean =>
  Object.keys(validateDraft(d)).every((path) => !PREVIEW_PATHS(path)) &&
  leadFieldMappingSchema.safeParse(buildMapping(d.mapping)).success;

// --- change tracking ----------------------------------------------------------------------------------------------------------

/** True when the draft differs from the one it was loaded as (secret edits count). */
export function isDirty(draft: SourceDraft, baseline: SourceDraft): boolean {
  const view = (d: SourceDraft) =>
    JSON.stringify([
      d.name.trim(),
      d.secret.mode,
      d.secret.mode === 'set' ? d.secret.value : '',
      d.externalIdPath.trim(),
      d.retentionDays.trim(),
      buildMapping(d.mapping),
      buildDefaults(d),
    ]);
  return view(draft) !== view(baseline);
}

/** Round robin and fixed owners use the same picker: switching mode keeps the people who still make sense. */
export function withOwnerMode(d: SourceDraft, mode: LeadOwnerMode): SourceDraft {
  const ownerUserIds =
    mode === 'unassigned' ? [] : mode === 'fixed' ? d.ownerUserIds.slice(0, 1) : d.ownerUserIds;
  return { ...d, ownerMode: mode, ownerUserIds };
}

/** The id of the `<datalist>` that offers the payload's own paths to every mapping input. */
export const PATHS_LIST_ID = 'ls-available-paths';
