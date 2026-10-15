/**
 * An INDEPENDENT, deliberately simple re-implementation of what a contact should look like in the target, written for the verifier.
 * It imports NOTHING from transform/, util.ts or the app's phone code: if the loader's phone/email/name/lifecycle/date logic is
 * wrong (or gets "fixed" in a way that changes behaviour), this disagrees with the target and reconcile fails.
 * Slower and cruder than the loader on purpose. Contacts only.
 */
type Doc = Record<string, unknown>;

/** Written from the README ("Contact properties"), not imported from the transform: the Waboo web-analytics property names that become ordinary fields. */
const WEB_ANALYTICS_NAMES = [
  'referrer', 'referrer_name', 'referrer_keyword', 'referrer_url', 'utm_medium', 'utm_campaign', 'utm_source',
  'device_type', 'device_model', 'operating_system', 'operating_system_name', 'browser_version', 'browser_name',
  'ip_continent', 'ip_country_region', 'ip_state_region', 'ip_city', 'channel', 'bot_name', 'module_type', 'module_name', 'platform',
];

export const text = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());

export function truthy(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return /^(true|1|yes|y|t)$/i.test(v.trim());
  return false;
}

/** A soft-deleted document: the flag, or a deleted_time that holds something. */
export function oracleDeleted(doc: Doc): boolean {
  if (truthy(doc.is_deleted)) return true;
  const t = doc.deleted_time;
  return t !== undefined && t !== null && text(t) !== '';
}

export function hexKey(v: unknown): string {
  return v === undefined || v === null ? '' : String(v);
}

