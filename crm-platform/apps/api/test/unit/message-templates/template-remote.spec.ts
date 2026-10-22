import { describe, expect, it } from 'vitest';
import { tplStatusSchema } from '@crm/contracts';
import { WabaApiError } from '../../../src/infra/providers/whatsapp-cloud-api-waba/waba-errors';
import {
  applyTemplateEvent,
  localStatusFor,
} from '../../../src/modules/whatsapp-cloud-api-waba/template-event-rules';
import { describeTemplateFailure } from '../../../src/modules/message-templates/template-errors';
import { prepareTemplate } from '../../../src/modules/message-templates/template-input';
import { buildMetaTemplate } from '../../../src/modules/message-templates/template-payload';
import {
  columnsOfState,
  mergeVariableMap,
  parseRemoteComponents,
  sameLanguage,
  statePatchFrom,
  type CurrentState,
} from '../../../src/modules/message-templates/template-remote';
import { statusOf, toDetail } from '../../../src/modules/message-templates/templates.mapper';
import type { TemplateRow } from '../../../src/modules/message-templates/templates.repository';

const NOW = new Date('2026-10-02T10:00:00Z');
const blank: CurrentState = {
  status: 'pending',
  metaCategory: null,
  qualityScore: null,
  approvedAt: null,
  pausedUntil: null,
};
const remote = (over: Partial<Parameters<typeof statePatchFrom>[0]> = {}) => ({
  status: 'APPROVED',
  category: 'UTILITY',
  qualityScore: null,
  rejectedReason: null,
  correctCategory: null,
  ...over,
});

describe('Meta state onto a row (TW-TPL-026, 027, 030)', () => {
  it('approves, stamps approved_at once and takes Meta category in upper case', () => {
    const p = statePatchFrom(remote({ category: 'marketing' }), blank, NOW, localStatusFor);
    expect(p).toMatchObject({
      metaStatus: 'APPROVED',
      status: 'approved',
      metaCategory: 'MARKETING',
    });
    expect(p.approvedAt).toEqual(NOW);
    const again = statePatchFrom(
      remote(),
      { ...blank, approvedAt: new Date('2026-09-01') },
      NOW,
      localStatusFor,
    );
    expect(again.approvedAt).toBeUndefined();
  });

  it('keeps a known quality score when Meta says UNKNOWN', () => {
    const p = statePatchFrom(
      remote({ qualityScore: 'UNKNOWN' }),
      { ...blank, qualityScore: 'GREEN' },
      NOW,
      localStatusFor,
    );
    expect(p.qualityScore).toBe('GREEN');
  });

  it('pauses for a day on RED (not for authentication) and on PAUSED, and never shortens a pause that is running', () => {
    const red = statePatchFrom(remote({ qualityScore: 'RED' }), blank, NOW, localStatusFor);
    expect(red.pausedUntil).toEqual(new Date('2026-10-03T10:00:00Z'));
    expect(
      statePatchFrom(
        remote({ qualityScore: 'RED', category: 'AUTHENTICATION' }),
        blank,
        NOW,
        localStatusFor,
      ).pausedUntil,
    ).toBeUndefined();
    const paused = statePatchFrom(remote({ status: 'PAUSED' }), blank, NOW, localStatusFor);
    expect(paused).toMatchObject({ status: 'paused' });
    expect(paused.pausedUntil).toEqual(new Date('2026-10-03T10:00:00Z'));
    const running = statePatchFrom(
      remote({ status: 'PAUSED' }),
      { ...blank, pausedUntil: new Date('2026-10-05T00:00:00Z') },
      NOW,
      localStatusFor,
    );
    expect(running.pausedUntil).toBeUndefined();
  });

  it('keeps the rejection code, or NONE, and clears the refusal text on approval', () => {
    expect(
      statePatchFrom(
        remote({ status: 'REJECTED', rejectedReason: 'invalid_format' }),
        blank,
        NOW,
        localStatusFor,
      ),
    ).toMatchObject({ status: 'rejected', rejectionReasonCode: 'INVALID_FORMAT' });
    expect(
      statePatchFrom(remote({ status: 'REJECTED' }), blank, NOW, localStatusFor)
        .rejectionReasonCode,
    ).toBe('NONE');
    const ok = statePatchFrom(remote(), blank, NOW, localStatusFor);
    expect(columnsOfState(ok)).toMatchObject({ rejectionReason: null, rejectionReasonCode: null });
  });

  it('leaves the local status alone for a Meta state it does not know', () => {
    const p = statePatchFrom(remote({ status: 'SOMETHING_NEW' }), blank, NOW, localStatusFor);
    expect(p.status).toBeNull();
    expect(columnsOfState(p)).not.toHaveProperty('status');
  });
});

