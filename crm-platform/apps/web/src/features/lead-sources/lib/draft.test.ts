import { describe, expect, it } from 'vitest';
import {
  createLeadSourceSchema,
  updateLeadSourceSchema,
  type LeadSourceResponse,
} from '@crm/contracts';
import { ID, source } from '../test-fixtures';
import {
  DEFAULT_DEAL_TITLE,
  DEFAULT_TAG,
  allProblems,
  applyPath,
  buildCreateBody,
  buildDefaults,
  buildMapping,
  buildMappingUpdate,
  buildPreviewBody,
  buildUpdateBody,
  contractIssues,
  buildSpeed,
  draftFromSource,
  emptyDraft,
  emptySpeed,
  speedDelay,
  speedMaxLeadAge,
  firstStepWithProblem,
  isDirty,
  newRow,
  normaliseCountryCode,
  previewIsPossible,
  problemsOfSteps,
  rowPath,
  stepOfField,
  validateDraft,
  withOwnerMode,
  type SourceDraft,
} from './draft';

const named = (patch: Partial<SourceDraft> = {}): SourceDraft => ({
  ...emptyDraft(),
  name: 'Zapier',
  ...patch,
});

describe('normaliseCountryCode', () => {
  it('reads +91, 0091, spaces and brackets as the dial code', () => {
    expect(normaliseCountryCode('+91')).toBe('91');
    expect(normaliseCountryCode('0091')).toBe('91');
    expect(normaliseCountryCode(' 91 ')).toBe('91');
    expect(normaliseCountryCode('(44)')).toBe('44');
    expect(normaliseCountryCode('+1-684')).toBe('1684');
    expect(normaliseCountryCode('')).toBe('');
  });
});

describe('a new draft', () => {
  it('is valid once it has a name, and the contract accepts what it would send', () => {
    const d = named();
    expect(validateDraft(d)).toEqual({});
    expect(contractIssues(d)).toEqual({});
    expect(createLeadSourceSchema.safeParse(buildCreateBody(d)).success).toBe(true);
  });

  it('needs a name', () => {
    expect(validateDraft(emptyDraft()).name).toEqual({ key: 'nameRequired' });
    expect(validateDraft(named({ name: '   ' })).name?.key).toBe('nameRequired');
    expect(validateDraft(named({ name: 'x'.repeat(121) })).name?.key).toBe('nameLength');
  });

  it('starts with the API defaults: tag Lead, deal off, notify the owner, 30 days, unassigned', () => {
    const body = buildCreateBody(named());
    expect(body).toMatchObject({
      name: 'Zapier',
      kind: 'webhook',
      secret: null,
      externalIdPath: null,
      mapping: {},
      rawRetentionDays: 30,
    });
    expect(body.defaults).toEqual({
      countryCode: null,
      platform: null,
      lifecycleStage: null,
      tag: DEFAULT_TAG,
      owner: { mode: 'unassigned', userIds: [] },
      deal: { enabled: false, pipelineId: null, stageId: null, title: DEFAULT_DEAL_TITLE },
      notify: { owner: true, userIds: [] },
      // the first message to a new lead is off until somebody turns it on
      speedToLead: {
        enabled: false,
        channel: 'whatsapp',
        templateId: null,
        senderId: null,
        delayMinutes: 0,
        businessHoursOnly: false,
        maxLeadAgeMinutes: 60,
      },
    });
  });
});

