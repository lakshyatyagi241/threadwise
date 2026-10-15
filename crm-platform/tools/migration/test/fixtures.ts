/**
 * INVENTED data only. Two fake clients that mimic the quirks the pilot discovery found (dual id schemes, option ids vs labels,
 * soft deletes, __x__ reject markers, mixed phone formats, dates as Date / string / epoch, null vs missing) with made-up values.
 * Nothing here comes from a real customer database.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type J = Record<string, unknown>;
export const O = (n: number): J => ({ $oid: `65f0a1b2${n.toString(16).padStart(16, '0')}` });
export const D = (iso: string): J => ({ $date: iso });
const T1 = '2026-03-01T10:00:00.000Z';
const T2 = '2026-04-02T11:30:00.000Z';

let seq = 1;
const next = (): J => O(seq++);

function write(root: string, client: string, collection: string, docs: J[]): void {
  mkdirSync(join(root, client), { recursive: true });
  writeFileSync(
    join(root, client, `${collection}.ndjson`),
    docs.map((d) => JSON.stringify(d)).join('\n') + (docs.length ? '\n' : ''),
  );
}

const fld = (id: string, name: string, type: string, extra: J = {}): J => ({
  _id: next(),
  id,
  name,
  label: name.replace(/_/g, ' '),
  type,
  visible: true,
  masked: false,
  is_deleted: false,
  custom: !extra.system_default,
  required: false,
  unique: false,
  position: 1,
  parent_id: 'sec00001',
  created_time: D(T1),
  modified_time: D(T2),
  ...extra,
});

export interface FixtureOptions {
  /** extra generated contacts per client, to get several batches */
  bulk?: number;
  /** also write the invented `roles`, `user` and `available_permissions` collections (off by default: the other suites do not expect them) */
  access?: boolean;
}

