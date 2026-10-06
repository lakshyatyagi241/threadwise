import { describe, expect, it } from 'vitest';
import { ERROR_CODES, checkProviderBaseUrl, createWhatsappProviderSchema } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import { checkBaseUrl, isApiVersion, previewUrl } from './base-url';
import {
  buildCreateRequest,
  buildUpdateRequest,
  draftFromProvider,
  draftReadinessGaps,
  emptyDraft,
  firstStepWithProblem,
  readinessGaps,
  secretStatus,
  stepOfField,
  validateDraft,
  withAuthScheme,
  withPartnerProgram,
  type ProviderDraft,
} from './draft';
import { WAP_ERROR_KEYS, isNoAccess, wapError } from './errors';
import {
  contractProblems,
  headerProblems,
  insertPlaceholder,
  newRow,
  previewHeaders,
  rowsFromTemplates,
  starterRows,
  templatesFromRows,
  unreachablePlaceholders,
} from './header-templates';
import { missingPermission, wapAccess } from './permissions';
import {
  filterProviders,
  providerActions,
  selectableProviders,
  sortProviders,
  statusCounts,
} from './provider-view';
import {
  buildSwitchRequest,
  canDryRun,
  formSignature,
  numberIdsToApply,
  rollbackForm,
  summarizePlan,
  summarizeResult,
} from './switch-plan';
import { ID, provider, switchResponse } from '../test-fixtures';
import { buildTestRequest, emptyTestForm, takesChannelToken, testHint } from './test-result';

const row = (name: string, value: string) => newRow(name, value);

describe('header templates', () => {
  it('accepts a header that carries the credential of the mode', () => {
    expect(headerProblems([row('x-api-key', '{{providerToken}}')], 'platform_token')).toEqual([]);
    expect(headerProblems([row('x-token', '{{channelToken}}')], 'channel_token')).toEqual([]);
  });

  it('demands a header that carries the credential its mode uses (the API refuses without)', () => {
    const p = headerProblems([row('x-waba-id', '{{wabaId}}')], 'platform_token');
    expect(p.map((x) => x.code)).toEqual(['credentialNotCarried']);
    expect(p[0]?.values?.placeholder).toBe('{{providerToken}}');
    expect(
      headerProblems([row('x-api-key', '{{providerToken}}')], 'channel_token').map((x) => x.code),
    ).toEqual(['credentialNotCarried']);
  });

  it('refuses hop-by-hop and managed names, duplicates and bad names', () => {
    const rows = [
      row('Host', 'x'),
      row('content-length', '1'),
      row('sec-fetch-mode', 'x'),
      row('x-a', '{{providerToken}}'),
      row('X-A', 'y'),
      row('bad name', 'v'),
    ];
    const codes = headerProblems(rows, 'platform_token').map((p) => p.code);
    expect(codes.filter((c) => c === 'nameDenied')).toHaveLength(3);
    expect(codes).toContain('nameDuplicate');
    expect(codes).toContain('nameInvalid');
  });

  it('refuses empty, long, non-ASCII, unknown placeholders and stray braces', () => {
    const rows = [
      row('x-a', ''),
      row('x-b', 'a'.repeat(513)),
      row('x-c', 'café'),
      row('x-d', '{{secret}}'),
      row('x-e', '{{providerToken}'),
      row('x-f', '{{providerToken}}'),
    ];
    const byCode = headerProblems(rows, 'platform_token').map((p) => p.code);
    expect(byCode).toEqual(
      expect.arrayContaining([
        'valueEmpty',
        'valueTooLong',
        'valueCharacters',
        'placeholderUnknown',
        'strayBrace',
      ]),
    );
  });

  it('refuses more than 12 headers', () => {
    const rows = Array.from({ length: 13 }, (_, i) =>
      row(`x-h${i}`, i === 0 ? '{{providerToken}}' : 'v'),
    );
    expect(headerProblems(rows, 'platform_token').map((p) => p.code)).toContain('tooMany');
  });

  it('ignores blank rows', () => {
    expect(
      headerProblems([row('', ''), row('x-k', '{{providerToken}}')], 'platform_token'),
    ).toEqual([]);
  });

  it('agrees with the contract: no problem here exactly when the contract finds none (ignoring the credential rule)', () => {
    const cases: Array<Array<[string, string]>> = [
      [['x-a', '{{providerToken}}']],
      [['x-a', '{{ wabaId }}']],
      [['Host', 'x']],
      [['x-a', 'café']],
      [['x-a', '{{nope}}']],
      [['x-a', 'a{b']],
      [['x-a', '']],
      [['bad name', 'v']],
      [['x-a', 'v'.repeat(600)]],
      [['sec-x', 'v']],
      [['proxy-x', 'v']],
      [['accept', 'v']],
    ];
    for (const c of cases) {
      const rows = c.map(([n, v]) => row(n, v));
      const mine = headerProblems(rows, 'platform_token').filter(
        (p) => p.code !== 'credentialNotCarried',
      );
      expect(mine.length === 0, JSON.stringify(c)).toBe(contractProblems(rows).length === 0);
    }
  });

  it('turns rows into the lower-cased trimmed map the API takes, and back', () => {
    const rows = [row(' X-Api-Key ', ' {{providerToken}} '), row('', '')];
    expect(templatesFromRows(rows)).toEqual({ 'x-api-key': '{{providerToken}}' });
    expect(rowsFromTemplates({ 'x-a': 'v' }).map((r) => [r.name, r.value])).toEqual([['x-a', 'v']]);
  });

  it('starts a custom-header provider with the one header it needs', () => {
    expect(templatesFromRows(starterRows('platform_token'))).toEqual({
      'x-api-key': '{{providerToken}}',
    });
    expect(templatesFromRows(starterRows('channel_token'))).toEqual({
      'x-api-key': '{{channelToken}}',
    });
  });

  it('inserts a placeholder at the end of a value', () => {
    expect(insertPlaceholder('Bearer ', 'providerToken')).toBe('Bearer {{providerToken}}');
  });

  it('previews with stand-in values and never a real secret', () => {
    const rows = [
      row('x-api-key', '{{providerToken}}'),
      row('x-waba-id', '{{wabaId}}'),
      row('x-ph', '{{phoneNumberId}}'),
    ];
    const headers = previewHeaders('custom_headers', rows, 'platform_token');
    expect(headers).toEqual([
      { name: 'x-api-key', value: '<provider-token>' },
      { name: 'x-waba-id', value: 'WABA_ID' },
      { name: 'x-ph', value: 'PHONE_NUMBER_ID' },
    ]);
    expect(previewHeaders('bearer', [], 'platform_token')).toEqual([
      { name: 'authorization', value: 'Bearer <provider-token>' },
    ]);
    expect(previewHeaders('bearer', [], 'channel_token')[0]?.value).toBe('Bearer <number-token>');
  });

  it('warns that the number token placeholder is never known in platform token mode', () => {
    const rows = [row('x-a', '{{providerToken}}'), row('x-b', '{{channelToken}}')];
    expect(unreachablePlaceholders(rows, 'platform_token')).toEqual(['channelToken']);
    expect(unreachablePlaceholders(rows, 'channel_token')).toEqual([]);
  });
});