describe('the shared secret is optional and write only', () => {
  it('is not sent unless set', () => {
    expect(buildCreateBody(named()).secret).toBeNull();
    expect(validateDraft(named()).secret).toBeUndefined();
  });

  it('must be 12 to 200 characters when set', () => {
    for (const value of ['short', 'x'.repeat(201)]) {
      const d = named({ secret: { mode: 'set', value } });
      expect(validateDraft(d).secret?.key).toBe('secretLength');
      expect(createLeadSourceSchema.safeParse(buildCreateBody(d)).success).toBe(false);
    }
    const ok = named({ secret: { mode: 'set', value: 'x'.repeat(12) } });
    expect(validateDraft(ok).secret).toBeUndefined();
    expect(buildCreateBody(ok).secret).toBe('x'.repeat(12));
  });

  it('on an update a string sets it, null clears it and absent keeps it', () => {
    const base = draftFromSource(source());
    const keep = buildUpdateBody(base, 4);
    expect('secret' in keep).toBe(false);
    expect(
      buildUpdateBody({ ...base, secret: { mode: 'set', value: 'a-new-secret-value' } }, 4).secret,
    ).toBe('a-new-secret-value');
    const clear = buildUpdateBody({ ...base, secret: { mode: 'clear', value: '' } }, 4);
    expect(clear.secret).toBeNull();
    expect('secret' in clear).toBe(true);
  });

  it('never carries a stored secret: a loaded draft has none', () => {
    const d = draftFromSource(source({ hasSecret: true }));
    expect(d.secret).toEqual({ mode: 'keep', value: '' });
  });
});

describe('owner rules', () => {
  it('fixed is exactly one user', () => {
    expect(
      validateDraft(named({ ownerMode: 'fixed', ownerUserIds: [] }))['defaults.owner.userIds']?.key,
    ).toBe('ownerFixed');
    expect(
      validateDraft(named({ ownerMode: 'fixed', ownerUserIds: [ID(1), ID(2)] }))[
        'defaults.owner.userIds'
      ]?.key,
    ).toBe('ownerFixed');
    expect(validateDraft(named({ ownerMode: 'fixed', ownerUserIds: [ID(1)] }))).toEqual({});
  });

  it('round robin needs at least two distinct users', () => {
    expect(
      validateDraft(named({ ownerMode: 'round_robin', ownerUserIds: [ID(1)] }))[
        'defaults.owner.userIds'
      ]?.key,
    ).toBe('ownerRoundRobin');
    expect(
      validateDraft(named({ ownerMode: 'round_robin', ownerUserIds: [ID(1), ID(1)] }))[
        'defaults.owner.userIds'
      ]?.key,
    ).toBe('ownerRoundRobin');
    expect(
      validateDraft(named({ ownerMode: 'round_robin', ownerUserIds: [ID(1), ID(2)] })),
    ).toEqual({});
  });

  it('unassigned sends no users even when some were picked before switching', () => {
    const d = named({ ownerMode: 'unassigned', ownerUserIds: [ID(1)] });
    expect(buildDefaults(d).owner).toEqual({ mode: 'unassigned', userIds: [] });
    expect(validateDraft(d)).toEqual({});
  });

  it('switching mode keeps the people who still make sense', () => {
    const many = named({ ownerMode: 'round_robin', ownerUserIds: [ID(1), ID(2), ID(3)] });
    expect(withOwnerMode(many, 'fixed').ownerUserIds).toEqual([ID(1)]);
    expect(withOwnerMode(many, 'unassigned').ownerUserIds).toEqual([]);
    expect(withOwnerMode(withOwnerMode(many, 'fixed'), 'round_robin').ownerUserIds).toEqual([
      ID(1),
    ]);
  });

  it('agrees with the contract for every mode and count', () => {
    const modes = ['unassigned', 'fixed', 'round_robin'] as const;
    for (const ownerMode of modes) {
      for (const n of [0, 1, 2, 3]) {
        const d = named({
          ownerMode,
          ownerUserIds: Array.from({ length: n }, (_, i) => ID(i + 1)),
        });
        const mine = Object.keys(validateDraft(d)).length === 0;
        const theirs = createLeadSourceSchema.safeParse(buildCreateBody(d)).success;
        expect(mine, `${ownerMode} ${n}`).toBe(theirs);
      }
    }
  });
});

