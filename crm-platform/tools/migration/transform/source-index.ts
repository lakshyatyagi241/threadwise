import type { Source } from '../extract/source';
import {
  bool,
  docKeys,
  isDeleted,
  isSecretEntry,
  isSecretName,
  Oid,
  slug,
  str,
  toDate,
  type Doc,
} from '../util';

export interface StageEntry {
  /** The document's primary key (ObjectId hex). */
  key: string;
  kind: 'stage' | 'status';
  value: string;
  label: string;
  position: number;
  isDefault: boolean;
  isActive: boolean;
  isWon: boolean;
  isLost: boolean;
  /** The stage this status belongs to (any of its keys), if the source says so. */
  parentRef: string | null;
  created: Date | null;
  modified: Date | null;
}

/** Everything small enough to hold in memory that transforms need to look up: definitions, dictionaries, which contacts are live. */
export interface SourceIndex {
  fieldsById: Map<string, Doc>;
  fieldsByName: Map<string, Doc>;
  sectionIds: Set<string>;
  /** Property keys declared by live, non-credential definitions. */
  declaredKeys: Set<string>;
  /** Ids (both keys) of property definitions that are soft-deleted or credential-named: their options are excluded too. */
  deletedFieldIds: Set<string>;
  /** option id -> label, for the subscription-status and lifecycle properties only. */
  optionLabel: Map<string, string>;
  stageByKey: Map<string, StageEntry>;
  stageByLabel: Map<string, StageEntry>;
  stages: StageEntry[];
  /**
   * What the app does for a contact created with no stage: the workspace's default, active `lifecycle_stage` status option
   * (ContactsRepository.defaultOptionValue), else the column default 'new'.
   */
  defaultStage: string;
  listLive: Set<string>;
  listDeleted: Set<string>;
  contactLive: Set<string>;
  contactDeleted: Set<string>;
  /** Every top-level key seen on any contact_list document. */
  contactKeys: Set<string>;
  /** Earliest creation time of any contact: the stable timestamp for rows the tool itself creates (undeclared fields). */
  firstContactAt: string;
  /** The dump has a `user` collection: only then is a contact's owner looked up (and reported when it does not resolve). */
  hasUsers: boolean;
}

const SUB_FIELDS = new Set([
  'whatsapp_subscription_status',
  'email_subscription_status',
  'sms_subscription_status',
]);
const STATUS_TYPES = new Set(['open', 'closed_won', 'closed_lost']);

export const isStatusDoc = (d: Doc): boolean =>
  STATUS_TYPES.has(String(d.type ?? '').toLowerCase());

async function all(source: Source, client: string, collection: string): Promise<Doc[]> {
  if (!source.collections(client).includes(collection)) return [];
  const out: Doc[] = [];
  for await (const d of source.read(client, collection)) out.push(d);
  return out;
}

