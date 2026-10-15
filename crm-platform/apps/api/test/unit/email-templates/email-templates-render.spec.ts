import { describe, expect, it } from 'vitest';
import {
  createEmailTemplateSchema,
  escapeEmailHtml,
  fillEmailTemplate,
  oneHeaderLine,
  sampleEmailVariableLookup,
  templateVariablesIn,
  updateEmailTemplateSchema,
  EMAIL_TEMPLATE_VARIABLES,
} from '@crm/contracts';
import {
  buildLookup,
  canChange,
  isUniqueViolation,
  scopeOf,
} from '../../../src/modules/email-templates/email-templates.rules';

const BASE = {
  attributeDefaults: new Map<string, string | null>(),
  system: { today: '2026-12-02', businessName: 'Acme Support', companyName: 'Acme Support' },
};
const contact = (over: Record<string, unknown> = {}) =>
  ({
    name: 'Amira Khan',
    firstName: 'Amira',
    lastName: 'Khan',
    email: 'amira@example.com',
    phone: '971500000000',
    groups: [],
    customAttributes: {},
    ...over,
  }) as never;

describe('fillEmailTemplate', () => {
  const lookup = (map: Record<string, string | null | undefined>) => (key: string) => map[key];

  it('fills known variables, in any spelling the merge tags accept', () => {
    const out = fillEmailTemplate(
      'Hi {{first_name}}, {{ Contact.Last Name }}!',
      'text',
      lookup({ first_name: 'Amira', last_name: 'Khan' }),
    );
    expect(out.text).toBe('Hi Amira, Khan!');
    expect(out.issues).toEqual([]);
  });

  it('escapes a value in the HTML body, so a contact name is text and never markup', () => {
    const out = fillEmailTemplate(
      '<p>Hi {{first_name}}</p>',
      'html',
      lookup({ first_name: '<img src=x onerror=alert(1)> & "co"' }),
    );
    expect(out.text).toBe('<p>Hi &lt;img src=x onerror=alert(1)&gt; &amp; &quot;co&quot;</p>');
    expect(out.text).not.toContain('<img');
  });

  it('flattens a value in the subject to one line (a name with a newline cannot start a second header)', () => {
    const out = fillEmailTemplate(
      'Hello {{first_name}}',
      'subject',
      lookup({ first_name: 'Eve\r\nBcc: spy@evil.test' }),
    );
    expect(out.text).not.toMatch(/[\r\n]/);
    expect(out.text).toBe('Hello Eve Bcc: spy@evil.test');
  });

  it('leaves a variable without a value as written and says why', () => {
    const out = fillEmailTemplate(
      '{{first_name}} {{nope}} {{city}}',
      'text',
      lookup({ first_name: '', city: null }),
    );
    expect(out.text).toBe('{{first_name}} {{nope}} {{city}}');
    expect(out.issues).toEqual([
      { token: '{{first_name}}', key: 'first_name', reason: 'empty' },
      { token: '{{nope}}', key: 'nope', reason: 'unknown' },
      { token: '{{city}}', key: 'city', reason: 'empty' },
    ]);
  });

  it('lists a repeated problem once', () => {
    const out = fillEmailTemplate('{{x}} {{x}}', 'text', () => undefined);
    expect(out.issues).toHaveLength(1);
  });

  it('previews with the sample values, never inventing one for a custom attribute', () => {
    const out = fillEmailTemplate(
      '{{first_name}} / {{workspace_name}} / {{custom_thing}}',
      'text',
      sampleEmailVariableLookup,
    );
    expect(out.text).toBe('Amira / Acme Support / {{custom_thing}}');
    expect(out.issues.map((i) => i.reason)).toEqual(['unknown']);
  });
});