describe('base url', () => {
  it('accepts a public https address and normalises it', () => {
    expect(checkBaseUrl('https://API.Example-BSP.com/wa/')).toMatchObject({
      ok: true,
      url: 'https://api.example-bsp.com/wa',
    });
  });

  it('maps every refusal of the contract to a code the screen can translate', () => {
    const cases: Array<[string, string]> = [
      ['', 'empty'],
      ['https://' + 'a'.repeat(200) + '.com', 'length'],
      ['https://a b.com', 'characters'],
      ['not a url', 'characters'],
      ['nope', 'invalid'],
      ['https://user:pw@api.example-bsp.com', 'credentials'],
      ['https://api.example-bsp.com/wa?x=1', 'queryOrFragment'],
      ['https://api.example-bsp.com/wa#x', 'queryOrFragment'],
      ['http://api.example-bsp.com', 'notHttps'],
      ['https://api.example-bsp.com:8443', 'port'],
      ['https://10.0.0.1', 'host'],
      ['https://localhost', 'host'],
      ['https://intranet', 'host'],
      ['https://svc.internal', 'internal'],
      ['https://api.corp', 'internal'],
    ];
    for (const [raw, problem] of cases) {
      const v = checkBaseUrl(raw);
      expect(v.ok, raw).toBe(false);
      expect(v.problem, raw).toBe(problem);
    }
  });

  it('never leaves a contract refusal unmapped (the fallback is only for a new reason)', () => {
    const raws = [
      'http://x.com',
      'https://1.2.3.4',
      'https://a.local',
      'ftp://a.com',
      'https://a.com:81',
    ];
    for (const raw of raws) {
      const verdict = checkProviderBaseUrl(raw, { allowDevLoopback: true });
      expect(verdict.ok).toBe(false);
      expect(checkBaseUrl(raw).problem).not.toBe('invalid');
    }
  });

  it('tolerates plain http on loopback only as a development case', () => {
    expect(checkBaseUrl('http://localhost:4010')).toMatchObject({ ok: true, devLoopback: true });
    expect(checkBaseUrl('http://example.com').ok).toBe(false);
  });

  it('builds the URL a live test calls', () => {
    expect(previewUrl('https://api.example-bsp.com/wa/', 'v25.0')).toBe(
      'https://api.example-bsp.com/wa/v25.0/me',
    );
    expect(previewUrl('https://api.example-bsp.com', 'v25.0', 'me')).toBe(
      'https://api.example-bsp.com/v25.0/me',
    );
    expect(previewUrl('nope', 'v25.0')).toBeNull();
  });

  it('checks the api version shape', () => {
    expect(isApiVersion('v25.0')).toBe(true);
    expect(isApiVersion(' v9.1 ')).toBe(true);
    expect(isApiVersion('25.0')).toBe(false);
    // Pinnacle's partner API is versioned `v3`, with no minor.
    expect(isApiVersion('v3')).toBe(true);
    expect(isApiVersion('v')).toBe(false);
    expect(isApiVersion('v1.')).toBe(false);
  });
});