export function dateOf(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === 'number') return new Date(v < 1e11 ? v * 1000 : v);
  if (typeof v === 'string' && v.trim() !== '') {
    const t = v.trim();
    const d = /^\d{9,13}$/.test(t)
      ? new Date(Number(t) < 1e11 ? Number(t) * 1000 : Number(t))
      : new Date(t);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export function oidDate(id: unknown): Date | null {
  const s = hexKey(id);
  return /^[0-9a-f]{24}$/i.test(s) ? new Date(parseInt(s.slice(0, 8), 16) * 1000) : null;
}

const slugify = (s: string): string =>
  s
    .normalize('NFKD')
    .split('')
    .filter((ch) => ch.charCodeAt(0) < 0x300 || ch.charCodeAt(0) > 0x36f)
    .join('')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

/** The oracle's own table of national number lengths by calling code (deliberately a separate copy of the idea, not an import). */
const NAT_LEN: Array<[string, number[]]> = [
  ['1', [10]],
  ['7', [10]],
  ['20', [10]],
  ['27', [9]],
  ['30', [10]],
  ['31', [9]],
  ['33', [9]],
  ['34', [9]],
  ['39', [9, 10]],
  ['44', [9, 10]],
  ['49', [10, 11]],
  ['52', [10]],
  ['55', [10, 11]],
  ['60', [9, 10]],
  ['61', [9]],
  ['62', [9, 10, 11]],
  ['63', [10]],
  ['64', [8, 9, 10]],
  ['65', [8]],
  ['66', [9]],
  ['81', [10]],
  ['82', [9, 10]],
  ['84', [9, 10]],
  ['86', [11]],
  ['90', [10]],
  ['91', [10]],
  ['92', [10]],
  ['94', [9]],
  ['880', [10]],
  ['966', [9]],
  ['971', [9]],
  ['977', [10]],
];
const lensOf = (cc: string): number[] | undefined => NAT_LEN.find(([c]) => c === cc)?.[1];

function internationalOk(all: string): string | null {
  if (!/^[1-9][0-9]{7,14}$/.test(all)) return null;
  for (const n of [3, 2, 1]) {
    const lens = lensOf(all.slice(0, n));
    if (lens) return lens.includes(all.length - n) ? `+${all}` : null;
  }
  return `+${all}`;
}

/** E.164 from what a human typed. Anything with letters or odd punctuation, or a digit count the country does not use, is null. */
export function oraclePhone(
  raw: unknown,
  countryCode: unknown,
  defaultCc: string | null,
): string | null {
  const s = text(raw);
  if (s === '') return null;
  if (!/^[0-9+\s().\-/]+$/.test(s)) return null;
  const digits = s.replace(/[^0-9]/g, '');
  if (s.startsWith('+')) return internationalOk(digits);
  if (digits.startsWith('00')) return internationalOk(digits.replace(/^0+/, ''));
  const national = digits.replace(/^0+/, '');
  if (national === '') return null;
  const cc = (text(countryCode) || defaultCc || '').replace(/[^0-9]/g, '').replace(/^0+/, '');
  if (cc === '') return national.length > 10 ? internationalOk(national) : null;
  const lens = lensOf(cc);
  if (lens) {
    if (lens.includes(national.length)) return internationalOk(cc + national);
    if (national.startsWith(cc) && lens.includes(national.length - cc.length))
      return internationalOk(national);
    return null;
  }
  return internationalOk(
    national.startsWith(cc) && national.length >= cc.length + 6 ? national : cc + national,
  );
}

export interface ExpectedContact {
  legacy_id: string;
  name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  normalized_phone: string | null;
  normalized_email: string | null;
  lifecycle_stage: string;
  created_at: string;
  updated_at: string;
}

export class ContactOracle {
  private readonly stage = new Map<string, string>();
  private readonly byLabel = new Map<string, string>();
  private readonly optionLabel = new Map<string, string>();
  private defaultStage = 'new';

  constructor(
    stageDocs: Doc[],
    fieldDocs: Doc[],
    optionDocs: Doc[],
    private readonly defaultCc: string | null,
    private readonly fallbackAt: string,
  ) {
    const isStatus = (d: Doc): boolean => /^(open|closed_won|closed_lost)$/i.test(text(d.type));
    const stages = stageDocs
      .filter((d) => !oracleDeleted(d) && !isStatus(d))
      .sort((a, b) => (Number(a.position) || 0) - (Number(b.position) || 0));
    const used = new Set<string>();
    for (const d of stages) {
      const label = text(d.label) || text(d.name) || hexKey(d._id) || hexKey(d.id);
      const base = slugify(label) || 'x';
      let value = base;
      for (let i = 2; used.has(value); i++) value = `${base}_${i}`;
      used.add(value);
      for (const k of [hexKey(d._id), hexKey(d.id)]) if (k) this.stage.set(k, value);
      this.byLabel.set(label.toLowerCase(), value);
      if (this.defaultStage === 'new' && truthy(d.default) && !truthy(d.disable))
        this.defaultStage = value;
    }
    const lifeFields = new Set<string>();
    for (const f of fieldDocs) {
      if (oracleDeleted(f) || text(f.lifecycle_type) === '') continue;
      for (const k of [hexKey(f._id), hexKey(f.id)]) if (k) lifeFields.add(k);
    }
    for (const o of optionDocs) {
      if (!lifeFields.has(text(o.parent_id))) continue;
      const label = text(o.label) || text(o.value);
      for (const k of [hexKey(o._id), hexKey(o.id)]) if (k && label) this.optionLabel.set(k, label);
    }
  }

  private resolveStage(raw: unknown): string | null {
    const v = text(raw);
    if (v === '') return null;
    return (
      this.stage.get(v) ?? this.byLabel.get((this.optionLabel.get(v) ?? v).toLowerCase()) ?? null
    );
  }

  /** What the target row must hold, or null when the loader may not (should not) have created a contact from this document. */
  expect(doc: Doc): ExpectedContact | null {
    if (oracleDeleted(doc)) return null;
    const first = text(doc.first_name) || null;
    const last = text(doc.last_name) || null;
    const name = [first, last].filter(Boolean).join(' ') || null;
    let email: string | null = text(doc.email).toLowerCase() || null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) email = null;
    const phone = oraclePhone(
      text(doc.mobile_phone_number) || text(doc.whatsapp_phone_number),
      doc.country_code,
      this.defaultCc,
    );
    const hasRejects = Object.keys(doc).some((k) =>
      /^__.+__(error_reason|unverified_value)$/.test(k),
    );
    if (!name && !email && !phone && !hasRejects) return null;
    const firstOf = (keys: string[]): unknown =>
      keys.map((k) => doc[k]).find((v) => v !== undefined && v !== null && text(v) !== '');
    const created =
      dateOf(firstOf(['created_time', 'created_at'])) ??
      oidDate(doc._id) ??
      new Date(this.fallbackAt);
    const updated = dateOf(firstOf(['modified_time', 'updated_at'])) ?? created;
    return {
      legacy_id: hexKey(doc._id) || text(doc.id),
      name,
      first_name: first,
      last_name: last,
      email,
      phone,
      normalized_phone: phone ? phone.replace(/[^0-9+]/g, '') : null,
      normalized_email: email,
      lifecycle_stage: this.resolveStage(doc.lifecycle_stage) ?? this.defaultStage,
      created_at: created.toISOString(),
      updated_at: updated.toISOString(),
    };
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The ten tables that are not contacts: what each target row must hold, written again from scratch.
// ---------------------------------------------------------------------------------------------------------------------------------

const FIELD_TYPE: Record<string, string> = {
  string: 'text',
  text: 'text',
  textarea: 'long_text',
  number: 'decimal',
  dropdown: 'select',
  radio: 'radio',
  checkbox: 'checkbox',
  multiselect: 'multiselect',
  date: 'date',
  datetime: 'datetime',
  phone: 'phone',
  landline: 'phone',
  email: 'email',
  url: 'url',
  boolean: 'boolean',
};

type Expect = Record<string, string | number | boolean | null>;

export class TableOracle {
  /** lifecycle document key (either id) -> the status_options row it must become */
  private readonly lifecycle = new Map<string, Expect>();

  constructor(
    stageDocs: Doc[],
    private readonly fallbackAt: string,
  ) {
    const isStatus = (d: Doc): boolean => /^(open|closed_won|closed_lost)$/i.test(text(d.type));
    const live = stageDocs
      .filter((d) => !oracleDeleted(d))
      .sort(
        (a, b) =>
          Number(isStatus(a)) - Number(isStatus(b)) ||
          (Number(a.position) || 0) - (Number(b.position) || 0),
      );
    const used: Record<string, Set<string>> = { stage: new Set(), status: new Set() };
    const stageKeys = new Map<string, string>(); // any key of a stage -> its primary key
    const defaultTaken = new Set<string>();
    for (const d of live) {
      const kind = isStatus(d) ? 'status' : 'stage';
      const label = text(d.label) || text(d.name) || hexKey(d._id) || hexKey(d.id) || 'unnamed';
      const base = slugify(label) || 'x';
      let value = base;
      for (let i = 2; used[kind]!.has(value); i++) value = `${base}_${i}`;
      used[kind]!.add(value);
      const primary = hexKey(d._id) || text(d.id);
      if (kind === 'stage')
        for (const k of [hexKey(d._id), text(d.id)]) if (k) stageKeys.set(k, primary);
      const parent = kind === 'status' ? stageKeys.get(text(d.parent_id)) : undefined;
      const scope = `${kind}:${parent ?? ''}`;
      const active = !truthy(d.disable);
      const isDefault = truthy(d.default) && active && !defaultTaken.has(scope);
      if (isDefault) defaultTaken.add(scope);
      const type = text(d.type).toLowerCase();
      const row: Expect = {
        module_key: 'contacts',
        option_group: kind === 'stage' ? 'lifecycle_stage' : 'status',
        value,
        label,
        position: Number(d.position) || 0,
        is_default: isDefault,
        is_active: active,
        is_won: type === 'closed_won',
        is_lost: type === 'closed_lost',
        ...this.dates(d),
      };
      for (const k of [hexKey(d._id), text(d.id)]) if (k) this.lifecycle.set(k, row);
    }
  }

  private dates(doc: Doc): { created_at: string; updated_at: string } {
    const pick = (keys: string[]): unknown =>
      keys.map((k) => doc[k]).find((v) => v !== undefined && v !== null && text(v) !== '');
    const created =
      dateOf(pick(['created_time', 'created_at'])) ?? oidDate(doc._id) ?? new Date(this.fallbackAt);
    const updated = dateOf(pick(['modified_time', 'updated_at'])) ?? created;
    return { created_at: created.toISOString(), updated_at: updated.toISOString() };
  }

  /** Expected columns of the target row for `doc` (only the ones the oracle has an opinion on), or null for tables it does not model. */
  expectTable(table: string, doc: Doc): Expect | null {
    const visible = (v: unknown): boolean => v === undefined || v === null || truthy(v);
    switch (table) {
      case 'tags':
        return { name: text(doc.tag_title), ...this.dates(doc) };
      case 'contact_groups':
        return { name: text(doc.name), note: null, color: null, ...this.dates(doc) };
      case 'field_sections':
        return {
          module_key: 'contacts',
          name: text(doc.label) || text(doc.name),
          position: Number(doc.position) || 0,
          is_active: true,
          ...this.dates(doc),
        };
      case 'fields': {
        const key = text(doc.name);
        return {
          module_key: 'contacts',
          key,
          label: text(doc.label) || key,
          field_type: FIELD_TYPE[text(doc.type).toLowerCase()] ?? 'text',
          is_required: truthy(doc.required),
          is_hidden: !visible(doc.visible) || truthy(doc.hidden_from_ui),
          is_read_only: truthy(doc.read_only) && !WEB_ANALYTICS_NAMES.includes(String(doc.name)),
          is_masked: truthy(doc.masked),
          is_unique: truthy(doc.unique),
          // the verifier's own copy of the rule (README, "Contact properties"): the 22 web-analytics names are never system fields
          is_system: truthy(doc.system_default) && !WEB_ANALYTICS_NAMES.includes(String(doc.name)),
          is_active: true,
          position: Number(doc.position) || 0,
          ...this.dates(doc),
        };
      }
      case 'field_options': {
        const value = text(doc.value) || text(doc.label);
        return {
          value,
          label: text(doc.label) || value,
          position: Number(doc.position) || 0,
          is_hidden: !visible(doc.visible),
          ...this.dates(doc),
        };
      }
      case 'status_options':
        return this.lifecycle.get(hexKey(doc._id)) ?? this.lifecycle.get(text(doc.id)) ?? null;
      case 'contact_notes':
        return { body: String(doc.context ?? ''), ...this.dates(doc) };
      default:
        return null;
    }
  }

  /** The unique key a table enforces (case-insensitively where the database does), or null. Two documents with the same key cannot both load. */
  uniqueKey(table: string, doc: Doc): string | null {
    switch (table) {
      case 'tags':
        return `tag:${text(doc.tag_title).toLowerCase()}`;
      case 'contact_groups':
        return `group:${text(doc.name).toLowerCase()}`;
      case 'fields':
        return `field:contacts:${text(doc.name)}`;
      default:
        return null;
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Relations, written again from scratch: who belongs to which list, which field depends on which, which option on which.
// ---------------------------------------------------------------------------------------------------------------------------------

/** Lists that can exist as groups: live, a usable name, and the first of its name when compared case-insensitively. */
export function oracleGroups(listDocs: Doc[]): Map<string, string> {
  const byKey = new Map<string, string>(); // any key of a list -> lower-case name
  const seen = new Set<string>();
  for (const l of listDocs) {
    if (oracleDeleted(l)) continue;
    const name = text(l.name);
    if (name === '' || name.length > 191) continue;
    const low = name.toLowerCase();
    if (seen.has(low)) continue;
    seen.add(low);
    for (const k of [hexKey(l._id), text(l.id)]) if (k) byKey.set(k, low);
  }
  return byKey;
}

/** Expected `legacy_id \0 group name` pairs. `contacts` are the contact documents, `canLoad` says whether the oracle lets a contact exist. */
export function oracleMembers(
  contacts: Doc[],
  groups: Map<string, string>,
  canLoad: (d: Doc) => boolean,
): Set<string> {
  const out = new Set<string>();
  for (const c of contacts) {
    if (oracleDeleted(c) || !Array.isArray(c.marketing_list) || !canLoad(c)) continue;
    const legacy = hexKey(c._id) || text(c.id);
    for (const l of c.marketing_list) {
      const g = groups.get(String(l));
      if (g !== undefined) out.add(`${legacy}\u0000${g}`);
    }
  }
  return out;
}

/** Expected `child field key \0 parent field key` pairs, over the field keys that exist in the target. */
export function oracleFieldDeps(
  fieldDocs: Doc[],
  depDocs: Doc[],
  targetKeys: Set<string>,
): Set<string> {
  const nameOf = new Map<string, string>();
  for (const f of fieldDocs) {
    if (oracleDeleted(f) || text(f.type) === 'section') continue;
    for (const k of [hexKey(f._id), text(f.id)]) if (k) nameOf.set(k, text(f.name));
  }
  const out = new Set<string>();
  for (const d of depDocs) {
    const parent = nameOf.get(text(d.field_id));
    const child = nameOf.get(text(d.dependant_field_id));
    if (parent && child && parent !== child && targetKeys.has(parent) && targetKeys.has(child))
      out.add(`${child}\u0000${parent}`);
  }
  return out;
}

/** Expected `parent field \0 parent value \0 child field \0 child value` over the (field key, option value) pairs that exist in the target. */
export function oracleOptionDeps(
  fieldDocs: Doc[],
  optionDocs: Doc[],
  depDocs: Doc[],
  targetOptions: Set<string>,
): Set<string> {
  const fieldName = new Map<string, string>();
  for (const f of fieldDocs)
    for (const k of [hexKey(f._id), text(f.id)]) if (k) fieldName.set(k, text(f.name));
  const opt = new Map<string, string>(); // option key -> `field \0 value`
  for (const o of optionDocs) {
    const fname = fieldName.get(text(o.parent_id));
    const value = text(o.value) || text(o.label);
    if (!fname || !value) continue;
    for (const k of [hexKey(o._id), text(o.id)]) if (k) opt.set(k, `${fname}\u0000${value}`);
  }
  const out = new Set<string>();
  for (const d of depDocs) {
    const parent = opt.get(text(d.option_id));
    if (!parent || !targetOptions.has(parent)) continue;
    const kids = Array.isArray(d.ids) ? d.ids : [];
    for (const id of kids) {
      const child = opt.get(String(id));
      if (child && targetOptions.has(child)) out.add(`${parent}\u0000${child}`);
    }
  }
  return out;
}
