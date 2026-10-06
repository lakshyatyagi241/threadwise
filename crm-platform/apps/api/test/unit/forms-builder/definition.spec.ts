import { describe, expect, it } from 'vitest';
import {
  FORM_LIMITS,
  FORM_PUBLIC_KEY,
  formDefinitionSchema,
  formThemeSchema,
  isSafeFormPattern,
  normaliseFormOrigin,
  formLiveSettingsSchema,
  publicFormSubmitSchema,
  createFormSchema,
  type FormDefinitionInput,
} from '@crm/contracts';
import { FORM_TEMPLATES, blankDefinition } from '../../../src/modules/forms-builder/form-templates';
import { publishProblems } from '../../../src/modules/forms-builder/form-definition-rules';

const field = (over: Record<string, unknown> = {}) => ({
  id: 'name',
  type: 'field',
  kind: 'short_text',
  label: 'Name',
  ...over,
});
const def = (blocks: unknown[], extra: Record<string, unknown> = {}): FormDefinitionInput =>
  ({ title: 'T', steps: [{ id: 's1', blocks }], ...extra }) as FormDefinitionInput;
const issues = (input: unknown) => {
  const r = formDefinitionSchema.safeParse(input);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}:${i.message}`);
};

describe('form definition schema (spec section 5)', () => {
  it('fills every default and accepts a minimal form', () => {
    const d = formDefinitionSchema.parse(def([field()]));
    expect(d.schemaVersion).toBe(1);
    expect(d.settings.submitLabel).toBe('Submit');
    expect(d.theme.primary).toBe('#2563eb');
    expect(d.consent.enabled).toBe(false);
    expect(d.mapping.company.match).toBe('name_or_domain');
    expect(d.steps[0]?.blocks[0]).toMatchObject({ required: false, width: 'full' });
  });

  it('refuses an unknown key anywhere: no place for script, CSS or HTML exists', () => {
    expect(issues(def([field({ style: 'x' })]))).not.toEqual([]);
    expect(issues({ ...def([field()]), css: 'body{}' })).not.toEqual([]);
    expect(issues(def([field()], { theme: { primary: '#ffffff', customCss: 'x' } }))).not.toEqual(
      [],
    );
  });

  it('allows one step and no rules in v0.9, and says why', () => {
    expect(
      issues({
        title: 'T',
        steps: [
          { id: 'a', blocks: [] },
          { id: 'b', blocks: [] },
        ],
      }),
    ).toContain('steps:Multi-step forms arrive in a later version');
    expect(issues({ ...def([field()]), rules: [{}] })).not.toEqual([]);
  });

  it('refuses duplicate ids, duplicate options and a duplicate bind', () => {
    expect(issues(def([field(), field()]))).toContain('steps.0.blocks.1.id:duplicate_id');
    expect(
      issues(
        def([
          field({
            id: 'p',
            kind: 'dropdown',
            options: [
              { value: 'a', label: 'A' },
              { value: 'a', label: 'B' },
            ],
          }),
        ]),
      ),
    ).toContain('steps.0.blocks.0.options.1.value:duplicate_option');
    const bind = { object: 'contact', property: 'email' };
    expect(issues(def([field({ id: 'a', bind }), field({ id: 'b', bind })]))).toContain(
      'steps.0.blocks.1.bind:duplicate_bind',
    );
  });

  it('needs options for a choice field and refuses them on any other', () => {
    expect(issues(def([field({ kind: 'radio' })]))).toContain(
      'steps.0.blocks.0.options:options_required',
    );
    expect(issues(def([field({ options: [{ value: 'a', label: 'A' }] })]))).toContain(
      'steps.0.blocks.0.options:options_not_allowed',
    );
  });

  it('keeps a hidden field honest: it needs a source, a constant needs a value, and it is never required', () => {
    expect(issues(def([field({ kind: 'hidden' })]))).toContain(
      'steps.0.blocks.0.hiddenSource:hidden_source_required',
    );
    expect(issues(def([field({ kind: 'hidden', hiddenSource: 'constant' })]))).toContain(
      'steps.0.blocks.0.constant:constant_required',
    );
    expect(
      issues(def([field({ kind: 'hidden', hiddenSource: 'referrer', required: true })])),
    ).toContain('steps.0.blocks.0.required:hidden_cannot_be_required');
  });

  it('requires an https redirect and refuses javascript: and data: addresses', () => {
    const redirect = (url?: string) =>
      def([field()], {
        settings: { successMode: 'redirect', ...(url ? { redirectUrl: url } : {}) },
      });
    expect(issues(redirect())).toContain('settings.redirectUrl:redirect_url_required');
    expect(issues(redirect('javascript:alert(1)'))).not.toEqual([]);
    expect(issues(redirect('http://example.com'))).not.toEqual([]);
    expect(issues(redirect('https://example.com/thanks'))).toEqual([]);
  });

  it('holds the block, option, label and size limits', () => {
    const many = Array.from({ length: FORM_LIMITS.maxBlocks + 1 }, (_, i) =>
      field({ id: `f${i}` }),
    );
    expect(issues(def(many)).length).toBeGreaterThan(0);
    expect(issues(def([field({ label: 'x'.repeat(FORM_LIMITS.maxLabel + 1) })]))).not.toEqual([]);
    const opts = Array.from({ length: FORM_LIMITS.maxOptions + 1 }, (_, i) => ({
      value: `v${i}`,
      label: 'L',
    }));
    expect(issues(def([field({ kind: 'dropdown', options: opts })]))).not.toEqual([]);
  });

  it('accepts only a closed set of theme tokens with valid values', () => {
    expect(formThemeSchema.safeParse({ primary: 'red' }).success).toBe(false);
    expect(formThemeSchema.safeParse({ primary: '#ff0000', radius: 'huge' }).success).toBe(false);
    expect(formThemeSchema.safeParse({ backgroundImage: 'http://x.example/a.png' }).success).toBe(
      false,
    );
    expect(formThemeSchema.safeParse({ fontScale: 3 }).success).toBe(false);
    expect(formThemeSchema.safeParse({ backgroundImage: 'https://x.example/a.png' }).success).toBe(
      true,
    );
  });
});

describe('regular expression guard', () => {
  it('refuses backreferences, lookaround, nested repeats and over-long patterns', () => {
    for (const p of [
      '(a)\\1',
      '(?=a)a',
      '(?<!a)b',
      '^(a+)+$',
      '^(a*)*$',
      'x'.repeat(201),
      '(',
      '',
    ]) {
      expect(isSafeFormPattern(p), p).toBe(false);
    }
    for (const p of ['^[0-9]{5}$', '^[A-Z]{2}[0-9]+$', '^\\+?[0-9 ]{7,15}$']) {
      expect(isSafeFormPattern(p), p).toBe(true);
    }
  });
});

describe('embed origins (spec 7.3)', () => {
  it('normalises exact origins and one wildcard level, never a bare star', () => {
    expect(normaliseFormOrigin('HTTPS://Example.com/')).toBe('https://example.com');
    expect(normaliseFormOrigin('https://example.com:8443')).toBe('https://example.com:8443');
    expect(normaliseFormOrigin('https://*.example.com')).toBe('https://*.example.com');
    for (const bad of [
      '*',
      'https://*',
      'https://example.com/path',
      'http://example.com',
      'ftp://example.com',
      'https://*.com',
      'example.com',
      '',
    ]) {
      expect(normaliseFormOrigin(bad), bad).toBeNull();
    }
    expect(normaliseFormOrigin('http://localhost:3000')).toBe('http://localhost:3000');
  });

  it('settings carry normalised origins and cap the list', () => {
    expect(
      formLiveSettingsSchema.parse({ allowedOrigins: ['HTTPS://A.example.com/'] }).allowedOrigins,
    ).toEqual(['https://a.example.com']);
    expect(formLiveSettingsSchema.safeParse({ allowedOrigins: ['*'] }).success).toBe(false);
    expect(
      formLiveSettingsSchema.safeParse({
        allowedOrigins: Array.from({ length: 21 }, (_, i) => `https://a${i}.example.com`),
      }).success,
    ).toBe(false);
  });

  it('settings: owner rule shapes and retention bounds', () => {
    const u = '3f2b8f0e-7c2a-4f0a-9a52-1d6c5a1e8b11';
    expect(
      formLiveSettingsSchema.safeParse({ ownerRule: { mode: 'fixed', userIds: [u] } }).success,
    ).toBe(true);
    expect(
      formLiveSettingsSchema.safeParse({ ownerRule: { mode: 'fixed', userIds: [] } }).success,
    ).toBe(false);
    expect(
      formLiveSettingsSchema.safeParse({ ownerRule: { mode: 'round_robin', userIds: [u] } })
        .success,
    ).toBe(false);
    expect(formLiveSettingsSchema.safeParse({ retentionDays: 10 }).success).toBe(false);
    expect(formLiveSettingsSchema.parse({ retentionDays: null }).retentionDays).toBeNull();
    expect(formLiveSettingsSchema.parse({}).retentionDays).toBe(365);
  });
});

