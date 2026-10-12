import { describe, expect, it } from 'vitest';
import {
  canonicalVariableKey,
  createSavedReplySchema,
  listSavedRepliesQuerySchema,
  normalizeShortcut,
  renderSavedReply,
  sampleVariableLookup,
  updateSavedReplySchema,
  variablesIn,
} from '@crm/contracts';
import {
  allowedOnChannel,
  buildLookup,
  canChange,
  isUniqueViolation,
  isVisibleTo,
  scopeOf,
  type RenderFacts,
} from '../../../src/modules/team-inbox-conversations/saved-replies/saved-reply-rules';

describe('shortcut normaliser', () => {
  it('matches the slug Reference made: lower case, underscores, no slash', () => {
    expect(normalizeShortcut('Thank You')).toBe('thank_you');
    expect(normalizeShortcut('/Thank-You!')).toBe('thank_you');
    expect(normalizeShortcut('  hello   world  ')).toBe('hello_world');
    expect(normalizeShortcut('a/b\\c')).toBe('a_bc');
    expect(normalizeShortcut('__x__')).toBe('x');
  });

  it('keeps letters of every script and drops symbols', () => {
    expect(normalizeShortcut('مرحبا بك')).toBe('مرحبا_بك');
    expect(normalizeShortcut('café ☕')).toBe('café');
    expect(normalizeShortcut('ＡＢＣ')).toBe('abc');
  });

  it('is empty when nothing usable is left, and capped at 64 characters', () => {
    expect(normalizeShortcut('!!! ///')).toBe('');
    expect(normalizeShortcut('x'.repeat(100))).toHaveLength(64);
    expect(normalizeShortcut(`${'x'.repeat(63)} y`)).toBe('x'.repeat(63));
  });

  it('is idempotent', () => {
    for (const raw of ['Thank You', '/Hi There', 'مرحبا بك', 'Q&A']) {
      expect(normalizeShortcut(normalizeShortcut(raw))).toBe(normalizeShortcut(raw));
    }
  });
});

