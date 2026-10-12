import type {
  AssigneeResponse,
  ContactResponse,
  FieldOptionResponse,
  FieldResponse,
  SessionResponse,
  StatusOptionResponse,
} from '@crm/contracts';
import { aarav, sessionFull } from './contacts-fixtures';

/** Realistic answers of the property, status-option and assignee endpoints, for tests. Fake names and values only. */

const uuid = (n: number) =>
  `${String(n).padStart(8, '0')}-0000-4000-8000-${String(n).padStart(12, '0')}`;

const stamp = '2026-09-01T08:00:00.000Z';

let nextFieldId = 100;

/** A property definition with every flag off; a test names only what it cares about. */
export function field(
  overrides: Partial<FieldResponse> & Pick<FieldResponse, 'key' | 'label' | 'fieldType'>,
): FieldResponse {
  nextFieldId += 1;
  return {
    id: uuid(nextFieldId),
    moduleKey: 'contacts',
    sectionId: null,
    isRequired: false,
    isHidden: false,
    isReadOnly: false,
    isMasked: false,
    isUnique: false,
    isQuickCreate: false,
    isGlobalSearch: false,
    isSystem: false,
    isActive: true,
    position: nextFieldId,
    config: {},
    replacesFieldId: null,
    rowVersion: 1,
    createdAt: stamp,
    updatedAt: stamp,
    ...overrides,
  };
}

let nextOptionId = 5000;

export function option(
  fieldId: string,
  value: string,
  label: string,
  position: number,
  isHidden = false,
): FieldOptionResponse {
  nextOptionId += 1;
  return {
    id: uuid(nextOptionId),
    fieldId,
    value,
    label,
    position,
    isHidden,
    rowVersion: 1,
  };
}

const planField = field({ key: 'plan', label: 'Plan', fieldType: 'select' });
const interestsField = field({ key: 'interests', label: 'Interests', fieldType: 'multiselect' });

export const cityField = field({ key: 'city', label: 'City', fieldType: 'text' });
export const vipField = field({ key: 'vip', label: 'VIP customer', fieldType: 'checkbox' });
export const budgetField = field({
  key: 'budget',
  label: 'Budget',
  fieldType: 'currency',
  config: { code: 'INR' },
});
export const visitsField = field({ key: 'visits', label: 'Visits', fieldType: 'integer' });
export const discountField = field({ key: 'discount', label: 'Discount', fieldType: 'percentage' });
export const notesField = field({ key: 'notes', label: 'Notes', fieldType: 'long_text' });
export const birthdayField = field({ key: 'birthday', label: 'Birthday', fieldType: 'date' });
export const nextVisitField = field({
  key: 'next_visit',
  label: 'Next visit',
  fieldType: 'datetime',
});
export const websiteField = field({ key: 'website', label: 'Website', fieldType: 'url' });
export const workEmailField = field({ key: 'work_email', label: 'Work email', fieldType: 'email' });
export const landlineField = field({ key: 'landline', label: 'Landline', fieldType: 'phone' });
export const ratingField = field({
  key: 'happiness',
  label: 'Happiness',
  fieldType: 'rating',
  config: { max: 5 },
});
export const gstField = field({
  key: 'gst_no',
  label: 'GST number',
  fieldType: 'text',
  isRequired: true,
});
export const planSelect: FieldResponse = {
  ...planField,
  options: [
    option(planField.id, 'basic', 'Basic', 1),
    option(planField.id, 'pro', 'Pro', 2),
    option(planField.id, 'legacy', 'Legacy plan', 3, true),
  ],
};
export const interestsMulti: FieldResponse = {
  ...interestsField,
  options: [
    option(interestsField.id, 'sports', 'Sports', 1),
    option(interestsField.id, 'music', 'Music', 2),
    option(interestsField.id, 'travel', 'Travel', 3),
  ],
};
export const taxIdField = field({
  key: 'tax_id',
  label: 'Tax ID',
  fieldType: 'text',
  isReadOnly: true,
});
export const scoreFormula = field({
  key: 'total',
  label: 'Total',
  fieldType: 'formula',
  config: { expression: 'a+b' },
});
export const secretField = field({
  key: 'secret',
  label: 'Secret',
  fieldType: 'text',
  isMasked: true,
});
export const systemField = field({
  key: 'sys',
  label: 'System note',
  fieldType: 'text',
  isSystem: true,
});
export const hiddenField = field({
  key: 'internal',
  label: 'Internal',
  fieldType: 'text',
  isHidden: true,
});
export const retiredField = field({
  key: 'old',
  label: 'Retired',
  fieldType: 'text',
  isActive: false,
});
export const linkField = field({ key: 'account', label: 'Account', fieldType: 'lookup' });