describe('the webhook and the sync agree on the local status', () => {
  const metaStates = [
    'APPROVED',
    'REJECTED',
    'PENDING',
    'IN_APPEAL',
    'PENDING_DELETION',
    'PAUSED',
    'DISABLED',
    'LIMIT_EXCEEDED',
    'FLAGGED',
    'DELETED',
    'REINSTATED',
  ];

  it.each(metaStates)('%s', (state) => {
    const viaSync = statePatchFrom(remote({ status: state }), blank, NOW, localStatusFor).status;
    const viaWebhook = applyTemplateEvent(
      'message_template_status_update',
      { event: state },
      {
        status: 'pending',
        metaStatus: null,
        qualityScore: null,
        category: 'utility',
        approvedAt: null,
        metaTemplateId: '1',
      },
      NOW,
    )!.status;
    expect(viaSync).toBe(viaWebhook ?? null);
    // Every local value is one the contract knows.
    expect(tplStatusSchema.safeParse(viaSync).success).toBe(true);
  });
});

describe('parsing Meta components (TW-TPL-028 rule 6)', () => {
  it('is the inverse of the payload builder for a text template with buttons', () => {
    const prepared = prepareTemplate({
      name: 'Order Update',
      language: 'en_US',
      metaCategory: 'UTILITY',
      templateType: 'standard',
      header: 'Order {{order}}',
      attachmentType: 'none',
      body: 'Hi {{name}}, {{order}} is ready.',
      footer: 'Thanks',
      buttons: [
        { type: 'URL', text: 'Track', url: 'https://x.test/{{1}}', example: ['https://x.test/1'] },
        { type: 'QUICK_REPLY', text: 'Stop' },
      ],
      variableMap: {
        body: [
          { num: 1, key: 'name', example: 'Ana' },
          { num: 2, key: 'order', example: '42' },
        ],
      },
      parameterFormat: 'POSITIONAL',
    });
    const meta = buildMetaTemplate({
      name: prepared.name,
      language: prepared.language,
      metaCategory: prepared.metaCategory,
      templateType: prepared.templateType,
      header: prepared.header,
      body: prepared.body,
      footer: prepared.footer,
      buttons: prepared.buttons,
      variableMap: prepared.variableMap,
    });
    const parsed = parseRemoteComponents(meta.components, 'UTILITY');
    expect(parsed).toMatchObject({
      header: 'Order {{1}}',
      body: 'Hi {{1}}, {{2}} is ready.',
      footer: 'Thanks',
      attachmentType: 'none',
      templateType: 'standard',
    });
    expect(parsed.buttons.map((b) => b.type)).toEqual(['URL', 'QUICK_REPLY']);
    expect(parsed.variableMap.body).toEqual([
      { num: 1, key: '1', example: 'Ana' },
      { num: 2, key: '2', example: '42' },
    ]);
  });

  it('reads a media header, its sample and an authentication template', () => {
    const media = parseRemoteComponents(
      [
        { type: 'HEADER', format: 'IMAGE', example: { header_handle: ['https://cdn.test/a.png'] } },
        { type: 'BODY', text: 'Look' },
      ],
      'MARKETING',
    );
    expect(media).toMatchObject({
      attachmentType: 'image',
      headerSampleUrl: 'https://cdn.test/a.png',
      templateType: 'media',
      header: null,
    });
    const auth = parseRemoteComponents(
      [
        { type: 'BODY', add_security_recommendation: true },
        { type: 'FOOTER', code_expiration_minutes: 10 },
        { type: 'BUTTONS', buttons: [{ type: 'OTP', otp_type: 'COPY_CODE' }] },
      ],
      'AUTHENTICATION',
    );
    expect(auth).toMatchObject({ templateType: 'auth', codeExpirationMinutes: 10 });
  });

  it('keeps a shape it only displays under its own name', () => {
    expect(
      parseRemoteComponents(
        [
          { type: 'BODY', text: 'x' },
          { type: 'CAROUSEL', cards: [] },
        ],
        'MARKETING',
      ).templateType,
    ).toBe('carousel');
  });

  it('a sync keeps the attribute an operator mapped, and takes the examples Meta holds', () => {
    const merged = mergeVariableMap(
      {
        body: [
          { num: 1, key: '1', example: 'Ana' },
          { num: 2, key: '2' },
        ],
      },
      {
        body: [
          { num: 1, key: 'first_name' },
          { num: 2, key: '2' },
        ],
      },
    );
    expect(merged.body).toEqual([
      { num: 1, key: 'first_name', example: 'Ana' },
      { num: 2, key: '2' },
    ]);
  });

  it('matches a language by its base when the region differs', () => {
    expect(sameLanguage('en', 'en_US')).toBe(true);
    expect(sameLanguage('en_US', 'en-us')).toBe(true);
    expect(sameLanguage('en_US', 'hi')).toBe(false);
  });
});