describe('provider draft', () => {
  const valid = (): ProviderDraft => ({
    ...emptyDraft(),
    key: 'Pinnacle',
    label: ' Pinnacle BSP ',
    baseUrl: 'https://api.pinnacle.example-bsp.com/wa/',
    authScheme: 'custom_headers',
    headers: [row('X-API-Key', '{{providerToken}}'), row('x-waba-id', '{{wabaId}}')],
    signatureScheme: 'shared_secret_header',
    signatureHeaderName: 'X-BSP-Secret',
    mediaUpload: false,
    onboarding: 'embedded_signup',
    onboardingAppId: '123456',
    onboardingConfigId: '654321',
    notes: ' a note ',
    secrets: {
      providerToken: { value: ' tok-12345678 ', clear: false },
      appSecret: { value: '', clear: false },
      webhookSecret: { value: 'whsec-12345', clear: false },
      verifyToken: { value: '', clear: false },
    },
  });

  it('validates a complete draft and builds a create request the contract accepts', () => {
    const v = validateDraft(valid(), { mode: 'create' });
    expect(v.ok).toBe(true);
    const body = buildCreateRequest(valid());
    expect(body).toMatchObject({
      key: 'pinnacle',
      label: 'Pinnacle BSP',
      baseUrl: 'https://api.pinnacle.example-bsp.com/wa',
      apiVersion: 'v25.0',
      authScheme: 'custom_headers',
      headerTemplates: { 'x-api-key': '{{providerToken}}', 'x-waba-id': '{{wabaId}}' },
      credentialMode: 'platform_token',
      signatureHeaderName: 'x-bsp-secret',
      capabilities: { mediaUpload: false },
      onboardingAppId: '123456',
      notes: 'a note',
      credentials: { providerToken: 'tok-12345678', webhookSecret: 'whsec-12345' },
    });
    expect(createWhatsappProviderSchema.safeParse(body).success).toBe(true);
  });

  it('a bearer provider sends no header templates', () => {
    const d = {
      ...emptyDraft(),
      key: 'plain',
      label: 'Plain',
      baseUrl: 'https://api.example-bsp.com',
      headers: [row('x', 'y')],
    };
    const body = buildCreateRequest(d);
    expect(body.authScheme).toBe('bearer');
    expect(body.headerTemplates).toBeUndefined();
    expect(createWhatsappProviderSchema.safeParse(body).success).toBe(true);
  });

  it('reports each problem on its own field', () => {
    const d: ProviderDraft = {
      ...valid(),
      key: 'meta',
      label: '',
      baseUrl: 'http://api.example-bsp.com',
      apiVersion: '25',
      headers: [row('host', 'x')],
      signatureHeaderName: '',
      onboardingAppId: 'abc',
      secrets: { ...valid().secrets, providerToken: { value: 'short', clear: false } },
    };
    const { fields, ok } = validateDraft(d, { mode: 'create' });
    expect(ok).toBe(false);
    expect(fields.key?.key).toBe('keyBuiltin');
    expect(fields.label?.key).toBe('labelRequired');
    expect(fields.baseUrl?.key).toBe('baseUrl.notHttps');
    expect(fields.apiVersion?.key).toBe('apiVersion');
    expect(fields.headerTemplates?.key).toBe('headers');
    expect(fields.signatureHeaderName?.key).toBe('signatureHeaderRequired');
    expect(fields.onboardingAppId?.key).toBe('digits');
    expect(fields['credentials.providerToken']?.key).toBe('secretLength');
  });

  it('checks a key format, secrets characters and lengths', () => {
    expect(validateDraft({ ...valid(), key: '1abc' }, { mode: 'create' }).fields.key?.key).toBe(
      'keyFormat',
    );
    expect(validateDraft({ ...valid(), key: '' }, { mode: 'create' }).fields.key?.key).toBe(
      'keyRequired',
    );
    const spaced = {
      ...valid(),
      secrets: { ...valid().secrets, verifyToken: { value: 'has a space', clear: false } },
    };
    expect(validateDraft(spaced, { mode: 'create' }).fields['credentials.verifyToken']?.key).toBe(
      'secretCharacters',
    );
  });

  it('only checks label and notes of a built-in provider', () => {
    const d = { ...emptyDraft(), label: 'Meta', baseUrl: '' };
    expect(validateDraft(d, { mode: 'edit', builtin: true }).ok).toBe(true);
    expect(
      validateDraft({ ...d, label: '' }, { mode: 'edit', builtin: true }).fields.label?.key,
    ).toBe('labelRequired');
  });

  it('switching to custom headers adds the one needed header', () => {
    const d = withAuthScheme(emptyDraft(), 'custom_headers');
    expect(templatesFromRows(d.headers)).toEqual({ 'x-api-key': '{{providerToken}}' });
    const again = withAuthScheme(
      { ...d, headers: [row('x-a', '{{providerToken}}')] },
      'custom_headers',
    );
    expect(again.headers).toHaveLength(1);
  });

  it('sends nothing when nothing changed, and only what changed otherwise', () => {
    const p = provider();
    expect(buildUpdateRequest(p, draftFromProvider(p))).toBeNull();
    const d = { ...draftFromProvider(p), label: 'New name', apiVersion: 'v26.0' };
    expect(buildUpdateRequest(p, d)).toEqual({
      rowVersion: 3,
      label: 'New name',
      apiVersion: 'v26.0',
    });
  });

  it('keeps stored secrets unless a value is typed, and clears one only on request', () => {
    const p = provider();
    const base = draftFromProvider(p);
    expect(buildUpdateRequest(p, base)).toBeNull();
    const typed = {
      ...base,
      secrets: { ...base.secrets, providerToken: { value: ' new-token-123 ', clear: false } },
    };
    expect(buildUpdateRequest(p, typed)).toEqual({
      rowVersion: 3,
      credentials: { providerToken: 'new-token-123' },
    });
    const cleared = {
      ...base,
      secrets: { ...base.secrets, webhookSecret: { value: '', clear: true } },
    };
    expect(buildUpdateRequest(p, cleared)).toEqual({
      rowVersion: 3,
      clearCredentials: ['webhookSecret'],
    });
    // a typed value wins over a clear flag, and clearing something never set sends nothing
    const both = {
      ...base,
      secrets: { ...base.secrets, webhookSecret: { value: 'typed-secret-1', clear: true } },
    };
    expect(buildUpdateRequest(p, both)).toEqual({
      rowVersion: 3,
      credentials: { webhookSecret: 'typed-secret-1' },
    });
    const unset = { ...base, secrets: { ...base.secrets, appSecret: { value: '', clear: true } } };
    expect(buildUpdateRequest(p, unset)).toBeNull();
  });

  it('a built-in provider only ever sends label, notes and billing mode', () => {
    const p = provider({ builtin: 'meta', key: 'meta', authScheme: 'bearer', headerTemplates: {} });
    const d = {
      ...draftFromProvider(p),
      label: 'Meta Cloud',
      baseUrl: 'https://elsewhere.example.com',
      billingMode: 'meta_reseller' as const,
    };
    expect(buildUpdateRequest(p, d)).toEqual({
      rowVersion: 3,
      label: 'Meta Cloud',
      billingMode: 'meta_reseller',
    });
  });

  it('changing to bearer clears the stored header templates; the signature header goes with its scheme', () => {
    const p = provider();
    const d = {
      ...draftFromProvider(p),
      authScheme: 'bearer' as const,
      signatureScheme: 'none' as const,
    };
    expect(buildUpdateRequest(p, d)).toEqual({
      rowVersion: 3,
      authScheme: 'bearer',
      headerTemplates: {},
      signatureScheme: 'none',
      signatureHeaderName: null,
    });
  });

  it('describes a secret by what is stored and what saving will do', () => {
    const set = { set: true, last4: '1234' };
    const unset = { set: false, last4: null };
    expect(secretStatus(set, { value: '', clear: false })).toBe('setWithHint');
    expect(secretStatus({ set: true, last4: null }, { value: '', clear: false })).toBe('set');
    expect(secretStatus(unset, { value: '', clear: false })).toBe('notSet');
    expect(secretStatus(undefined, { value: '', clear: false })).toBe('notSet');
    expect(secretStatus(set, { value: 'x', clear: false })).toBe('willReplace');
    expect(secretStatus(set, { value: '', clear: true })).toBe('willClear');
  });

  it('lists what a provider still lacks', () => {
    expect(readinessGaps(provider({ signatureScheme: 'meta_app_secret_sha256' }))).toEqual([
      'appSecret',
    ]);
    expect(
      readinessGaps(
        provider({
          credentials: {
            providerToken: { set: false, last4: null },
            appSecret: { set: false, last4: null },
            webhookSecret: { set: false, last4: null },
            verifyToken: { set: false, last4: null },
          },
        }),
      ),
    ).toEqual(['providerToken', 'webhookSecret']);
    expect(
      readinessGaps(provider({ credentialMode: 'channel_token', signatureScheme: 'none' })),
    ).toEqual([]);
    expect(readinessGaps(provider({ builtin: 'interakt' }))).toEqual([]);
  });

  it('counts a typed secret as held when listing the gaps of an unsaved draft', () => {
    const d = {
      ...emptyDraft(),
      secrets: { ...emptyDraft().secrets, providerToken: { value: 'abcdefgh', clear: false } },
    };
    expect(draftReadinessGaps(d)).toEqual(['appSecret']);
    expect(draftReadinessGaps(emptyDraft())).toEqual(['providerToken', 'appSecret']);
  });

  it('sends a wizard back to the step that owns the problem', () => {
    expect(stepOfField('baseUrl')).toBe('connection');
    expect(stepOfField('credentials.appSecret')).toBe('webhooks');
    expect(stepOfField('key')).toBe('basics');
    expect(stepOfField('nonsense')).toBe('review');
    expect(firstStepWithProblem({ onboardingAppId: 1, baseUrl: 1 })).toBe('connection');
    expect(firstStepWithProblem({})).toBeNull();
  });
});