describe('public contracts', () => {
  it('the public key is 22 letters and digits', () => {
    expect(FORM_PUBLIC_KEY.test('aB3dE5gH7jK9mN1pQ3sT5v')).toBe(true);
    expect(FORM_PUBLIC_KEY.test('short')).toBe(false);
    expect(FORM_PUBLIC_KEY.test('aB3dE5gH7jK9mN1pQ3sT5v!')).toBe(false);
  });

  it('a submit needs an idempotency key of a sane shape and clips the rest', () => {
    expect(publicFormSubmitSchema.safeParse({ idempotencyKey: 'short' }).success).toBe(false);
    expect(publicFormSubmitSchema.safeParse({ idempotencyKey: 'abcdefgh1234' }).success).toBe(true);
    expect(
      publicFormSubmitSchema.safeParse({
        idempotencyKey: 'abcdefgh1234',
        hidden: { utm_source: 'x'.repeat(300) },
      }).success,
    ).toBe(false);
  });

  it('create takes a template or a definition, not both', () => {
    const d = formDefinitionSchema.parse(def([field()]));
    expect(
      createFormSchema.safeParse({ name: 'A', templateKey: 'lead-capture', definition: d }).success,
    ).toBe(false);
    expect(createFormSchema.safeParse({ name: 'A', templateKey: 'lead-capture' }).success).toBe(
      true,
    );
  });
});

describe('the template gallery', () => {
  const ctx = {
    contactProps: new Map(),
    companyProps: new Map(),
    contactRequired: [],
    stageUsable: () => true,
  };

  it('has the five starting points of the spec', () => {
    expect(FORM_TEMPLATES.map((t) => t.key)).toEqual([
      'lead-capture',
      'contact-us',
      'event-registration',
      'order-request',
      'survey',
    ]);
  });

  it.each(FORM_TEMPLATES.map((t) => [t.key, t] as const))(
    '%s is a valid form that can be published as it stands',
    (_key, t) => {
      expect(formDefinitionSchema.safeParse(t.definition).success).toBe(true);
      expect(publishProblems(t.definition, ctx)).toEqual([]);
    },
  );

  it('a blank form lands a contact: a name and an email', () => {
    const d = blankDefinition('My form');
    expect(d.title).toBe('My form');
    expect(publishProblems(d, ctx)).toEqual([]);
  });
});