describe('preparing the authored form (TW-TPL-007 rules 5, 8, 10)', () => {
  const base = {
    name: 'Spring Promo!',
    language: 'en_US',
    metaCategory: 'MARKETING' as const,
    templateType: 'standard',
    attachmentType: 'none',
    body: 'Hi {{first_name}}, order {{order_id}} ready',
    buttons: [],
    parameterFormat: 'POSITIONAL' as const,
  };

  it('stores positional text and keeps the attribute behind each slot', () => {
    const p = prepareTemplate(base);
    expect(p.body).toBe('Hi {{1}}, order {{2}} ready');
    expect(p.variableMap.body).toEqual([
      { num: 1, key: 'first_name' },
      { num: 2, key: 'order_id' },
    ]);
    expect(p.name).toBe('spring_promo');
    expect(p.category).toBe('marketing');
    expect(p.attachmentType).toBeNull();
  });

  it("carries the author's examples by slot number", () => {
    const p = prepareTemplate({
      ...base,
      variableMap: { body: [{ num: 1, key: '1', example: 'Ana' }] },
    });
    expect(p.variableMap.body![0]).toEqual({ num: 1, key: 'first_name', example: 'Ana' });
  });

  it('leaves named variables as typed in a NAMED template', () => {
    const p = prepareTemplate({ ...base, parameterFormat: 'NAMED' });
    expect(p.body).toBe('Hi {{first_name}}, order {{order_id}} ready');
  });

  it('drops everything an authentication template cannot have', () => {
    const p = prepareTemplate({
      ...base,
      metaCategory: 'AUTHENTICATION',
      header: 'x',
      footer: 'y',
      buttons: [{ type: 'URL', text: 'a', url: 'https://a.test' }],
      codeExpirationMinutes: 10,
    });
    expect(p).toMatchObject({
      templateType: 'auth',
      header: null,
      footer: null,
      buttons: [],
      codeExpirationMinutes: 10,
    });
  });

  it('only a media header keeps its handle', () => {
    expect(
      prepareTemplate({ ...base, attachmentType: 'image', headerHandle: 'h1' }).headerHandle,
    ).toBe('h1');
    expect(prepareTemplate({ ...base, headerHandle: 'h1' }).headerHandle).toBeNull();
  });
});