/** acme: option ids everywhere (like the iskm pilot database). */
function acme(root: string, bulk: number): void {
  seq = 1000;
  const c = 'acme';
  write(root, c, 'project', [
    {
      _id: O(1),
      id: 'prj001',
      name: 'Acme Demo Co',
      description: null,
      domain: 'acme.example.test',
      version_name: 'v1',
      tracking_id: 'trk0000000000001',
      module_id: 7,
      created_time: D(T1),
      modified_time: D(T2),
      deleted_time: null,
    },
  ]);
  write(root, c, 'project_configuration', [
    {
      _id: next(),
      config_key: 'site_cfg',
      is_json: true,
      config_value: {
        base_url: 'https://cfg.example.test',
        auth_token: 'FAKE-TOKEN-1',
        site_id: true,
      },
      project_version_id: 'vv0001',
      created_time: D(T1),
      modified_time: D(T1),
      deleted_time: null,
    },
  ]);
  write(root, c, 'workspace_settings', [
    {
      _id: next(),
      type: 'email_alerts_config',
      email_alerts_enabled: false,
      created_at: D(T1),
      updated_at: D(T2),
    },
  ]);

  write(root, c, 'contact_properties_fields', [
    fld('sec00001', 'basic_info', 'section', { position: 0, parent_id: undefined }),
    fld('sec00002', 'event_info', 'section', { position: 2, parent_id: undefined }),
    fld('fld0001a', 'first_name', 'string', { system_default: true, required: true, position: 1 }),
    fld('fld0002a', 'last_name', 'string', { system_default: true, position: 2 }),
    fld('fld0003a', 'email', 'email', { system_default: true, position: 3, unique: true }),
    fld('fld0004a', 'mobile_phone_number', 'phone', { system_default: true, position: 4 }),
    fld('fld0005a', 'lifecycle_stage', 'dropdown', {
      system_default: true,
      position: 5,
      lifecycle_type: 'lifecycle_stage',
      is_lifecycle_stage: true,
    }),
    fld('fld0006a', 'whatsapp_subscription_status', 'dropdown', {
      system_default: true,
      position: 6,
    }),
    fld('fld0007a', 'ratha_yatra_2026', 'string', {
      parent_id: 'sec00002',
      position: 7,
      placeholder: 'yes/no',
      tooltip: null,
    }),
    fld('fld0008a', 'city', 'dropdown', { parent_id: 'sec00002', position: 8 }),
    fld('fld0009a', 'state', 'dropdown', { parent_id: 'sec00002', position: 9 }),
    fld('fld0010a', 'old_thing', 'string', { is_deleted: true }),
    fld('fld0011a', 'weird_one', 'hologram', { position: 11 }),
    fld('fld0012a', 'attendees', 'number', { parent_id: 'sec00002', position: 12 }),
  ]);
  write(root, c, 'contact_properties_field_options', [
    {
      _id: next(),
      id: 'opt00001',
      parent_id: 'fld0006a',
      label: 'Subscribed',
      value: 'Subscribed',
      position: 1,
      visible: true,
      created_time: D(T1),
      modified_time: D(T1),
    },
    {
      _id: next(),
      id: 'opt00002',
      parent_id: 'fld0006a',
      label: 'Unsubscribed',
      value: 'Unsubscribed',
      position: 2,
      visible: true,
      created_time: D(T1),
      modified_time: D(T1),
    },
    {
      _id: next(),
      id: 'opt00003',
      parent_id: 'fld0008a',
      label: 'Pune',
      value: 'Pune',
      position: 1,
      visible: true,
      created_time: D(T1),
      modified_time: D(T1),
    },
    {
      _id: next(),
      id: 'opt00004',
      parent_id: 'fld0008a',
      label: 'Nashik',
      value: 'Nashik',
      position: 2,
      visible: false,
      created_time: D(T1),
      modified_time: D(T1),
    },
    {
      _id: next(),
      id: 'opt00005',
      parent_id: 'fld0009a',
      label: 'Maharashtra',
      value: 'MH',
      position: 1,
      visible: true,
      created_time: D(T1),
      modified_time: D(T1),
    },
    {
      _id: next(),
      id: 'opt00006',
      parent_id: 'fld0010a',
      label: 'Gone',
      value: 'gone',
      position: 1,
      visible: true,
      created_time: D(T1),
      modified_time: D(T1),
    },
    {
      _id: next(),
      id: 'opt00007',
      parent_id: 'nofield1',
      label: 'Orphan',
      value: 'orphan',
      position: 1,
      visible: true,
      created_time: D(T1),
      modified_time: D(T1),
    },
  ]);
  write(root, c, 'contact_properties_field_dependancy_mapping', [
    { _id: next(), id: 'dep00001', field_id: 'fld0009a', dependant_field_id: 'fld0008a' },
    { _id: next(), id: 'dep00002', field_id: 'fld0008a', dependant_field_id: 'fld0008a' },
  ]);
  write(root, c, 'contact_properties_field_options_dependancy_mapping', [
    {
      _id: next(),
      id: 'odp00001',
      field_dependancy_id: 'dep00001',
      option_id: 'opt00005',
      ids: ['opt00003', 'opt00004', 'opt00003'],
    },
    {
      _id: next(),
      id: 'odp00002',
      field_dependancy_id: 'dep00001',
      option_id: 'opt00005',
      ids: ['opt99999'],
    },
  ]);
  write(root, c, 'contact_lifecycle_stages', [
    {
      _id: next(),
      id: 'stg00001',
      parent_id: 'fld0005a',
      created_time: D(T1),
      modified_time: D(T1),
      is_deleted: false,
      deleted_time: '',
      position: 1,
      label: 'New',
      name: 'new',
      type: '',
      default: true,
      custom: false,
      disable: false,
    },
    {
      _id: next(),
      id: 'stg00002',
      parent_id: 'fld0005a',
      created_time: D(T1),
      modified_time: D(T1),
      is_deleted: false,
      deleted_time: '',
      position: 2,
      label: 'Lead',
      name: 'lead',
      type: '',
      default: false,
      custom: false,
      disable: false,
    },
    {
      _id: next(),
      id: 'stg00003',
      parent_id: 'fld0005a',
      created_time: D(T1),
      modified_time: D(T1),
      is_deleted: false,
      deleted_time: '',
      position: 3,
      label: 'Customer',
      name: 'customer',
      type: '',
      default: false,
      custom: true,
      disable: false,
    },
    {
      _id: next(),
      id: 'sts00001',
      parent_id: 'stg00002',
      created_time: D(T1),
      modified_time: D(T1),
      is_deleted: false,
      deleted_time: '',
      position: 1,
      label: 'Open',
      name: 'open',
      type: 'open',
      default: true,
      custom: false,
      disable: false,
    },
    {
      _id: next(),
      id: 'sts00002',
      parent_id: 'stg00003',
      created_time: D(T1),
      modified_time: D(T1),
      is_deleted: false,
      deleted_time: '',
      position: 1,
      label: 'Won',
      name: 'won',
      type: 'closed_won',
      default: true,
      custom: false,
      disable: false,
    },
    {
      _id: next(),
      id: 'sts00003',
      parent_id: 'stg00003',
      created_time: D(T1),
      modified_time: D(T1),
      is_deleted: true,
      deleted_time: '',
      position: 2,
      label: 'Lost',
      name: 'lost',
      type: 'closed_lost',
      default: false,
      custom: false,
      disable: false,
    },
  ]);
  write(root, c, 'contact_tag', [
    { _id: next(), id: 'tag-fixture-000000001', tag_title: 'vip' },
    { _id: next(), id: 'tag-fixture-000000002', tag_title: '' },
  ]);
  write(root, c, 'marketing_list', [
    {
      _id: O(2001),
      id: 'mkl-fixture-0000000000001',
      name: 'Volunteers',
      created_by: 'u-1',
      user_id: 'u-1',
      created_time: D(T1),
      modified_time: D(T2),
      deleted_time: null,
    },
    {
      _id: O(2002),
      id: 'mkl-fixture-0000000000002',
      name: 'Old list',
      created_by: 'u-1',
      user_id: 'u-1',
      created_time: D(T1),
      modified_time: D(T2),
      deleted_time: D(T2),
    },
    {
      _id: O(2003),
      id: 'mkl-fixture-0000000000003',
      name: 'Donors',
      created_by: 'u-1',
      user_id: 'u-1',
      created_time: D(T1),
      modified_time: D(T2),
      deleted_time: null,
    },
  ]);

  const contacts: J[] = [
    // clean, dual ids, option-id lifecycle + subscription, local phone with own country code
    {
      _id: O(3001),
      id: 'con-fixture-0000001',
      first_name: 'Asha',
      last_name: 'Rao',
      email: ' Asha.Rao@Example.TEST ',
      mobile_phone_number: '9812345671',
      country_code: '91',
      lifecycle_stage: 'stg00002',
      lifecycle_stage_status: 'sts00001',
      lifecycle_stage_date: D(T2),
      previous_lifecycle_stage: 'stg00001',
      previous_lifecycle_stage_date: D(T1),
      original_lifecycle_stage: 'stg00001',
      whatsapp_subscription_status: 'opt00001',
      email_subscription_status: '',
      sms_subscription_status: '',
      source: 'Social Media',
      channel: 'WhatsApp',
      created_time: D(T1),
      modified_time: D(T2),
      is_deleted: false,
      deleted_time: null,
      contact_owner: 5,
      created_by: 'u-1',
      ratha_yatra_2026: 'Yes',
      city: 'Pune',
      attendees: '4',
      marketing_list: ['mkl-fixture-0000000000001'],
      utm_source: null,
      test_undeclared: 'x1',
    },
    // leading-zero national number + cc, unsubscribed, string dates
    {
      _id: O(3002),
      id: 'con-fixture-0000002',
      first_name: 'Bhanu',
      last_name: null,
      email: null,
      mobile_phone_number: '098123 45672',
      country_code: '91',
      lifecycle_stage: 'stg00001',
      whatsapp_subscription_status: 'opt00002',
      created_time: '2026-02-03T09:00:00Z',
      modified_time: '2026-02-04T09:00:00Z',
      is_deleted: false,
      marketing_list: [
        'mkl-fixture-0000000000001',
        'mkl-fixture-0000000000009',
        'mkl-fixture-0000000000002',
      ],
    },
    // international with plus and spaces, epoch-ms dates
    {
      _id: O(3003),
      id: 'con-fixture-0000003',
      first_name: 'Chitra',
      last_name: 'Iyer',
      email: 'chitra@example.test',
      mobile_phone_number: '+91 98123 45673',
      lifecycle_stage: 'stg00003',
      lifecycle_stage_status: 'sts00002',
      created_time: 1772359200000,
      modified_time: 1772445600000,
      is_deleted: false,
    },
    // 00 prefix, no names
    {
      _id: O(3004),
      id: 'con-fixture-0000004',
      email: 'only.email@example.test',
      mobile_phone_number: '00919812345674',
      lifecycle_stage: 'stg00001',
      is_deleted: false,
      created_time: D(T1),
    },
    // soft deleted: excluded
    {
      _id: O(3005),
      id: 'con-fixture-0000005',
      first_name: 'Deleted',
      last_name: 'Person',
      mobile_phone_number: '9812345675',
      country_code: '91',
      lifecycle_stage: 'stg00001',
      is_deleted: true,
      deleted_time: D(T2),
      created_time: D(T1),
    },
    // unreadable phone, import reject markers: contact loads, rejects quarantined
    {
      _id: O(3006),
      id: 'con-fixture-0000006',
      first_name: 'Esha',
      last_name: 'Nair',
      email: 'esha@example.test',
      mobile_phone_number: 'abc',
      lifecycle_stage: 'stg00002',
      is_deleted: false,
      created_time: D(T1),
      __mobile_phone_number__error_reason: 'not a number',
      __mobile_phone_number__unverified_value: 'abc',
    },
    // nothing identifying: quarantined whole
    {
      _id: O(3007),
      id: 'con-fixture-0000007',
      mobile_phone_number: '',
      email: null,
      first_name: null,
      lifecycle_stage: 'stg00001',
      is_deleted: false,
      created_time: D(T1),
    },
    // unknown lifecycle value, bad email, too-short phone
    {
      _id: O(3008),
      id: 'con-fixture-0000008',
      first_name: 'Farid',
      email: 'not-an-email',
      mobile_phone_number: '12345',
      country_code: '',
      lifecycle_stage: 'zzzzzzzz',
      is_deleted: false,
      created_time: D(T1),
    },
    // missing (not null) optional keys, no id (only _id)
    { _id: O(3009), first_name: 'Gita', mobile_phone_number: '+919812345679', is_deleted: false },
  ];
  for (let i = 0; i < bulk; i++) {
    const n = 4000 + i;
    contacts.push({
      _id: O(n),
      id: `con-bulk-${String(i).padStart(8, '0')}`,
      first_name: `Bulk${i}`,
      last_name: 'Fixture',
      email: `bulk${i}@example.test`,
      mobile_phone_number: `98123${String(10000 + i).slice(-5)}`,
      country_code: '91',
      lifecycle_stage: i % 2 ? 'stg00001' : 'stg00002',
      whatsapp_subscription_status: 'opt00001',
      created_time: D(T1),
      modified_time: D(T2),
      is_deleted: false,
      marketing_list: [
        ...(i % 3 === 0 ? ['mkl-fixture-0000000000001'] : []),
        ...(i % 5 === 0 ? ['mkl-fixture-0000000000003'] : []),
      ],
    });
  }
  write(root, c, 'contact_list', contacts);
  write(root, c, 'contact_notes', [
    {
      _id: next(),
      id: 'note-fixture-0000000001',
      contact_id: 'con-fixture-0000001',
      context: 'Called, will attend',
      created_at: D(T1),
      updated_at: D(T2),
      created_by: 'u-1',
      updated_by: 'u-1',
      created_by_username: 'agent',
      updated_by_username: 'agent',
      is_deleted: false,
    },
    {
      _id: next(),
      id: 'note-fixture-0000000002',
      contact_id: 'con-nope',
      context: 'orphan note',
      created_at: D(T1),
      updated_at: D(T1),
      created_by: 'u-1',
      updated_by: 'u-1',
      created_by_username: 'agent',
      updated_by_username: 'agent',
      is_deleted: false,
    },
    {
      _id: next(),
      id: 'note-fixture-0000000003',
      contact_id: 'con-fixture-0000005',
      context: 'note on a deleted contact',
      created_at: D(T1),
      updated_at: D(T1),
      is_deleted: false,
    },
    {
      _id: next(),
      id: 'note-fixture-0000000004',
      contact_id: 'con-fixture-0000002',
      context: 'second note',
      created_at: D(T1),
      updated_at: D(T2),
      is_deleted: false,
    },
  ]);
  write(root, c, 'broadcast_templates', [
    {
      _id: next(),
      id: 'tpl-fixture-000001',
      meta_template_id: '900000000000001',
      type: 'whatsapp',
      created_time: D(T1),
      modified_time: D(T2),
      status: 'APPROVED',
      template_type: 'none',
      created_by: {
        id: 'u-1',
        first_name: 'A',
        last_name: 'B',
        email: 'a@example.test',
        phone: null,
      },
      updated_by: {
        id: 'u-1',
        first_name: 'A',
        last_name: 'B',
        email: 'a@example.test',
        phone: null,
      },
      name: 'welcome_note',
      category: 'MARKETING',
      language: 'en',
      used_in_automation: false,
      components: [
        { type: 'HEADER', format: 'TEXT', text: 'Welcome' },
        { type: 'BODY', text: 'Hello {{1}}, thanks for joining.' },
        { type: 'FOOTER', text: 'Acme Demo' },
        { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Stop' }] },
      ],
    },
    {
      _id: next(),
      id: 'tpl-fixture-000002',
      meta_template_id: '900000000000002',
      type: 'whatsapp',
      created_time: D(T1),
      modified_time: D(T2),
      status: 'REJECTED',
      template_type: 'none',
      name: 'promo_x',
      category: 'UTILITY',
      language: 'en_GB',
      rejection_reason: 'NONE',
      quality: 'UNKNOWN',
      components: [
        {
          type: 'HEADER',
          format: 'IMAGE',
          example: { header_handle: ['https://img.example.test/a.png'] },
        },
        { type: 'BODY', text: 'Sale now' },
      ],
    },
    {
      _id: next(),
      id: 'tpl-fixture-000003',
      meta_template_id: '900000000000003',
      type: 'sms',
      name: 'sms_one',
      status: 'APPROVED',
      category: 'UTILITY',
      language: 'en',
      components: [{ type: 'BODY', text: 'x' }],
    },
  ]);

  // decided-but-not-migrated collections
  write(root, c, 'auth_logs', [
    { _id: next(), event: 'login' },
    { _id: next(), event: 'logout' },
  ]);
  write(root, c, 'segments', [{ _id: next(), id: 'seg1', name: 'a segment' }]);
  write(root, c, 'company_saved_views', [{ _id: next(), name: 'a view' }]);
  write(root, c, 'contact_task_config', [{ _id: next(), action: 'call' }]);
  write(root, c, 'temp_import_contacts_data', []);
  write(root, c, 'credits_mapping_new_bak_20260930', [{ _id: next(), x: 1 }]);
}

/** globex: labels instead of option ids, two projects, epoch/string dates, undeclared custom keys (like the karma pilot database). */
function globex(root: string, bulk: number): void {
  seq = 50000;
  const c = 'globex';
  write(root, c, 'project', [
    {
      _id: O(60001),
      id: 'prj900',
      name: 'Globex Travel',
      domain: 'globex.example.test',
      version_name: 'v2',
      created_time: D(T1),
      modified_time: D(T2),
      deleted_time: null,
      tracking_id: 'trk0000000000009',
      module_id: 7,
    },
    {
      _id: O(60002),
      id: 'prj901',
      name: 'Globex Second Project',
      domain: 'second.globex.example.test',
      created_time: D(T2),
      modified_time: D(T2),
      deleted_time: null,
    },
  ]);
  write(root, c, 'project_configuration', [
    {
      _id: next(),
      config_key: 'crm_cfg',
      is_json: true,
      config_value: { base_url: 'https://g.example.test', password: 'FAKE-PASS' },
      project_version_id: 'vv0002',
      created_time: D(T1),
      modified_time: D(T1),
      deleted_time: null,
    },
  ]);
  write(root, c, 'workspace_settings', [
    {
      _id: next(),
      type: 'opt-in',
      channel: 'whatsapp',
      botid: 'bot-fixture-1',
      status: 'active',
      created_time: D(T1),
      created_by: 'u-9',
      config: { keywords: ['start'], response: { text: 'hi' }, type: 'text' },
    },
    {
      _id: next(),
      type: 'opt-out',
      channel: 'whatsapp',
      botid: 'bot-fixture-1',
      status: 'inactive',
      created_time: D(T1),
      config: { keywords: ['stop'], response: {}, type: 'text' },
    },
  ]);
  write(root, c, 'contact_properties_fields', [
    fld('gsec0001', 'details', 'section', { position: 0, parent_id: undefined }),
    fld('gfld0001', 'first_name', 'string', { parent_id: 'gsec0001', system_default: true }),
    fld('gfld0002', 'email', 'email', { parent_id: 'gsec0001', system_default: true }),
    fld('gfld0003', 'mobile_phone_number', 'phone', {
      parent_id: 'gsec0001',
      system_default: true,
    }),
    fld('gfld0004', 'lifecycle_stage', 'dropdown', {
      parent_id: 'gsec0001',
      system_default: true,
      lifecycle_type: 'lifecycle_stage',
      is_lifecycle_stage: true,
    }),
    fld('gfld0005', 'whatsapp_subscription_status', 'dropdown', {
      parent_id: 'gsec0001',
      system_default: true,
    }),
    fld('gfld0006', 'nature_of_enquiry', 'textarea', {
      parent_id: 'gsec0001',
      required: 'true',
      visible: 'false',
    }),
  ]);
  write(root, c, 'contact_properties_field_options', [
    {
      _id: next(),
      id: 'gopt0001',
      parent_id: 'gfld0005',
      label: 'Yes',
      value: 'Yes',
      position: 1,
      visible: true,
      created_time: D(T1),
      modified_time: D(T1),
    },
    {
      _id: next(),
      id: 'gopt0002',
      parent_id: 'gfld0005',
      label: 'No',
      value: 'No',
      position: 2,
      visible: true,
      created_time: D(T1),
      modified_time: D(T1),
    },
  ]);
  write(root, c, 'contact_properties_field_dependancy_mapping', []);
  write(root, c, 'contact_properties_field_options_dependancy_mapping', []);
  write(root, c, 'contact_lifecycle_stages', [
    {
      _id: next(),
      id: 'gstg0001',
      parent_id: 'gfld0004',
      created_time: D(T1),
      modified_time: D(T1),
      is_deleted: false,
      deleted_time: '',
      position: 1,
      label: 'Lead',
      name: 'lead',
      type: '',
      default: true,
      custom: false,
      disable: false,
    },
    {
      _id: next(),
      id: 'gstg0002',
      parent_id: 'gfld0004',
      created_time: D(T1),
      modified_time: D(T1),
      is_deleted: false,
      deleted_time: '',
      position: 2,
      label: 'Opportunity',
      name: 'opp',
      type: '',
      default: false,
      custom: false,
      disable: false,
    },
  ]);
  write(root, c, 'contact_tag', [{ _id: next(), id: 'gtag-fixture-000000001', tag_title: 'hot' }]);
  write(root, c, 'marketing_list', [
    {
      _id: O(61001),
      id: 'gmkl-fixture-000000000001',
      name: 'Newsletter',
      created_time: D(T1),
      modified_time: D(T1),
      deleted_time: null,
      created_by: 'u-9',
      user_id: 'u-9',
    },
  ]);
  const contacts: J[] = [
    // labels, not ids; undeclared custom keys; an email reject marker; null vs missing
    {
      _id: O(62001),
      id: 'gcon-fixture-000001',
      first_name: 'Hari',
      last_name: 'Om',
      email: 'hari@example.test',
      mobile_phone_number: '+442071838750',
      lifecycle_stage: 'Lead',
      whatsapp_subscription_status: 'Yes',
      contact_stage: 'Lead',
      nature_of_enquiry: 'Beach trip',
      reservation_type: 'Domestic India',
      redeem_later: 'Not sure',
      customer_query: null,
      created_time: D(T1),
      modified_time: D(T2),
      is_deleted: false,
      marketing_list: ['gmkl-fixture-000000000001'],
      __email__error_reason: 'bad domain',
      __email__unverified_value: 'hari@@example',
    },
    {
      _id: O(62002),
      id: 'gcon-fixture-000002',
      first_name: 'Indu',
      mobile_phone_number: '9812345602',
      lifecycle_stage: 'Opportunity',
      whatsapp_subscription_status: 'No',
      created_time: '2026-03-05',
      is_deleted: false,
    },
    {
      _id: O(62003),
      id: 'gcon-fixture-000003',
      first_name: 'Jai',
      email: 'JAI@EXAMPLE.TEST',
      mobile_phone_number: null,
      lifecycle_stage: 'Lead',
      is_deleted: false,
      created_time: D(T1),
    },
    {
      _id: O(62004),
      id: 'gcon-fixture-000004',
      first_name: 'Gone',
      mobile_phone_number: '9812345604',
      lifecycle_stage: 'Lead',
      is_deleted: true,
      created_time: D(T1),
    },
    {
      _id: O(62005),
      id: 'gcon-fixture-000005',
      first_name: 'Kiran',
      mobile_phone_number: '9812345605',
      lifecycle_stage: 'Lead',
      is_deleted: false,
      created_time: D(T1),
    },
  ];
  for (let i = 0; i < bulk; i++) {
    contacts.push({
      _id: O(63000 + i),
      id: `gcon-bulk-${String(i).padStart(7, '0')}`,
      first_name: `Gx${i}`,
      email: `gx${i}@example.test`,
      mobile_phone_number: `+4420718${String(30000 + i).slice(-5)}`,
      lifecycle_stage: 'Lead',
      whatsapp_subscription_status: 'Yes',
      created_time: D(T1),
      is_deleted: false,
    });
  }
  write(root, c, 'contact_list', contacts);
  write(root, c, 'contact_notes', [
    {
      _id: next(),
      id: 'gnote-fixture-00000001',
      contact_id: 'gcon-fixture-000001',
      context: 'Wants a quote',
      created_at: D(T1),
      updated_at: D(T1),
      is_deleted: false,
    },
  ]);
  write(root, c, 'broadcast_templates', [
    {
      _id: next(),
      id: 'gtpl-fixture-00001',
      meta_template_id: '900000000000101',
      type: 'whatsapp',
      created_time: D(T1),
      modified_time: D(T2),
      status: 'APPROVED',
      template_type: 'none',
      name: 'gx_hello',
      category: 'MARKETING',
      language: 'en_US',
      components: [{ type: 'BODY', text: 'Hi' }],
    },
  ]);
  write(root, c, 'field_history', [{ _id: next(), contact_id: O(62001), field: 'x' }]);
  write(root, c, 'contact_task_config', [{ _id: next(), action: 'call' }]);
  write(root, c, 'email_broadcasting_data', []);
}

export function writeFixtures(root: string, opts: FixtureOptions = {}): void {
  const bulk = opts.bulk ?? 25;
  acme(root, bulk);
  globex(root, Math.max(3, Math.floor(bulk / 2)));
  if (opts.access) {
    const docs = accessFixtures();
    for (const [client, colls] of Object.entries(docs))
      for (const [collection, list] of Object.entries(colls)) write(root, client, collection, list);
  }
}

// --- roles, permissions and users (INVENTED; shapes mirror the masked pilot profiles) --------------------------------------------------

export const OWNER_EMAIL = 'owner@example.test';
/** A fake Django-style hash: any occurrence of it in the target is a leak. */
export const FAKE_HASH = 'pbkdf2_sha256$260000$invSALT01$invHASHinvHASHinvHASHinvHASHinvHASH01=';

const perm = (id: string, name: string, on: boolean, crud: J | null): J => ({
  id,
  name,
  is_accessible: on,
  has_crud: crud !== null,
  ...(crud ?? {}),
});
const MENU = (): J => ({
  email_broadcast_sidebar_menu: [{ k: 'a' }],
  subscription_sidebar_menu: [{ k: 'b' }],
  left_top_menu_options: [{ k: 'c' }],
  setting_menu_options: [{ k: 'd' }],
  bot_builder_tabs_options: [],
  left_bottom_menu_options: [],
  whatsapp_broadcast_sidebar_menu: [],
  sms_broadcast_sidebar_menu: [],
});
const role = (n: number, id: string, name: string, label: string, extra: J = {}): J => ({
  _id: O(n),
  id,
  name,
  label,
  created_time: D(T1),
  modified_time: D(T2),
  deleted_time: null,
  is_deleted: false,
  menu_items: MENU(),
  permission_config: [],
  ...extra,
});
const user = (n: number, userId: string | null, email: string | null, extra: J = {}): J => ({
  _id: O(n),
  ...(email === null ? {} : { email }),
  username: email ?? `u${n}`,
  first_name: 'First',
  last_name: `User${n}`,
  is_staff: false,
  is_active: true,
  date_joined: D('2026-03-05T09:00:00.000Z'),
  is_deleted: false,
  deleted_time: null,
  phone: null,
  gender: null,
  business_id: 'b1b1b1b1-0000-4000-8000-000000000001',
  is_email_verified: true,
  is_phone_verified: false,
  created_time: D(T1),
  modified_time: D(T2),
  ...(userId === null ? {} : { user_id: userId }),
  group_id: '4a4a4a4a4a4a4',
  role_id: 'ROLE_aaaaaaaa',
  module_id: 3,
  workspace_id: 'ws-acme-000000000000000001',
  workspace_enabled: true,
  chat_limit: 10,
  ...extra,
});

/** Every collection the roles/users steps read, for the two fake clients. `acme` has a deleted role and the owner's own email. */
export function accessFixtures(): Record<'acme' | 'globex', Record<string, J[]>> {
  const catalogue = (n0: number, ids: Array<[string, string, string]>): J[] =>
    ids.map(([id, name, label], i) => ({
      _id: O(n0 + i),
      id,
      parent_id: null,
      type: i % 3 === 0 ? 'group' : 'feature',
      position: i === 2 ? '3' : i + 1,
      Label: label,
      name,
      has_crud: id === 'perm_contacts' || id === 'perm_deals',
    }));
  const acmePerms: Array<[string, string, string]> = [
    ['perm_contacts', 'contacts', 'Contacts'],
    ['perm_inbox', 'chat', 'Team Inbox'],
    ['perm_users', 'users', 'Users'],
    ['perm_billing', 'subscription', 'Subscription'],
    ['perm_sms', 'sms', 'SMS Broadcast'],
    ['perm_deals', 'deals', 'Deals'],
    ['perm_appt', 'appointments', 'Appointments'],
    ['perm_ghost', 'ghost', 'Ghost'],
    ['perm_unrev', 'unrev', 'Unreviewed'],
  ];
  const readOnly = { create: false, read: true, update: false, delete: false };
  const superRole = role(80001, 'ROLE_aaaaaaaa', 'Super', 'Super User', {
    permission_config: [
      perm('perm_contacts', 'contacts', true, {
        create: true,
        read: true,
        update: true,
        delete: false,
      }),
      perm('perm_inbox', 'chat', true, null),
      perm('perm_users', 'users', true, null),
      perm('perm_billing', 'subscription', true, null),
      perm('perm_sms', 'sms', true, null),
      perm('perm_deals', 'deals', false, readOnly),
      perm('perm_appt', 'appointments', true, null),
      perm('perm_ghost', 'ghost', true, null),
      perm('perm_unrev', 'unrev', true, null),
      perm('perm_contacts', 'contacts', true, readOnly),
      { agent_summary: true },
      { bot_summary: false },
    ],
  });
  const acmeRoles: J[] = [
    // a preset-mapped role: the grants in the dump are ignored, the approver answers for the preset
    role(80002, 'ROLE_bbbbbbbb', 'Agent', 'Agent', {
      permission_config: [perm('perm_inbox', 'chat', true, null)],
    }),
    superRole,
    role(80003, 'ROLE_cccccccc', 'Old', 'Old role', { is_deleted: true, deleted_time: D(T2) }),
    // a name that equals a preset: stays a custom role, renamed, with no admin power
    role(80004, 'ROLE_dddddddd', 'Admin ', ' Admin ', {
      permission_config: [
        perm('perm_users', 'users', true, null),
        perm('perm_contacts', 'contacts', true, readOnly),
      ],
    }),
    role(80005, 'ROLE_eeeeeeee', 'Empty', '', { permission_config: [] }),
  ];
  const acmeUsers: J[] = [
    user(70001, 'usr-0001', ' Agent.One@Example.test ', {
      first_name: 'Asha',
      last_name: 'Agent',
      role_id: 'ROLE_bbbbbbbb',
      phone: '+919812345601',
      is_phone_verified: true,
      group_id: '12',
    }),
    user(70002, 'usr-0002', 'super.two@example.test', { role_id: 'ROLE_aaaaaaaa', is_staff: true }),
    user(70003, 'usr-0003', 'deleted.role@example.test', { role_id: 'ROLE_cccccccc' }),
    user(70004, 'usr-0004', 'null.role@example.test', { role_id: null }),
    user(70005, 'usr-0005', 'ghost.role@example.test', { role_id: 'ROLE_zzzzzzzz' }),
    user(70006, 'usr-0006', 'int.role@example.test', { role_id: 7, group_id: 7 }),
    // the --owner-email person, with a Waboo role of their own: the Owner row wins, nothing else is created
    user(70007, 'usr-0007', ' OWNER@example.test', {
      first_name: 'Olive',
      last_name: 'Owner',
      role_id: 'ROLE_aaaaaaaa',
      is_staff: true,
    }),
    // the same email as usr-0001 in another case, older: loses
    user(70008, 'usr-0008', 'AGENT.ONE@example.test', {
      modified_time: D('2026-03-02T00:00:00.000Z'),
      role_id: 'ROLE_aaaaaaaa',
    }),
    // is_staff and a role called Admin, no map: a custom role without admin-class keys
    user(70009, 'usr-0009', 'staff.admin@example.test', {
      role_id: 'ROLE_dddddddd',
      is_staff: true,
    }),
    user(70010, 'usr-0010', 'inactive@example.test', { is_active: false }),
    user(70011, 'usr-0011', 'gone@example.test', { is_deleted: true, deleted_time: D(T2) }),
    user(70012, 'usr-0012', 'disabled@example.test', { workspace_enabled: false }),
    user(70013, 'usr-0013', 'not-an-email', {}),
    user(70014, 'usr-0014', 'no.names@example.test', { first_name: '', last_name: '' }),
    user(70015, 'usr-0015', 'bad.phone@example.test', { phone: '12ab' }),
    user(70016, '5', 'five@example.test', {
      role_id: 'ROLE_eeeeeeee',
      contact_list_config: {
        column_sequence: ['name', 'email'],
        columns: [{ key: 'name', visible: true }],
        filter_query: { rule: 'x' },
        mongodb_query: '{"city":"Pune"}',
      },
      marketing_list_config: {
        column_sequence: ['name'],
        columns: [],
        filter_query: {},
        mongodb_query: '{}',
      },
    }),
  ];
  const globexPerms: Array<[string, string, string]> = [
    ['perm_contacts', 'contacts', 'Contacts'],
    ['perm_inbox', 'chat', 'Team Inbox'],
  ];
  const karma = FAKE_HASH.replace('01=', '02=');
  return {
    acme: { available_permissions: catalogue(82500, acmePerms), roles: acmeRoles, user: acmeUsers },
    globex: {
      available_permissions: catalogue(82000, globexPerms),
      roles: [
        role(81001, 'ROLE_gggggggg', 'Sales', 'Sales', {
          permission_config: [perm('perm_contacts', 'contacts', true, readOnly)],
        }),
        role(81002, 'ROLE_hhhhhhhh', 'Support', 'Support', {
          permission_config: [perm('perm_inbox', 'chat', true, null)],
        }),
      ],
      // Karma shape: a password hash on some users, one user with only a username
      user: [
        user(71001, 'gx-0001', 'karma.one@example.test', {
          role_id: 'ROLE_gggggggg',
          password: FAKE_HASH,
          company_list_config: {
            column_sequence: ['name'],
            columns: [],
            filter_query: {},
            mongodb_query: '',
          },
        }),
        user(71002, 'gx-0002', null, {
          username: 'karma.two@example.test',
          role_id: 'ROLE_hhhhhhhh',
          password: karma,
        }),
        user(71003, 'gx-0003', 'karma.three@example.test', { role_id: 'ROLE_hhhhhhhh' }),
      ],
    },
  };
}