describe('request schemas', () => {
  const ok = { shortcut: 'Thank You', title: ' Thanks ', body: ' Thanks, {{first_name}}! ' };

  it('create normalises the shortcut, trims, and defaults to a shared reply', () => {
    const parsed = createSavedReplySchema.parse(ok);
    expect(parsed).toMatchObject({
      shortcut: 'thank_you',
      title: 'Thanks',
      body: 'Thanks, {{first_name}}!',
      category: null,
      language: null,
      channelKinds: [],
      scope: 'shared',
    });
  });

  it('refuses an empty shortcut, an over-long body or title, control characters and unknown fields', () => {
    expect(createSavedReplySchema.safeParse({ ...ok, shortcut: '///' }).success).toBe(false);
    expect(createSavedReplySchema.safeParse({ ...ok, body: 'x'.repeat(4001) }).success).toBe(false);
    expect(createSavedReplySchema.safeParse({ ...ok, body: 'x'.repeat(4000) }).success).toBe(true);
    expect(createSavedReplySchema.safeParse({ ...ok, title: 'x'.repeat(129) }).success).toBe(false);
    expect(createSavedReplySchema.safeParse({ ...ok, body: 'a\u0000b' }).success).toBe(false);
    expect(createSavedReplySchema.safeParse({ ...ok, userId: 5 }).success).toBe(false);
    expect(createSavedReplySchema.safeParse({ ...ok, scope: 'team' }).success).toBe(false);
  });

  it('keeps markup as text: nothing is stripped or interpreted', () => {
    const parsed = createSavedReplySchema.parse({
      ...ok,
      body: '*bold* _it_ <b>x</b> <script>1</script>',
    });
    expect(parsed.body).toBe('*bold* _it_ <b>x</b> <script>1</script>');
  });

  it('update needs the row version, takes a subset, and cannot change the scope', () => {
    expect(updateSavedReplySchema.safeParse({ title: 'x' }).success).toBe(false);
    expect(updateSavedReplySchema.safeParse({ rowVersion: 1, title: 'x' }).success).toBe(true);
    expect(updateSavedReplySchema.safeParse({ rowVersion: 1, scope: 'mine' }).success).toBe(false);
    expect(updateSavedReplySchema.parse({ rowVersion: 2, shortcut: '/Hi' }).shortcut).toBe('hi');
  });

  it('channel kinds are de-duplicated and checked', () => {
    expect(
      createSavedReplySchema.parse({ ...ok, channelKinds: ['whatsapp_cloud', 'whatsapp_cloud'] })
        .channelKinds,
    ).toEqual(['whatsapp_cloud']);
    expect(
      createSavedReplySchema.safeParse({ ...ok, channelKinds: ['carrier_pigeon'] }).success,
    ).toBe(false);
  });

  it('the list query defaults to every visible reply, 50 a page', () => {
    expect(listSavedRepliesQuerySchema.parse({})).toMatchObject({ scope: 'all', limit: 50 });
    expect(listSavedRepliesQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
  });
});

describe('variables', () => {
  it('canonical keys accept dotted, spaced and aliased spellings', () => {
    expect(canonicalVariableKey('contact.first_name')).toBe('first_name');
    expect(canonicalVariableKey(' Contact.First Name ')).toBe('first_name');
    expect(canonicalVariableKey('Full Name')).toBe('name');
    expect(canonicalVariableKey('agent.name')).toBe('agent_name');
    expect(canonicalVariableKey('workspace.name')).toBe('workspace_name');
    expect(canonicalVariableKey('company.name')).toBe('company_name');
    expect(canonicalVariableKey('device.phone')).toBe('device_phone');
    expect(canonicalVariableKey('city')).toBe('city');
  });

  it('variablesIn lists each variable once, in order', () => {
    expect(variablesIn('Hi {{first_name}}, {{ contact.name }} {{first_name}} {{}}')).toEqual([
      'first_name',
      'name',
    ]);
  });

  it('renders known variables and leaves unknown and empty ones visible and flagged, never dropped', () => {
    const lookup = (key: string) =>
      ({ first_name: 'Amira', last_name: '', device_name: 'Sales' })[key] as string | undefined;
    const { text, issues } = renderSavedReply(
      'Hi {{first_name}} {{last_name}} on {{ device.name }}. {{no_such_thing}} {{no_such_thing}}',
      lookup,
    );
    expect(text).toBe('Hi Amira {{last_name}} on Sales. {{no_such_thing}} {{no_such_thing}}');
    expect(issues).toEqual([
      { token: '{{last_name}}', key: 'last_name', reason: 'empty' },
      { token: '{{no_such_thing}}', key: 'no_such_thing', reason: 'unknown' },
    ]);
  });

  it('a body without variables comes back untouched, and a lone brace is text', () => {
    expect(renderSavedReply('Thanks {not a variable} {{', () => 'x')).toEqual({
      text: 'Thanks {not a variable} {{',
      issues: [],
    });
  });

  it('a value is inserted as text, once: it is not searched for more variables', () => {
    const { text } = renderSavedReply('{{name}}', () => '{{agent_name}}');
    expect(text).toBe('{{agent_name}}');
  });

  it('the sample lookup fills the catalogue and flags a custom attribute as unknown', () => {
    const { text, issues } = renderSavedReply('{{first_name}} {{city}}', sampleVariableLookup);
    expect(text).toBe('Amira {{city}}');
    expect(issues.map((i) => i.reason)).toEqual(['unknown']);
  });
});

describe('server lookup', () => {
  const base: RenderFacts['base'] = {
    attributeDefaults: new Map([['city', null]]),
    system: { today: '2026-10-12', businessName: 'Acme', companyName: 'Acme' },
  };
  const facts = (over: Partial<RenderFacts> = {}): RenderFacts => ({
    contact: {
      name: 'Amira Khan',
      firstName: 'Amira',
      middleName: null,
      lastName: null,
      title: null,
      phone: '+971500000000',
      countryCode: '+971',
      email: null,
      address: null,
      language: null,
      groups: [],
      data: { city: 'Dubai' },
    },
    base,
    peerName: null,
    agentName: 'Sam Rivera',
    deviceName: 'Sales line',
    deviceAddress: '+971 4 000 0000',
    ...over,
  });
  const render = (body: string, f = facts()) => renderSavedReply(body, buildLookup(f));

  it('fills contact, custom attribute, agent, workspace and device variables', () => {
    const r = render(
      'Hi {{first_name}} from {{city}}, I am {{agent.first_name}} at {{workspace.name}} ({{device_name}} {{device_phone}}) {{today}}',
    );
    expect(r.text).toBe(
      'Hi Amira from Dubai, I am Sam at Acme (Sales line +971 4 000 0000) 2026-10-12',
    );
    expect(r.issues).toEqual([]);
  });

  it('a real variable with no value is flagged empty, a typo unknown, and the braces stay', () => {
    const r = render('{{last_name}} {{email}} {{lastname}} {{street}}');
    expect(r.text).toBe('{{last_name}} {{email}} {{lastname}} {{street}}');
    expect(r.issues.map((i) => [i.key, i.reason])).toEqual([
      ['last_name', 'empty'],
      ['email', 'empty'],
      ['lastname', 'unknown'],
      ['street', 'unknown'],
    ]);
  });

  it('an active custom attribute the contact has no value for is empty, not unknown', () => {
    const r = render('{{city}}', facts({ contact: undefined }));
    expect(r.issues).toEqual([{ token: '{{city}}', key: 'city', reason: 'empty' }]);
  });

  it('a thread without a contact falls back to the name the customer writes under', () => {
    const r = render(
      'Hi {{first_name}} ({{name}})',
      facts({ contact: undefined, peerName: 'Omar Ali' }),
    );
    expect(r.text).toBe('Hi Omar (Omar Ali)');
  });

  it('a device address that is not a phone number (a mailbox) leaves {{device_phone}} empty and flagged', () => {
    const r = render('{{device_phone}}', facts({ deviceAddress: 'support@acme.test' }));
    expect(r.text).toBe('{{device_phone}}');
    expect(r.issues[0]!.reason).toBe('empty');
  });
});

describe('who may do what', () => {
  const me = { userId: 7, canManage: false };
  const manager = { userId: 8, canManage: true };
  const shared = { userId: null };
  const mine = { userId: 7 };
  const theirs = { userId: 9 };

  it('shared replies are visible to all, a personal reply only to its owner', () => {
    expect(isVisibleTo(shared, me)).toBe(true);
    expect(isVisibleTo(mine, me)).toBe(true);
    expect(isVisibleTo(theirs, me)).toBe(false);
    expect(isVisibleTo(theirs, manager)).toBe(false);
  });

  it('a shared reply is changed only with the manage right', () => {
    expect(canChange(shared, me)).toBe(false);
    expect(canChange(shared, manager)).toBe(true);
  });

  it("a personal reply is its owner's, with or without the manage right", () => {
    expect(canChange(mine, me)).toBe(true);
    expect(canChange(mine, manager)).toBe(false);
    expect(canChange(theirs, manager)).toBe(false);
  });

  it('scope follows the owner column', () => {
    expect(scopeOf(shared)).toBe('shared');
    expect(scopeOf(mine)).toBe('mine');
  });

  it('a channel restriction lets the listed kinds in, and no list means everywhere', () => {
    expect(allowedOnChannel([], 'email')).toBe(true);
    expect(allowedOnChannel(['whatsapp_cloud'], 'whatsapp_cloud')).toBe(true);
    expect(allowedOnChannel(['whatsapp_cloud'], 'email')).toBe(false);
  });

  it('recognises a unique violation however the driver wrapped it', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
    expect(isUniqueViolation({ cause: { code: '23505' } })).toBe(true);
    expect(isUniqueViolation({ code: '23503' })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });
});