/** What the workspace's property list answers: a mix of every type, plus the ones that must stay out of sight. */
export const fieldDefinitions: FieldResponse[] = [
  cityField,
  vipField,
  budgetField,
  visitsField,
  discountField,
  notesField,
  birthdayField,
  nextVisitField,
  planSelect,
  interestsMulti,
  websiteField,
  workEmailField,
  landlineField,
  ratingField,
  taxIdField,
  scoreFormula,
  secretField,
  systemField,
  hiddenField,
  retiredField,
  linkField,
];

export const priya: AssigneeResponse = {
  id: '77777777-7777-4777-8777-777777777771',
  fullName: 'Priya Nair',
  email: 'priya@example.test',
};
export const rohan: AssigneeResponse = {
  id: '77777777-7777-4777-8777-777777777772',
  fullName: 'Rohan Das',
  email: 'rohan@example.test',
};
export const assignees: AssigneeResponse[] = [priya, rohan];

/** A contact with a value for most of the properties above and Priya as its owner. */
export const profile: ContactResponse = {
  ...aarav,
  ownerId: priya.id,
  customFields: {
    city: 'Pune',
    vip: true,
    budget: 150000,
    visits: 3,
    discount: 12.5,
    notes: 'Prefers calls after 6 pm',
    birthday: '2026-10-12',
    next_visit: '2026-11-03T14:30',
    plan: 'pro',
    interests: ['sports', 'travel'],
    website: 'https://example.test',
    tax_id: 'TX-1',
    total: 42,
    secret: 'hunter2',
    sys: 'managed',
    internal: 'staff only',
    old: 'retired value',
    account: 'acc-1',
    stray: 'kept',
  },
};

/** A contact with none of the custom values, no owner and no last activity. */
export const bare: ContactResponse = {
  ...aarav,
  ownerId: null,
  lastActivityAt: null,
  leadScore: null,
  source: null,
  whatsappSubscriptionStatus: null,
  customFields: {},
};

const stageOption = (
  n: number,
  value: string,
  label: string,
  extra: Partial<StatusOptionResponse> = {},
): StatusOptionResponse => ({
  id: uuid(200 + n),
  moduleKey: 'contacts',
  optionGroup: 'lifecycle_stage',
  value,
  label,
  color: null,
  position: n,
  isDefault: n === 1,
  isActive: true,
  isWon: false,
  isLost: false,
  stageOptionId: null,
  rowVersion: 1,
  ...extra,
});

export const stageNew = stageOption(1, 'new', 'New lead');
export const stageQualified = stageOption(2, 'qualified', 'Qualified');
export const stageLost = stageOption(3, 'lost', 'Lost', { isLost: true });
export const stageEnrolled = stageOption(4, 'enrolled', 'Enrolled', { isWon: true });

const statusOption = (
  n: number,
  value: string,
  label: string,
  extra: Partial<StatusOptionResponse> = {},
): StatusOptionResponse => ({
  ...stageOption(n, value, label, extra),
  id: uuid(300 + n),
  optionGroup: 'status',
  isDefault: false,
});

/** Valid in every stage. */
export const statusOpen = statusOption(1, 'Open', 'Open');
/** Valid only in the qualified stage. */
export const statusHot = statusOption(2, 'Hot', 'Hot lead', { stageOptionId: stageQualified.id });
/** Valid only in the lost stage. */
export const statusClosed = statusOption(3, 'Closed', 'Closed', { stageOptionId: stageLost.id });
export const statusRetired = statusOption(4, 'Retired', 'Retired', { isActive: false });

export const reasonPrice: StatusOptionResponse = {
  ...stageOption(1, 'too_expensive', 'Too expensive'),
  id: uuid(400),
  optionGroup: 'lost_reason',
  isDefault: false,
};
export const reasonCompetitor: StatusOptionResponse = {
  ...reasonPrice,
  id: uuid(401),
  value: 'went_to_competitor',
  label: 'Went to a competitor',
  position: 2,
};

export const statusOptions: StatusOptionResponse[] = [
  stageNew,
  stageQualified,
  stageLost,
  stageEnrolled,
  statusOpen,
  statusHot,
  statusClosed,
  statusRetired,
  reasonPrice,
  reasonCompetitor,
];

const withProperties = (base: SessionResponse, extra: Record<string, 'all'>): SessionResponse => ({
  ...base,
  permissions: { ...base.permissions, ...extra },
});

/** May read and update contacts and read the property definitions and options. */
export const sessionProps: SessionResponse = withProperties(sessionFull, {
  'record.contact-properties.read': 'all',
});

/** May read contacts and the definitions, but not update. */
export const sessionPropsReadOnly: SessionResponse = {
  ...sessionProps,
  permissions: { 'record.contacts.read': 'all', 'record.contact-properties.read': 'all' },
};