describe('partner program', () => {
  const base = (): ProviderDraft => ({
    ...emptyDraft(),
    key: 'pin',
    label: 'Pin',
    baseUrl: 'https://api.example-bsp.com',
  });
  const stored = () =>
    provider({
      credentialMode: 'channel_token',
      onboarding: 'embedded_signup',
      partnerProgram: 'pinnacle',
      partnerSolutionId: '123456',
    });

  it('is off by default and sends nothing', () => {
    const d = emptyDraft();
    expect(d.partnerProgram).toBeNull();
    expect(d.partnerSolutionId).toBe('');
    const body = buildCreateRequest(base());
    expect(body.partnerProgram).toBeUndefined();
    expect(body.partnerSolutionId).toBeUndefined();
    expect(validateDraft(base(), { mode: 'create' }).fields.partnerSolutionId).toBeUndefined();
  });

  it('choosing Pinnacle defaults the credential mode and onboarding', () => {
    const d = withPartnerProgram(base(), 'pinnacle');
    expect(d).toMatchObject({
      partnerProgram: 'pinnacle',
      credentialMode: 'channel_token',
      onboarding: 'embedded_signup',
    });
  });

  it('needs a digits solution id once a program is chosen', () => {
    const d = withPartnerProgram(base(), 'pinnacle');
    expect(validateDraft(d, { mode: 'create' }).fields.partnerSolutionId?.key).toBe(
      'partnerSolutionIdRequired',
    );
    expect(
      validateDraft({ ...d, partnerSolutionId: 'ab12' }, { mode: 'create' }).fields
        .partnerSolutionId?.key,
    ).toBe('digits');
    expect(validateDraft({ ...d, partnerSolutionId: '123456' }, { mode: 'create' }).ok).toBe(true);
    const wrongMode = {
      ...d,
      partnerSolutionId: '123456',
      credentialMode: 'platform_token' as const,
    };
    expect(validateDraft(wrongMode, { mode: 'create' }).fields.credentialMode?.key).toBe(
      'partnerCredentialMode',
    );
  });

  it('builds a create request the contract accepts', () => {
    const d = { ...withPartnerProgram(base(), 'pinnacle'), partnerSolutionId: ' 123456 ' };
    const body = buildCreateRequest(d);
    expect(body).toMatchObject({
      partnerProgram: 'pinnacle',
      partnerSolutionId: '123456',
      credentialMode: 'channel_token',
      onboarding: 'embedded_signup',
    });
    expect(createWhatsappProviderSchema.safeParse(body).success).toBe(true);
  });

  it('round-trips a stored provider with no change', () => {
    const p = stored();
    expect(draftFromProvider(p)).toMatchObject({
      partnerProgram: 'pinnacle',
      partnerSolutionId: '123456',
    });
    expect(buildUpdateRequest(p, draftFromProvider(p))).toBeNull();
  });

  it('an update sends the pair when either changes', () => {
    const p = stored();
    const d = { ...draftFromProvider(p), partnerSolutionId: '654321' };
    expect(buildUpdateRequest(p, d)).toEqual({
      rowVersion: p.rowVersion,
      partnerProgram: 'pinnacle',
      partnerSolutionId: '654321',
    });
    const turnedOn = provider();
    const on = withPartnerProgram(
      { ...draftFromProvider(turnedOn), partnerSolutionId: '123456' },
      'pinnacle',
    );
    expect(buildUpdateRequest(turnedOn, on)).toMatchObject({
      partnerProgram: 'pinnacle',
      partnerSolutionId: '123456',
      credentialMode: 'channel_token',
      onboarding: 'embedded_signup',
    });
  });

  it('clearing the program sends null for both', () => {
    const p = stored();
    const cleared = withPartnerProgram(draftFromProvider(p), null);
    expect(cleared.partnerSolutionId).toBe('');
    const body = buildUpdateRequest(p, cleared);
    expect(body).toEqual({
      rowVersion: p.rowVersion,
      partnerProgram: null,
      partnerSolutionId: null,
    });
    expect(validateDraft(cleared, { mode: 'edit' }).fields.partnerSolutionId).toBeUndefined();
  });

  it('the solution id field belongs to the billing step, the mode to credentials', () => {
    expect(stepOfField('partnerSolutionId')).toBe('billing');
    expect(stepOfField('credentialMode')).toBe('credentials');
  });

  it('maps the partner error codes', () => {
    expect(wapError(api(409, ERROR_CODES.WAP_PARTNER_NOT_CONFIGURED))).toMatchObject({
      kind: 'general',
      key: 'partnerNotConfigured',
    });
    const refused = new ApiError(502, ERROR_CODES.WAP_PARTNER_REFUSED, 'email already used');
    expect(wapError(refused)).toMatchObject({
      key: 'partnerRefused',
      values: { message: 'email already used' },
    });
    expect(wapError(new ApiError(502, ERROR_CODES.WAP_PARTNER_REFUSED, '')).key).toBe(
      'partnerRefusedPlain',
    );
  });
});