describe('the deal rule', () => {
  it('off by default; on without a pipeline uses the workspace default', () => {
    const d = named({ dealEnabled: true });
    expect(buildDefaults(d).deal).toEqual({
      enabled: true,
      pipelineId: null,
      stageId: null,
      title: DEFAULT_DEAL_TITLE,
    });
  });

  it('sends a stage only together with its pipeline', () => {
    expect(
      buildDefaults(named({ dealEnabled: true, pipelineId: '', stageId: ID(9) })).deal.stageId,
    ).toBeNull();
    const both = buildDefaults(
      named({ dealEnabled: true, pipelineId: ID(8), stageId: ID(9) }),
    ).deal;
    expect(both).toMatchObject({ pipelineId: ID(8), stageId: ID(9) });
  });

  it('keeps a typed title and falls back to the default for a blank one', () => {
    expect(buildDefaults(named({ dealTitle: 'New lead: {{name}}' })).deal.title).toBe(
      'New lead: {{name}}',
    );
    expect(buildDefaults(named({ dealTitle: '   ' })).deal.title).toBe(DEFAULT_DEAL_TITLE);
    expect(validateDraft(named({ dealTitle: 'x'.repeat(161) }))['defaults.deal.title']?.key).toBe(
      'dealTitleLength',
    );
  });
});

describe('country code, retention and text limits', () => {
  it('normalises the country code before sending and refuses what is not one', () => {
    expect(buildDefaults(named({ countryCode: '+91' })).countryCode).toBe('91');
    expect(buildDefaults(named({ countryCode: '' })).countryCode).toBeNull();
    for (const bad of ['abc', '12345', '9 1 x']) {
      expect(validateDraft(named({ countryCode: bad }))['defaults.countryCode']?.key).toBe(
        'countryCode',
      );
    }
    expect(validateDraft(named({ countryCode: '+1684' }))).toEqual({});
  });

  it('keeps raw data 1 to 365 days', () => {
    for (const bad of ['0', '366', '', '1.5', 'abc', '-3']) {
      expect(validateDraft(named({ retentionDays: bad })).rawRetentionDays?.key, bad).toBe(
        'retentionRange',
      );
    }
    for (const good of ['1', '30', '365']) {
      expect(validateDraft(named({ retentionDays: good })).rawRetentionDays).toBeUndefined();
    }
  });

  it('limits the platform label, tag and path lengths and refuses control characters in a path', () => {
    expect(validateDraft(named({ platform: 'x'.repeat(61) }))['defaults.platform']?.key).toBe(
      'platformLength',
    );
    expect(validateDraft(named({ tag: 'x'.repeat(61) }))['defaults.tag']?.key).toBe('textLength');
    expect(validateDraft(named({ externalIdPath: 'x'.repeat(201) })).externalIdPath?.key).toBe(
      'pathLength',
    );
    expect(validateDraft(named({ externalIdPath: 'a\u0001b' })).externalIdPath?.key).toBe(
      'pathCharacters',
    );
  });

  it('no tag when the box is empty', () => {
    expect(buildDefaults(named({ tag: '' })).tag).toBeNull();
    expect(buildDefaults(named({ tag: ' VIP ' })).tag).toBe('VIP');
  });
});