describe('helpers', () => {
  it('escapeEmailHtml escapes the five markup characters', () => {
    expect(escapeEmailHtml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;',
    );
  });

  it('oneHeaderLine removes control characters and line separators', () => {
    expect(oneHeaderLine('a\r\nb' + String.fromCharCode(0x2028) + 'c\u0007d  ')).toBe('a b c d');
  });

  it('templateVariablesIn reports each variable once, canonical, subject first', () => {
    expect(
      templateVariablesIn('Hi {{First Name}}', '<p>{{first_name}} {{ email }} {{agent.name}}</p>'),
    ).toEqual(['first_name', 'email', 'agent_name']);
  });

  it('the picker offers no conversation (device) variables', () => {
    expect(EMAIL_TEMPLATE_VARIABLES.some((v) => v.key.startsWith('device_'))).toBe(false);
    expect(EMAIL_TEMPLATE_VARIABLES.map((v) => v.group)).not.toContain('conversation');
  });
});

describe('buildLookup', () => {
  it('takes agent and workspace values from the server and contact values from the contact', () => {
    const look = buildLookup({
      contact: contact(),
      base: BASE,
      peerName: 'Someone Else',
      agentName: 'Sam Rivera',
    });
    expect(look('agent_name')).toBe('Sam Rivera');
    expect(look('agent_first_name')).toBe('Sam');
    expect(look('workspace_name')).toBe('Acme Support');
    expect(look('first_name')).toBe('Amira');
    expect(look('email')).toBe('amira@example.com');
  });

  it('falls back to the name the customer wrote under when the thread has no contact yet', () => {
    const look = buildLookup({
      contact: undefined,
      base: BASE,
      peerName: 'Bob Customer',
      agentName: null,
    });
    expect(look('first_name')).toBe('Bob');
    expect(look('name')).toBe('Bob Customer');
    expect(look('agent_name')).toBe('');
  });

  it('a real variable with no value is empty, an unknown name is undefined', () => {
    const look = buildLookup({
      contact: undefined,
      base: BASE,
      peerName: null,
      agentName: null,
    });
    expect(look('email')).toBe('');
    expect(look('no_such_variable')).toBeUndefined();
    expect(look('device_name')).toBeUndefined();
  });
});

describe('who may change a template', () => {
  it('a shared template needs the manage right; a personal one is its owner only', () => {
    expect(canChange({ userId: null }, { userId: 1, canManage: true })).toBe(true);
    expect(canChange({ userId: null }, { userId: 1, canManage: false })).toBe(false);
    expect(canChange({ userId: 1 }, { userId: 1, canManage: false })).toBe(true);
    expect(canChange({ userId: 1 }, { userId: 2, canManage: true })).toBe(false);
    expect(scopeOf({ userId: null })).toBe('shared');
    expect(scopeOf({ userId: 4 })).toBe('mine');
  });

  it('recognises a unique violation however the driver wrapped it', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
    expect(isUniqueViolation({ cause: { code: '23505' } })).toBe(true);
    expect(isUniqueViolation(new Error('x'))).toBe(false);
  });
});

describe('the input schemas', () => {
  const ok = { name: ' Welcome ', bodyHtml: '<p>Hello</p>' };

  it('create trims the name and defaults to a shared, general template with no subject', () => {
    expect(createEmailTemplateSchema.parse(ok)).toMatchObject({
      name: 'Welcome',
      subject: '',
      bodyText: '',
      purpose: 'general',
      scope: 'shared',
    });
  });

  it('refuses an empty name or body, a multi-line subject, an unknown purpose and a too long name', () => {
    expect(createEmailTemplateSchema.safeParse({ ...ok, name: '  ' }).success).toBe(false);
    expect(createEmailTemplateSchema.safeParse({ ...ok, bodyHtml: '  ' }).success).toBe(false);
    expect(createEmailTemplateSchema.safeParse({ ...ok, subject: 'a\nb' }).success).toBe(false);
    expect(createEmailTemplateSchema.safeParse({ ...ok, purpose: 'spam' }).success).toBe(false);
    expect(createEmailTemplateSchema.safeParse({ ...ok, name: 'x'.repeat(121) }).success).toBe(
      false,
    );
  });

  it('update needs the rowVersion and at least one change', () => {
    expect(updateEmailTemplateSchema.safeParse({ name: 'x' }).success).toBe(false);
    expect(updateEmailTemplateSchema.safeParse({ rowVersion: 1 }).success).toBe(false);
    expect(updateEmailTemplateSchema.safeParse({ rowVersion: 1, status: 'archived' }).success).toBe(
      true,
    );
  });
});