describe('provider actions and list helpers', () => {
  const all = { view: true, manage: true, switch: true };

  it('offers nothing without the manage permission', () => {
    const a = providerActions(provider({ status: 'active' }), {
      view: true,
      manage: false,
      switch: false,
    });
    expect(a.edit).toBe(false);
    expect(a.test).toBe(false);
    expect(a.activate.enabled).toBe(false);
    expect(a.makeDefault.enabled).toBe(false);
  });

  it('follows the API rules for each status', () => {
    const disabled = providerActions(provider({ status: 'disabled' }), all);
    expect(disabled.activate.enabled).toBe(true);
    expect(disabled.disable.enabled).toBe(false);
    expect(disabled.makeDefault.enabled).toBe(false);
    expect(disabled.archive.enabled).toBe(true);

    const active = providerActions(provider({ status: 'active' }), all);
    expect(active.activate.enabled).toBe(false);
    expect(active.disable.enabled).toBe(true);
    expect(active.makeDefault.enabled).toBe(true);

    const archived = providerActions(provider({ status: 'archived' }), all);
    expect(archived.activate.enabled).toBe(true);
    expect(archived.archive.enabled).toBe(false);
    expect(archived.test).toBe(false);
  });

  it('says why the default, a built-in provider or a provider in use cannot be disabled or archived', () => {
    const def = providerActions(provider({ status: 'active', isDefault: true }), all);
    expect(def.disable).toEqual({ enabled: false, blocked: 'default' });
    expect(def.archive).toEqual({ enabled: false, blocked: 'default' });
    expect(def.makeDefault.enabled).toBe(false);
    expect(def.clearDefault).toBe(true);

    expect(providerActions(provider({ builtin: 'meta' }), all).archive).toEqual({
      enabled: false,
      blocked: 'builtin',
    });
    expect(providerActions(provider({ numberCount: 2 }), all).archive).toEqual({
      enabled: false,
      blocked: 'inUse',
    });
    expect(providerActions(provider({ workspaceCount: 1 }), all).archive).toEqual({
      enabled: false,
      blocked: 'inUse',
    });
  });

  it('sorts the default first, then by status, built-in first, then by label', () => {
    const list = [
      provider({ id: ID(1), key: 'z', label: 'Zed', status: 'archived' }),
      provider({ id: ID(2), key: 'b', label: 'Beta', status: 'active' }),
      provider({ id: ID(3), key: 'meta', label: 'Meta', status: 'active', builtin: 'meta' }),
      provider({ id: ID(4), key: 'a', label: 'Alpha', status: 'disabled', isDefault: true }),
    ];
    expect(sortProviders(list).map((p) => p.key)).toEqual(['a', 'meta', 'b', 'z']);
  });

  it('filters by status and by name or key, and counts per status', () => {
    const list = [
      provider({ id: ID(1), key: 'alpha', label: 'Alpha', status: 'active' }),
      provider({ id: ID(2), key: 'beta', label: 'Beta BSP', status: 'disabled' }),
    ];
    expect(filterProviders(list, 'active', '').map((p) => p.key)).toEqual(['alpha']);
    expect(filterProviders(list, 'all', 'bsp').map((p) => p.key)).toEqual(['beta']);
    expect(filterProviders(list, 'all', 'ALP').map((p) => p.key)).toEqual(['alpha']);
    expect(statusCounts(list)).toEqual({ all: 2, active: 1, disabled: 1, archived: 0 });
    expect(selectableProviders(list).map((p) => p.key)).toEqual(['alpha']);
  });
});