describe('mapping', () => {
  it('sends only the filled boxes, trimmed', () => {
    const d = named();
    d.mapping.fields.name = ' lead.full_name ';
    d.mapping.fields.phone = 'lead.mobile';
    d.mapping.attribution.campaign = 'utm.campaign';
    d.mapping.customFields = [newRow('budget', 'lead.budget'), newRow('', '')];
    expect(buildMapping(d.mapping)).toEqual({
      name: 'lead.full_name',
      phone: 'lead.mobile',
      customFields: { budget: 'lead.budget' },
      attribution: { campaign: 'utm.campaign' },
    });
  });

  it('flags a half-filled, malformed or repeated custom property row, each on its own input', () => {
    const d = named();
    const a = newRow('Budget', 'lead.budget');
    const b = newRow('', 'lead.x');
    const c = newRow('score', '');
    const e = newRow('score', 'lead.s');
    d.mapping.customFields = [a, b, c, e];
    const p = validateDraft(d);
    expect(p[rowPath(a.id, 'key')]?.key).toBe('propertyKey');
    expect(p[rowPath(b.id, 'key')]?.key).toBe('propertyRequired');
    expect(p[rowPath(c.id, 'path')]?.key).toBe('pathRequired');
    expect(p[rowPath(e.id, 'key')]?.key).toBe('propertyDuplicate');
  });

  it('accepts at most 40 custom properties', () => {
    const d = named();
    d.mapping.customFields = Array.from({ length: 41 }, (_, i) => newRow(`p${i}`, `lead.p${i}`));
    expect(validateDraft(d)['mapping.customFields']?.key).toBe('customFieldsTooMany');
    expect(createLeadSourceSchema.safeParse(buildCreateBody(d)).success).toBe(false);
  });

  it('fills the focused input with a clicked payload path', () => {
    const d = named();
    d.mapping.customFields = [newRow('budget', '')];
    const rowId = d.mapping.customFields[0]!.id;
    expect(applyPath(d, { kind: 'field', field: 'email' }, 'lead.mail').mapping.fields.email).toBe(
      'lead.mail',
    );
    expect(applyPath(d, { kind: 'attribution', field: 'ad' }, 'x.ad').mapping.attribution.ad).toBe(
      'x.ad',
    );
    expect(applyPath(d, { kind: 'custom', rowId }, 'lead.b').mapping.customFields[0]!.path).toBe(
      'lead.b',
    );
    expect(applyPath(d, { kind: 'externalId' }, 'lead.id').externalIdPath).toBe('lead.id');
    expect(d.externalIdPath).toBe('');
  });
});

describe('draft <-> API body', () => {
  const full: LeadSourceResponse = source({
    providerKey: null,
    externalIdPath: 'lead.id',
    rawRetentionDays: 90,
    mapping: {
      name: 'lead.full_name',
      email: 'lead.email',
      customFields: { budget: 'lead.budget', city: 'lead.city' },
      attribution: { platform: 'lead.src', form: 'lead.form' },
    },
    defaults: {
      countryCode: '44',
      platform: 'IndiaMART',
      lifecycleStage: 'ad_lead',
      tag: null,
      owner: { mode: 'round_robin', userIds: [ID(5), ID(6)] },
      deal: { enabled: true, pipelineId: ID(7), stageId: ID(8), title: '{{name}} / {{campaign}}' },
      notify: { owner: false, userIds: [ID(5)] },
      speedToLead: {
        enabled: true,
        channel: 'email',
        templateId: ID(40),
        senderId: ID(41),
        delayMinutes: 15,
        businessHoursOnly: true,
        maxLeadAgeMinutes: 60,
      },
    },
  });

  it('a source loaded into a draft and sent back as an update is what the server holds', () => {
    const body = buildUpdateBody(draftFromSource(full), full.rowVersion);
    expect(body).toEqual({
      rowVersion: 4,
      name: full.name,
      externalIdPath: 'lead.id',
      mapping: full.mapping,
      defaults: full.defaults,
      rawRetentionDays: 90,
    });
    expect(updateLeadSourceSchema.safeParse(body).success).toBe(true);
  });

  it('a stored null tag stays "no tag"; a stored source without the key gets the default tag', () => {
    expect(draftFromSource(full).tag).toBe('');
    const noKey = source();
    delete (noKey.defaults as { tag?: unknown }).tag;
    expect(draftFromSource(noKey).tag).toBe(DEFAULT_TAG);
  });

  it('is not dirty until something is changed, and a secret edit counts', () => {
    const base = draftFromSource(full);
    expect(isDirty(base, draftFromSource(full))).toBe(false);
    expect(isDirty({ ...base, name: 'Other' }, base)).toBe(true);
    expect(isDirty({ ...base, name: ` ${base.name} ` }, base)).toBe(false);
    expect(isDirty({ ...base, secret: { mode: 'clear', value: '' } }, base)).toBe(true);
    expect(isDirty({ ...base, secret: { mode: 'set', value: 'a-new-secret-value' } }, base)).toBe(
      true,
    );
    expect(isDirty({ ...base, countryCode: '+44' }, base)).toBe(false);
  });

  it('the update contract accepts every draft the checks accept', () => {
    expect(allProblems(draftFromSource(full), 'update')).toEqual({});
  });

  it('the wizard saves only the mapping and the sender id path, with the row version', () => {
    const d = draftFromSource(full);
    expect(buildMappingUpdate(d, 9)).toEqual({
      rowVersion: 9,
      mapping: full.mapping,
      externalIdPath: 'lead.id',
    });
  });
});

