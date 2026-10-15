import { bool, isDeleted, isSecretName, str, type Doc } from '../util';
import { c, rest, times, TS_COLS } from './common';
import { CONTACT_FIELDS, REJECT_MARKER } from './contacts';
import type { Ctx, FieldMap, HandlerSpec, Outcome, Soft } from './types';

/** Waboo property type -> fields.field_type (chk_fields_type). Unknown types become text and keep the original in config. */
export const TYPE_MAP: Record<string, string> = {
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

const DEF_COLUMN_KEYS = [
  '_id',
  'id',
  'name',
  'label',
  'type',
  'visible',
  'hidden_from_ui',
  'required',
  'unique',
  'read_only',
  'masked',
  'system_default',
  'position',
  'parent_id',
  'created_time',
  'modified_time',
  'is_deleted',
];

const DEF_FIELDS: FieldMap = {
  _id: 'id',
  id: 'id',
  name: 'col:fields.key',
  label: 'col:fields.label / field_sections.name',
  type: 'col:fields.field_type',
  visible: 'col:fields.is_hidden (inverted)',
  hidden_from_ui: 'col:fields.is_hidden',
  required: 'col:fields.is_required',
  unique: 'col:fields.is_unique',
  read_only: 'col:fields.is_read_only',
  masked: 'col:fields.is_masked',
  system_default: 'col:fields.is_system',
  position: 'col:position',
  parent_id: 'col:fields.section_id',
  created_time: 'col:created_at',
  modified_time: 'col:updated_at',
  is_deleted: 'drop:soft-delete flag; deleted definitions are excluded and counted',
  deleted_time: 'drop:soft-delete timestamp; deleted definitions are excluded and counted',
  custom: 'config',
  placeholder: 'config',
  tooltip: 'config',
  visible_in_form: 'config',
  visible_in_bulk_update: 'config',
  whatsapp_module_allowed_fields: 'config',
  email_module_allowed_fields: 'config',
  sms_module_allowed_fields: 'config',
  original_label: 'config',
  original_name: 'config',
  lifecycle_type: 'config',
  is_lifecycle_stage: 'config',
  updated_by: 'config (a Waboo user id; users are phase 2)',
};

const cols = (extra: ReturnType<typeof c>[]) => [...extra, ...TS_COLS];

export const fieldSections: HandlerSpec = {
  handler: 'field_sections',
  collection: 'contact_properties_fields',
  mapCollection: 'contact_properties_fields',
  update: {},
  only: (d) => String(d.type) === 'section',
  tables: {
    field_sections: {
      constants: { row_version: 1 },
      columns: cols([
        c('module_key', 'text'),
        c('name', 'text'),
        c('position', 'integer'),
        c('is_active', 'boolean'),
      ]),
      fp: ['module_key', 'name', 'position'],
    },
  },
  fields: DEF_FIELDS,
  transform(doc: Doc, ctx: Ctx): Outcome {
    if (isDeleted(doc))
      return { kind: 'exclude', code: 'SOFT_DELETED', reason: 'is_deleted or deleted_time is set' };
    const name = str(doc.label) ?? str(doc.name);
    if (!name)
      return { kind: 'quarantine', code: 'NO_NAME', reason: 'section without label or name' };
    const t = times(doc, ctx.fallbackAt);
    return {
      kind: 'rows',
      soft: t.soft,
      rows: [
        {
          table: 'field_sections',
          sub: '',
          row: {
            module_key: 'contacts',
            name,
            position: Number(doc.position) || 0,
            is_active: true,
            created_at: t.created,
            updated_at: t.updated,
          },
        },
      ],
    };
  },
};

const FIELD_COLS = cols([
  c('module_key', 'text'),
  c('section_id', 'bigint'),
  c('key', 'text'),
  c('label', 'text'),
  c('field_type', 'text'),
  c('is_required', 'boolean'),
  c('is_hidden', 'boolean'),
  c('is_read_only', 'boolean'),
  c('is_masked', 'boolean'),
  c('is_unique', 'boolean'),
  c('is_system', 'boolean'),
  c('is_active', 'boolean'),
  c('position', 'integer'),
  c('config', 'jsonb'),
]);

/** The Waboo "Web Analytics Information" properties WaDesk has no built-in place for (visitor/UTM/device/IP facts and where the contact came from): ordinary, editable, visible fields. */
export const WEB_ANALYTICS_KEYS: ReadonlySet<string> = new Set([
  'referrer', 'referrer_name', 'referrer_keyword', 'referrer_url',
  'utm_medium', 'utm_campaign', 'utm_source',
  'device_type', 'device_model', 'operating_system', 'operating_system_name', 'browser_version', 'browser_name',
  'ip_continent', 'ip_country_region', 'ip_state_region', 'ip_city',
  'channel', 'bot_name', 'module_type', 'module_name', 'platform',
]);

export const fieldDefs: HandlerSpec = {
  handler: 'field_defs',
  collection: 'contact_properties_fields',
  mapCollection: 'contact_properties_fields',
  update: {},
  only: (d) => String(d.type) !== 'section',
  tables: {
    fields: {
      columns: FIELD_COLS,
      constants: {
        replaces_field_id: null,
        is_quick_create: false,
        is_global_search: false,
        row_version: 1,
      },
      fp: [
        'module_key',
        'key',
        'label',
        'field_type',
        'is_required',
        'is_hidden',
        'is_unique',
        'section_id',
      ],
    },
  },
  fields: DEF_FIELDS,
  transform(doc: Doc, ctx: Ctx): Outcome {
    if (isDeleted(doc))
      return { kind: 'exclude', code: 'SOFT_DELETED', reason: 'is_deleted or deleted_time is set' };
    const key = str(doc.name);
    if (!key)
      return { kind: 'quarantine', code: 'NO_NAME', reason: 'property without a name (its key)' };
    if (isSecretName(key)) {
      return {
        kind: 'exclude',
        code: 'SECRET_FIELD',
        reason: 'the property name looks like a credential; it is not copied anywhere',
      };
    }
    const soft: Soft[] = [];
    const legacyType = String(doc.type ?? '');
    let fieldType = TYPE_MAP[legacyType.toLowerCase()];
    if (!fieldType) {
      fieldType = 'text';
      soft.push({
        code: 'UNKNOWN_FIELD_TYPE',
        reason: `type "${legacyType}" has no equivalent; stored as text`,
        detail: legacyType,
      });
    }
    const parent = str(doc.parent_id);
    const section = parent ? ctx.ref('contact_properties_fields', parent) : undefined;
    const t = times(doc, ctx.fallbackAt);
    soft.push(...t.soft);
    return {
      kind: 'rows',
      soft,
      rows: [
        {
          table: 'fields',
          sub: '',
          row: {
            module_key: 'contacts',
            section_id: section?.table === 'field_sections' ? section.id : null,
            key,
            label: str(doc.label) ?? key,
            field_type: fieldType,
            is_required: bool(doc.required),
            is_hidden: !bool(doc.visible, true) || bool(doc.hidden_from_ui),
            // the web-analytics fields are editable in WaDesk: the contact Edit panel lists only editable fields, so a read-only flag would keep
            // the UTM / referrer / device fields out of it (Waboo shows all of them on the contact)
            is_read_only: bool(doc.read_only) && !WEB_ANALYTICS_KEYS.has(key),
            is_masked: bool(doc.masked),
            is_unique: bool(doc.unique),
            // Waboo's own web-analytics properties are "system" there but have no built-in place in WaDesk: a system field is hidden on the
            // contact page, so these stay ordinary (read-only) fields. `source` stays system: it is the native contacts.source column.
            is_system: bool(doc.system_default) && !WEB_ANALYTICS_KEYS.has(key),
            is_active: true,
            position: Number(doc.position) || 0,
            config: { legacy: { type: legacyType, ...rest(doc, DEF_COLUMN_KEYS) } },
            created_at: t.created,
            updated_at: t.updated,
          },
        },
      ],
    };
  },
};

/**
 * Keys present on contact documents that no property definition declares. They still have to be fields (contacts.data keys need
 * a matching fields row), so each gets a plain text field flagged as undeclared. One synthetic document per key.
 */
export const fieldUndeclared: HandlerSpec = {
  handler: 'field_undeclared',
  collection: 'contact_list',
  mapCollection: 'contact_list.__undeclared_fields',
  virtual: true,
  tables: {
    fields: {
      columns: [
        c('module_key', 'text'),
        c('section_id', 'bigint'),
        c('key', 'text'),
        c('label', 'text'),
        c('field_type', 'text'),
        c('is_required', 'boolean'),
        c('is_hidden', 'boolean'),
        c('is_read_only', 'boolean'),
        c('is_masked', 'boolean'),
        c('is_unique', 'boolean'),
        c('is_system', 'boolean'),
        c('is_active', 'boolean'),
        c('position', 'integer'),
        c('config', 'jsonb'),
        ...TS_COLS,
      ],
      constants: {
        replaces_field_id: null,
        is_quick_create: false,
        is_global_search: false,
        row_version: 1,
      },
      fp: ['module_key', 'key', 'field_type'],
    },
  },
  fields: { _id: 'id', key: 'col:fields.key', at: 'col:created_at' },
  read: ({ idx }) => {
    const known = new Set([...idx.declaredKeys, ...Object.keys(CONTACT_FIELDS)]);
    return [...idx.contactKeys]
      .filter((k) => !known.has(k) && !REJECT_MARKER.test(k))
      .sort()
      .map((key) => ({ _id: `undeclared:${key}`, key, at: idx.firstContactAt }));
  },
  transform(doc: Doc): Outcome {
    const key = String(doc.key);
    return {
      kind: 'rows',
      rows: [
        {
          table: 'fields',
          sub: '',
          row: {
            module_key: 'contacts',
            section_id: null,
            key,
            label: key,
            field_type: 'text',
            is_required: false,
            is_hidden: false,
            is_read_only: false,
            is_masked: false,
            is_unique: false,
            is_system: false,
            is_active: true,
            position: 9999,
            config: { legacy: { undeclared: true } },
            created_at: String(doc.at),
            updated_at: String(doc.at),
          },
        },
      ],
    };
  },
};

export const fieldOptions: HandlerSpec = {
  handler: 'field_options',
  collection: 'contact_properties_field_options',
  mapCollection: 'contact_properties_field_options',
  update: {},
  tables: {
    field_options: {
      columns: cols([
        c('field_id', 'bigint'),
        c('value', 'text'),
        c('label', 'text'),
        c('position', 'integer'),
        c('is_hidden', 'boolean'),
      ]),
      constants: { row_version: 1 },
      fp: ['field_id', 'value', 'label', 'position', 'is_hidden'],
    },
  },
  fields: {
    _id: 'id',
    id: 'id',
    parent_id: 'col:field_id',
    label: 'col:label',
    value: 'col:value',
    position: 'col:position',
    visible: 'col:is_hidden (inverted)',
    masked: 'drop:no column in WaDesk (field_options has is_hidden only; masking is a property setting, fields.is_masked)',
    created_time: 'col:created_at',
    modified_time: 'col:updated_at',
  },
  transform(doc: Doc, ctx: Ctx): Outcome {
    const parent = str(doc.parent_id);
    if (parent && ctx.idx.deletedFieldIds.has(parent)) {
      return { kind: 'exclude', code: 'PARENT_EXCLUDED', reason: 'its property is soft-deleted' };
    }
    const field = parent ? ctx.ref('contact_properties_fields', parent) : undefined;
    if (!field || field.table !== 'fields') {
      return {
        kind: 'quarantine',
        code: 'ORPHAN_PARENT',
        reason: `option parent ${parent ?? '(none)'} is not a migrated property`,
      };
    }
    const value = str(doc.value) ?? str(doc.label);
    const label = str(doc.label) ?? value;
    if (!value || !label)
      return {
        kind: 'quarantine',
        code: 'EMPTY_OPTION',
        reason: 'option has neither label nor value',
      };
    const t = times(doc, ctx.fallbackAt);
    return {
      kind: 'rows',
      soft: t.soft,
      rows: [
        {
          table: 'field_options',
          sub: '',
          row: {
            field_id: field.id,
            value,
            label,
            position: Number(doc.position) || 0,
            is_hidden: !bool(doc.visible, true),
            created_at: t.created,
            updated_at: t.updated,
          },
        },
      ],
    };
  },
};

export const fieldDeps: HandlerSpec = {
  handler: 'field_deps',
  collection: 'contact_properties_field_dependancy_mapping',
  mapCollection: 'contact_properties_field_dependancy_mapping',
  tables: {
    field_dependencies: {
      columns: [
        c('field_id', 'bigint'),
        c('depends_on_field_id', 'bigint'),
        c('created_at', 'timestamptz'),
      ],
      fp: ['field_id', 'depends_on_field_id'],
      constants: { depends_on_option_id: null, depends_on_value: null },
    },
  },
  fields: {
    _id: 'id',
    id: 'id',
    field_id: 'col:depends_on_field_id (the controlling field)',
    dependant_field_id: 'col:field_id (the dependent field)',
  },
  transform(doc: Doc, ctx: Ctx): Outcome {
    const parent = ctx.ref('contact_properties_fields', doc.field_id);
    const child = ctx.ref('contact_properties_fields', doc.dependant_field_id);
    if (!parent || !child || parent.table !== 'fields' || child.table !== 'fields') {
      return {
        kind: 'quarantine',
        code: 'UNRESOLVED_FIELD',
        reason: 'one side of the dependency is not a migrated property',
      };
    }
    if (parent.id === child.id)
      return {
        kind: 'quarantine',
        code: 'SELF_DEPENDENCY',
        reason: 'a field cannot depend on itself',
      };
    const t = times(doc, ctx.fallbackAt);
    return {
      kind: 'rows',
      soft: t.soft,
      rows: [
        {
          table: 'field_dependencies',
          sub: '',
          row: { field_id: child.id, depends_on_field_id: parent.id, created_at: t.created },
        },
      ],
    };
  },
};

export const fieldOptionDeps: HandlerSpec = {
  handler: 'field_option_deps',
  collection: 'contact_properties_field_options_dependancy_mapping',
  mapCollection: 'contact_properties_field_options_dependancy_mapping',
  tables: {
    field_option_dependencies: {
      columns: [
        c('parent_option_id', 'bigint'),
        c('child_option_id', 'bigint'),
        c('created_at', 'timestamptz'),
      ],
      fp: ['parent_option_id', 'child_option_id'],
    },
  },
  fields: {
    _id: 'id',
    id: 'id',
    field_dependancy_id: 'drop:the pair id of the field dependency; implied by the option ids',
    option_id: 'col:parent_option_id',
    ids: 'col:child_option_id (one row per id)',
  },
  transform(doc: Doc, ctx: Ctx): Outcome {
    const parent = ctx.ref('contact_properties_field_options', doc.option_id);
    const ids = Array.isArray(doc.ids) ? [...new Set(doc.ids.map(String))] : [];
    if (!parent)
      return {
        kind: 'quarantine',
        code: 'UNRESOLVED_OPTION',
        reason: `parent option ${String(doc.option_id)} is not migrated`,
      };
    const t = times(doc, ctx.fallbackAt);
    const soft: Soft[] = [...t.soft];
    const rows = [];
    for (const id of ids) {
      const child = ctx.ref('contact_properties_field_options', id);
      if (!child) {
        soft.push({
          code: 'UNRESOLVED_OPTION',
          reason: `child option ${id} is not migrated`,
          detail: id,
        });
        continue;
      }
      rows.push({
        table: 'field_option_dependencies',
        sub: `#${id}`,
        row: { parent_option_id: parent.id, child_option_id: child.id, created_at: t.created },
      });
    }
    if (rows.length === 0)
      return {
        kind: 'quarantine',
        code: 'NO_CHILDREN',
        reason: 'none of the child options could be resolved',
      };
    return { kind: 'rows', soft, rows };
  },
};