describe('permissions', () => {
  it('reads the three keys from the caller map; a missing key is not held', () => {
    expect(
      wapAccess({
        'platform.whatsapp_providers.view': true,
        'platform.whatsapp_providers.manage': false,
      }),
    ).toEqual({ view: true, manage: false, switch: false });
    expect(wapAccess(undefined)).toEqual({ view: false, manage: false, switch: false });
  });

  it('names the first missing permission for the no-access page', () => {
    const a = { view: true, manage: false, switch: false };
    expect(missingPermission(a, ['view'])).toBeNull();
    expect(missingPermission(a, ['view', 'switch'])).toBe('platform.whatsapp_providers.switch');
  });
});

const api = (
  status: number,
  code: string,
  fieldErrors: Array<{ path: string; message: string }> = [],
) => new ApiError(status, code, 'text that must never be read', 'req-9', fieldErrors);

describe('wapError', () => {
  it('maps each registry code to a key and puts field errors on their field', () => {
    expect(wapError(api(409, ERROR_CODES.WAP_PROVIDER_KEY_TAKEN))).toMatchObject({
      kind: 'field',
      key: 'keyTaken',
      field: 'key',
    });
    expect(
      wapError(
        api(422, ERROR_CODES.WAP_BASE_URL_REFUSED, [
          { path: 'baseUrl', message: 'resolves to a private address' },
        ]),
      ),
    ).toMatchObject({
      kind: 'field',
      key: 'baseUrlRefused',
      field: 'baseUrl',
      values: { detail: 'resolves to a private address' },
    });
    expect(wapError(api(422, ERROR_CODES.WAP_BASE_URL_REFUSED))).toMatchObject({
      key: 'baseUrlRefusedPlain',
    });
    expect(wapError(api(409, ERROR_CODES.WAP_PROVIDER_IN_USE)).key).toBe('inUse');
    expect(wapError(api(409, ERROR_CODES.WAP_PROVIDER_DISABLED)).key).toBe('disabled');
    expect(wapError(api(409, ERROR_CODES.WAP_CREDENTIALS_MISSING)).key).toBe('credentialsMissing');
    expect(wapError(api(409, ERROR_CODES.WAP_PROVIDER_IS_DEFAULT)).key).toBe('isDefault');
    expect(wapError(api(409, ERROR_CODES.WAP_PROVIDER_BUILTIN)).key).toBe('builtin');
    expect(wapError(api(409, ERROR_CODES.WAP_SWITCH_NOTHING_TO_DO)).key).toBe('nothingToDo');
    expect(wapError(api(409, ERROR_CODES.PROVIDER_UNAVAILABLE)).key).toBe('unavailable');
    expect(wapError(api(404, ERROR_CODES.NOT_FOUND)).key).toBe('notFound');
  });

  it('asks for a reload on a row version conflict and names the missing permission on a 403', () => {
    expect(wapError(api(409, ERROR_CODES.ROW_VERSION_CONFLICT))).toMatchObject({
      kind: 'conflict',
      requestId: 'req-9',
    });
    expect(
      wapError(
        api(403, ERROR_CODES.RBAC_PLATFORM_PERMISSION_REQUIRED, [
          { path: 'permission', message: 'platform.whatsapp_providers.switch' },
        ]),
      ),
    ).toMatchObject({
      kind: 'noAccess',
      values: { permission: 'platform.whatsapp_providers.switch' },
    });
    expect(isNoAccess(api(403, ERROR_CODES.RBAC_PLATFORM_PERMISSION_REQUIRED))).toBe(true);
    expect(isNoAccess(api(403, ERROR_CODES.FORBIDDEN))).toBe(true);
    expect(isNoAccess(api(409, ERROR_CODES.WAP_PROVIDER_IN_USE))).toBe(false);
  });

  it('maps validation failures to a field, and the 50 number limit to its own message', () => {
    expect(
      wapError(
        api(422, ERROR_CODES.VALIDATION_FAILED, [
          { path: 'credentials.providerToken', message: 'Too short' },
        ]),
      ),
    ).toMatchObject({
      kind: 'field',
      key: 'validationField',
      field: 'credentials.providerToken',
      values: { message: 'Too short' },
    });
    expect(
      wapError(
        api(422, ERROR_CODES.VALIDATION_FAILED, [{ path: 'numberIds', message: 'More than 50' }]),
      ).key,
    ).toBe('tooManyNumbers');
    expect(wapError(api(422, ERROR_CODES.VALIDATION_FAILED)).key).toBe('validation');
  });

  it('never reads message text, and falls back by status', () => {
    expect(wapError(api(400, 'SOMETHING_NEW')).key).toBe('request');
    expect(wapError(api(502, 'SOMETHING_NEW')).key).toBe('unexpected');
    expect(wapError(new Error('boom')).key).toBe('unexpected');
  });

  it('only answers keys that are listed for the messages test', () => {
    const answered = [
      wapError(api(409, ERROR_CODES.ROW_VERSION_CONFLICT)).key,
      wapError(api(403, ERROR_CODES.RBAC_PLATFORM_PERMISSION_REQUIRED)).key,
      wapError(api(409, ERROR_CODES.WAP_PROVIDER_KEY_TAKEN)).key,
      wapError(api(422, ERROR_CODES.WAP_BASE_URL_REFUSED)).key,
      wapError(api(422, ERROR_CODES.VALIDATION_FAILED)).key,
      wapError(api(500, 'X')).key,
    ];
    for (const k of answered) expect(WAP_ERROR_KEYS).toContain(k);
  });
});