describe('steps', () => {
  it('knows which step owns a field', () => {
    expect(stepOfField('name')).toBe('basics');
    expect(stepOfField('secret')).toBe('basics');
    expect(stepOfField('defaults.platform')).toBe('basics');
    expect(stepOfField('defaults.owner.userIds')).toBe('rules');
    expect(stepOfField('defaults.deal.stageId')).toBe('rules');
    expect(stepOfField('mapping.customFields.budget')).toBe('mapping');
  });

  it('finds the first step with a problem and filters problems by step', () => {
    const d = named({ name: '', ownerMode: 'fixed' });
    const p = validateDraft(d);
    expect(firstStepWithProblem(p)).toBe('basics');
    expect(Object.keys(problemsOfSteps(p, ['rules']))).toEqual(['defaults.owner.userIds']);
    expect(firstStepWithProblem({})).toBeNull();
  });
});

describe('the preview request', () => {
  it('carries the draft mapping, the sender id path and only the country code of the defaults', () => {
    const d = named({
      countryCode: '+91',
      externalIdPath: 'lead.id',
      ownerMode: 'fixed',
      ownerUserIds: [ID(1)],
    });
    d.mapping.fields.phone = 'lead.mobile';
    const body = buildPreviewBody(d);
    expect(body.mapping).toEqual({ phone: 'lead.mobile' });
    expect(body.externalIdPath).toBe('lead.id');
    expect(body.defaults?.countryCode).toBe('91');
    expect(body.defaults?.owner).toEqual({ mode: 'unassigned', userIds: [] });
    expect(body.payload).toBeUndefined();
    expect(body.eventId).toBeUndefined();
  });

  it('adds a pasted payload or a stored event, never both implicitly', () => {
    const d = named();
    expect(buildPreviewBody(d, { payload: { name: 'A' } }).payload).toEqual({ name: 'A' });
    expect(buildPreviewBody(d, { eventId: ID(3) }).eventId).toBe(ID(3));
  });

  it('is not sent while the mapping, the sender id path or the country code are wrong', () => {
    expect(previewIsPossible(named())).toBe(true);
    expect(previewIsPossible(named({ countryCode: 'abc' }))).toBe(false);
    const bad = named();
    bad.mapping.customFields = [newRow('Bad Key', 'x')];
    expect(previewIsPossible(bad)).toBe(false);
    // A problem outside the mapping (the name) does not block the preview.
    expect(previewIsPossible(named({ name: '' }))).toBe(true);
  });
});