export async function buildIndex(
  source: Source,
  client: string,
  fallbackAt: string,
): Promise<SourceIndex> {
  const idx: SourceIndex = {
    fieldsById: new Map(),
    fieldsByName: new Map(),
    sectionIds: new Set(),
    declaredKeys: new Set(),
    deletedFieldIds: new Set(),
    optionLabel: new Map(),
    stageByKey: new Map(),
    stageByLabel: new Map(),
    stages: [],
    defaultStage: 'new',
    listLive: new Set(),
    listDeleted: new Set(),
    contactLive: new Set(),
    contactDeleted: new Set(),
    contactKeys: new Set(),
    firstContactAt: '',
    hasUsers: source.collections(client).includes('user'),
  };

  const wantedParents = new Set<string>();
  for (const f of await all(source, client, 'contact_properties_fields')) {
    const keys = docKeys(f).map((k) => k.key);
    for (const k of keys) idx.fieldsById.set(k, f);
    const name = str(f.name);
    if (isDeleted(f) || (name && isSecretName(name))) {
      keys.forEach((k) => idx.deletedFieldIds.add(k));
      continue;
    }
    if (String(f.type) === 'section') keys.forEach((k) => idx.sectionIds.add(k));
    else if (name) {
      idx.fieldsByName.set(name, f);
      idx.declaredKeys.add(name);
      if (SUB_FIELDS.has(name) || str(f.lifecycle_type)) keys.forEach((k) => wantedParents.add(k));
    }
  }
  if (wantedParents.size > 0) {
    for (const o of await all(source, client, 'contact_properties_field_options')) {
      const parent = str(o.parent_id);
      const label = str(o.label) ?? str(o.value);
      if (!parent || !wantedParents.has(parent) || !label) continue;
      docKeys(o).forEach((k) => idx.optionLabel.set(k.key, label));
    }
  }

  // lifecycle stages and statuses: unique slug per kind, one default per scope
  const usedValues = { stage: new Set<string>(), status: new Set<string>() };
  const defaultsSeen = new Set<string>();
  const docs = await all(source, client, 'contact_lifecycle_stages');
  // stages before statuses (a status's default scope is its stage), then by position
  docs.sort(
    (a, b) =>
      Number(isStatusDoc(a)) - Number(isStatusDoc(b)) ||
      (Number(a.position) || 0) - (Number(b.position) || 0),
  );
  for (const d of docs) {
    if (isDeleted(d)) continue;
    const kind = isStatusDoc(d) ? 'status' : 'stage';
    const label = str(d.label) ?? str(d.name) ?? docKeys(d)[0]?.key ?? 'unnamed';
    let value = slug(label) || 'x';
    for (let i = 2; usedValues[kind].has(value); i++) value = `${slug(label) || 'x'}_${i}`;
    usedValues[kind].add(value);
    const type = String(d.type ?? '').toLowerCase();
    const parentRef = str(d.parent_id);
    const parentStage = kind === 'status' && parentRef ? idx.stageByKey.get(parentRef) : undefined;
    const scope = `${kind}:${parentStage?.kind === 'stage' ? parentStage.key : ''}`;
    const isActive = !bool(d.disable);
    const isDefault = bool(d.default) && isActive && !defaultsSeen.has(scope);
    if (isDefault) defaultsSeen.add(scope);
    const entry: StageEntry = {
      key: docKeys(d)[0]!.key,
      kind,
      value,
      label,
      position: Number(d.position) || 0,
      isDefault,
      isActive,
      isWon: type === 'closed_won',
      isLost: type === 'closed_lost',
      parentRef,
      created: toDate(d.created_time),
      modified: toDate(d.modified_time),
    };
    idx.stages.push(entry);
    for (const k of docKeys(d)) idx.stageByKey.set(k.key, entry);
    idx.stageByLabel.set(`${kind}:${label.toLowerCase()}`, entry);
  }
  idx.defaultStage = idx.stages.find((s) => s.kind === 'stage' && s.isDefault)?.value ?? 'new';

  for (const l of await all(source, client, 'marketing_list')) {
    const target = isDeleted(l) ? idx.listDeleted : idx.listLive;
    docKeys(l).forEach((k) => target.add(k.key));
  }

  if (source.collections(client).includes('contact_list')) {
    for await (const c of source.read(client, 'contact_list')) {
      const target = isDeleted(c) ? idx.contactDeleted : idx.contactLive;
      docKeys(c).forEach((k) => target.add(k.key));
      // a key counts only if some document keeps a value for it: a key whose every value is a credential is never a field
      for (const [k, v] of Object.entries(c))
        if (v !== null && v !== undefined && !isSecretEntry(k, v)) idx.contactKeys.add(k);
      const at = (
        toDate(c.created_time) ?? (c._id instanceof Oid ? c._id.date : null)
      )?.toISOString();
      if (at && (idx.firstContactAt === '' || at < idx.firstContactAt)) idx.firstContactAt = at;
    }
  }
  if (idx.firstContactAt === '') idx.firstContactAt = fallbackAt;
  return idx;
}