describe('switch plan', () => {
  const form = { targetProviderId: ID(20), fromProviderId: '', setOverride: false, reason: '  ' };

  it('builds the dry run and the apply request from the same form', () => {
    expect(buildSwitchRequest(form, { dryRun: true })).toEqual({
      targetProviderId: ID(20),
      dryRun: true,
      setOverride: false,
    });
    const apply = buildSwitchRequest(
      { ...form, fromProviderId: ID(10), setOverride: true, reason: ' quarterly move ' },
      { dryRun: false, numberIds: [ID(101)] },
    );
    expect(apply).toEqual({
      targetProviderId: ID(20),
      fromProviderId: ID(10),
      dryRun: false,
      setOverride: true,
      numberIds: [ID(101)],
      reason: 'quarterly move',
    });
    // never an empty list: the API refuses it
    expect(buildSwitchRequest(form, { dryRun: false, numberIds: [] }).numberIds).toBeUndefined();
  });

  it('needs a workspace and a target that differs from the source', () => {
    expect(canDryRun(ID(7), form)).toBe(true);
    expect(canDryRun('', form)).toBe(false);
    expect(canDryRun(ID(7), { ...form, targetProviderId: '' })).toBe(false);
    expect(canDryRun(ID(7), { ...form, fromProviderId: ID(20) })).toBe(false);
  });

  it('changes the signature whenever an input changes, so a stale dry run is never applied', () => {
    const base = formSignature(ID(7), form);
    expect(formSignature(ID(7), form)).toBe(base);
    expect(formSignature(ID(8), form)).not.toBe(base);
    expect(formSignature(ID(7), { ...form, setOverride: true })).not.toBe(base);
    expect(formSignature(ID(7), { ...form, targetProviderId: ID(21) })).not.toBe(base);
    expect(formSignature(ID(7), { ...form, reason: 'x' })).not.toBe(base);
  });

  it('summarises a dry run in numbers', () => {
    const s = summarizePlan(switchResponse());
    expect(s).toMatchObject({
      total: 3,
      ready: 2,
      blocked: 1,
      failed: 0,
      needReconnect: 1,
      canApply: true,
    });
    expect(s.readyIds).toEqual([ID(101), ID(102)]);
    expect(s.requirements).toEqual({ reconnect_needed: 1, number_token_needed: 1 });
  });

  it('cannot apply when nothing is ready', () => {
    const r = switchResponse({
      numbers: switchResponse().numbers.filter((n) => n.state === 'blocked'),
    });
    expect(summarizePlan(r).canApply).toBe(false);
  });

  it('sends every number the API would pick when all ready ones are ticked, otherwise exactly the ticked ones', () => {
    const plan = summarizePlan(switchResponse());
    expect(numberIdsToApply(plan, new Set([ID(101), ID(102)]))).toBeUndefined();
    expect(numberIdsToApply(plan, new Set([ID(101)]))).toEqual([ID(101)]);
    expect(numberIdsToApply(plan, new Set([ID(103)]))).toBeUndefined();
    expect(numberIdsToApply(plan, new Set())).toBeUndefined();
  });

  it('summarises an applied switch and names where to roll back to', () => {
    const result = switchResponse({
      dryRun: false,
      overrideSet: true,
      numbers: [
        { ...switchResponse().numbers[0]!, state: 'switched', inboundWired: false },
        { ...switchResponse().numbers[1]!, state: 'repointed' },
        { ...switchResponse().numbers[2]!, state: 'blocked' },
        {
          ...switchResponse().numbers[0]!,
          numberId: ID(150),
          state: 'failed',
          from: { id: ID(11), key: 'interakt', label: 'Interakt' },
        },
      ],
    });
    const s = summarizeResult(result);
    expect(s).toMatchObject({
      total: 4,
      switched: 1,
      repointed: 1,
      failed: 1,
      blocked: 1,
      inboundNotWired: 1,
      allMoved: false,
      noneMoved: false,
    });
    // only providers numbers actually moved from
    expect(s.rollbackTargets.map((p) => p.key)).toEqual(['meta']);
  });

  it('flags a clean result and a result where nothing moved', () => {
    const clean = switchResponse({
      dryRun: false,
      numbers: [{ ...switchResponse().numbers[0]!, state: 'switched', inboundWired: true }],
    });
    expect(summarizeResult(clean)).toMatchObject({
      allMoved: true,
      noneMoved: false,
      inboundNotWired: 0,
    });
    const none = switchResponse({
      dryRun: false,
      numbers: [{ ...switchResponse().numbers[0]!, state: 'failed' }],
    });
    expect(summarizeResult(none)).toMatchObject({ allMoved: false, noneMoved: true });
  });

  it('prepares the rollback as a switch back of exactly what was moved', () => {
    const result = switchResponse({
      dryRun: false,
      numbers: [{ ...switchResponse().numbers[0]!, state: 'switched' }],
    });
    const previous = { id: ID(10), key: 'meta', label: 'Meta' };
    expect(rollbackForm(result, previous)).toEqual({
      targetProviderId: ID(10),
      fromProviderId: ID(20),
      setOverride: false,
      reason: '',
    });
    const none = switchResponse({
      dryRun: false,
      numbers: [{ ...switchResponse().numbers[0]!, state: 'failed' }],
    });
    expect(rollbackForm(none, previous)).toBeNull();
  });
});