describe('the first message to a new lead (speed-to-lead)', () => {
  const on = (patch: Partial<SourceDraft['speed']> = {}): SourceDraft =>
    named({ speed: { ...emptySpeed(), enabled: true, templateId: ID(40), ...patch } });

  it('is off by default and a draft of a source that never set it is off too', () => {
    expect(emptyDraft().speed).toEqual(emptySpeed());
    expect(emptySpeed().enabled).toBe(false);
    expect(draftFromSource(source()).speed).toEqual(emptySpeed());
  });

  it('goes to the server as the contract states it, and survives a round trip', () => {
    const d = on({ channel: 'sms', senderId: ID(41), delay: '30', businessHoursOnly: true });
    expect(buildDefaults(d).speedToLead).toEqual({
      enabled: true,
      channel: 'sms',
      templateId: ID(40),
      senderId: ID(41),
      delayMinutes: 30,
      businessHoursOnly: true,
      maxLeadAgeMinutes: 60,
    });
    expect(createLeadSourceSchema.safeParse(buildCreateBody(d)).success).toBe(true);
    const back = draftFromSource(
      source({ defaults: { ...source().defaults, speedToLead: buildSpeed(d.speed) } }),
    );
    expect(back.speed).toEqual(d.speed);
  });

  it('WhatsApp is sent by the template own number: a sender chosen earlier for SMS is not carried', () => {
    expect(buildSpeed(on({ channel: 'whatsapp', senderId: ID(41) }).speed).senderId).toBeNull();
  });

  it('switched on it needs a template, and the delay must be whole minutes from 0 to 60', () => {
    expect(validateDraft(on({ templateId: '' }))['defaults.speedToLead.templateId']).toEqual({
      key: 'speedTemplateRequired',
    });
    // off, an unfinished setting is not a problem
    expect(
      validateDraft(named({ speed: { ...emptySpeed(), templateId: '' } }))[
        'defaults.speedToLead.templateId'
      ],
    ).toBeUndefined();
    for (const bad of ['', 'x', '-1', '61', '1.5', '1e1']) {
      expect(
        validateDraft(on({ delay: bad }))['defaults.speedToLead.delayMinutes'],
        bad,
      ).toMatchObject({ key: 'speedDelayRange', values: { max: 60 } });
    }
    for (const ok of ['0', '1', '60', ' 15 ']) {
      expect(
        validateDraft(on({ delay: ok }))['defaults.speedToLead.delayMinutes'],
        ok,
      ).toBeUndefined();
    }
    expect(speedDelay('60')).toBe(60);
    expect(speedDelay('61')).toBeNull();
  });

  it('does not message old leads unless the workspace chooses: an hour by default, a longer time on purpose', () => {
    expect(emptySpeed().maxLeadAge).toBe('60');
    expect(buildSpeed(on().speed).maxLeadAgeMinutes).toBe(60);
    expect(buildSpeed(on({ maxLeadAge: '10080' }).speed).maxLeadAgeMinutes).toBe(10080);
    const back = draftFromSource(
      source({
        defaults: {
          ...source().defaults,
          speedToLead: { ...source().defaults.speedToLead, maxLeadAgeMinutes: 1440 },
        },
      }),
    );
    expect(back.speed.maxLeadAge).toBe('1440');
    expect(contractIssues(on({ maxLeadAge: '129600' }))).toEqual({});
  });

  it('the oldest-lead limit is whole minutes from 1 to 90 days', () => {
    for (const bad of ['', 'x', '0', '-5', '1.5', '129601', '1e3']) {
      expect(
        validateDraft(on({ maxLeadAge: bad }))['defaults.speedToLead.maxLeadAgeMinutes'],
        bad,
      ).toEqual({ key: 'speedMaxAgeRange' });
    }
    expect(speedMaxLeadAge('129600')).toBe(129600);
    expect(speedMaxLeadAge(' 60 ')).toBe(60);
    expect(speedMaxLeadAge('129601')).toBeNull();
  });

  it('a problem in it belongs to the rules step and is found by the contract too', () => {
    expect(stepOfField('defaults.speedToLead.templateId')).toBe('rules');
    expect(firstStepWithProblem(validateDraft(on({ templateId: '' })))).toBe('rules');
    expect(contractIssues(on({ delay: '5' }))).toEqual({});
  });

  it('counts as a change when the person edits it', () => {
    const base = on();
    expect(isDirty(on({ delay: '5' }), base)).toBe(true);
    expect(isDirty(on({ businessHoursOnly: true }), base)).toBe(true);
    expect(isDirty(on(), base)).toBe(false);
  });
});