describe('what Meta said, in words an operator can use (TW-TPL-025 rule 9)', () => {
  const err = (code: number, message: string, status = 400, subcode: number | null = null) =>
    WabaApiError.fromResponse(status, { error: { message, code, error_subcode: subcode } });

  it("explains an expired token and keeps Meta's words and code", () => {
    const f = describeTemplateFailure(err(190, 'Error validating access token'));
    expect(f.message).toContain('Reconnect this WhatsApp number');
    expect(f.message).toContain('Error validating access token');
    expect(f.message).toContain('code 190');
    expect(f.retryable).toBe(false);
  });

  it('knows the name clash and a throttle', () => {
    expect(describeTemplateFailure(err(132007, 'dup')).message).toContain(
      'already exists for a different language',
    );
    expect(describeTemplateFailure(err(4, 'too many calls', 400)).retryable).toBe(true);
    expect(describeTemplateFailure(err(1, 'boom', 503)).retryable).toBe(true);
  });

  it('survives a plain Error', () => {
    expect(describeTemplateFailure(new Error('boom'))).toEqual({
      message: 'boom',
      retryable: false,
    });
  });
});

describe('row to API shape', () => {
  const row = (over: Partial<TemplateRow> = {}): TemplateRow => ({
    id: 7,
    uuid: '5f1f0a3e-1111-4222-8333-444455556666',
    userId: 1,
    templateName: 'promo',
    language: 'en_US',
    header: null,
    templateBody: 'Hello {{1}}',
    footer: null,
    codeExpirationMinutes: null,
    buttons: null,
    variableMap: { body: [{ num: 1, key: 'name', example: 'Ana' }] },
    category: 'utility',
    metaCategory: 'UTILITY',
    templateType: 'standard',
    attachmentType: null,
    attachmentFile: null,
    headerSampleUrl: null,
    headerMediaKey: null,
    headerLocation: null,
    parameterFormat: 'POSITIONAL',
    status: 'pending',
    metaStatus: null,
    metaTemplateId: null,
    metaEditLog: [],
    qualityScore: null,
    rejectionReason: null,
    rejectionReasonCode: null,
    approvedAt: null,
    submittedAt: null,
    lastSyncedAt: null,
    pausedUntil: null,
    providerConfigId: 3,
    connectionUuid: null,
    rowVersion: 2,
    createdAt: NOW,
    createdAtIso: NOW.toISOString(),
    updatedAt: NOW,
    ...over,
  });

  it("reads Reference's public as approved and an unknown status as pending", () => {
    expect(statusOf({ status: 'public' })).toBe('approved');
    expect(statusOf({ status: 'weird' })).toBe('pending');
  });

  it('never exposes an internal id and shows the payload and lint', () => {
    const d = toDetail(row());
    expect(d.id).toBe('5f1f0a3e-1111-4222-8333-444455556666');
    expect(JSON.stringify(d)).not.toContain('"providerConfigId"');
    expect(d.metaPayload).toMatchObject({ name: 'promo', category: 'UTILITY', language: 'en_US' });
    expect(d.buttons).toEqual([]);
    expect(d.attachmentType).toBe('none');
  });

  it("shows Meta's rejection code unless it says nothing", () => {
    expect(
      toDetail(row({ status: 'rejected', rejectionReasonCode: 'INVALID_FORMAT' })).rejectionReason,
    ).toBe('INVALID_FORMAT');
    expect(toDetail(row({ rejectionReasonCode: 'NONE' })).rejectionReason).toBeNull();
    expect(
      toDetail(row({ rejectionReason: 'Meta says no', rejectionReasonCode: 'NONE' }))
        .rejectionReason,
    ).toBe('Meta says no');
  });
});