describe('test connection', () => {
  it('builds a request from the form with the default path and no blank optionals', () => {
    expect(buildTestRequest(emptyTestForm())).toEqual({ ok: true, body: { path: '/me' } });
    expect(
      buildTestRequest({
        path: ' /debug_token ',
        wabaId: ' 123 ',
        phoneNumberId: '',
        channelToken: ' tok-12345678 ',
      }),
    ).toEqual({
      ok: true,
      body: { path: '/debug_token', wabaId: '123', channelToken: 'tok-12345678' },
    });
  });

  it('points at the field the contract refuses', () => {
    expect(buildTestRequest({ ...emptyTestForm(), path: 'me' })).toEqual({
      ok: false,
      field: 'path',
    });
    expect(buildTestRequest({ ...emptyTestForm(), wabaId: 'has space' })).toEqual({
      ok: false,
      field: 'wabaId',
    });
    expect(buildTestRequest({ ...emptyTestForm(), channelToken: 'short' })).toEqual({
      ok: false,
      field: 'channelToken',
    });
  });

  it('tells the operator what to fix first', () => {
    const r = (httpStatus: number | null, errorCode: string | null, ok = false) => ({
      ok,
      httpStatus,
      errorCode,
    });
    expect(testHint(r(200, null, true))).toBe('ok');
    expect(testHint(r(null, 'WAP_BASE_URL_REFUSED'))).toBe('addressRefused');
    expect(testHint(r(null, 'WAP_CREDENTIALS_MISSING'))).toBe('credentialsMissing');
    expect(testHint(r(401, 'HTTP_401'))).toBe('unauthorized');
    expect(testHint(r(403, null))).toBe('unauthorized');
    expect(testHint(r(404, null))).toBe('notFound');
    expect(testHint(r(429, null))).toBe('rateLimited');
    expect(testHint(r(503, null))).toBe('providerError');
    expect(testHint(r(null, 'TIMEOUT'))).toBe('unreachable');
    expect(testHint(r(418, null))).toBe('other');
  });

  it('offers a test token only where numbers hold their own', () => {
    expect(takesChannelToken({ credentialMode: 'channel_token', headerTemplates: {} })).toBe(true);
    expect(
      takesChannelToken({
        credentialMode: 'platform_token',
        headerTemplates: { a: '{{channelToken}}' },
      }),
    ).toBe(true);
    expect(
      takesChannelToken({
        credentialMode: 'platform_token',
        headerTemplates: { a: '{{providerToken}}' },
      }),
    ).toBe(false);
  });
});
