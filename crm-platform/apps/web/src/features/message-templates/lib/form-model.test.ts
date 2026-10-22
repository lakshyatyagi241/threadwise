import { describe, expect, it } from 'vitest';
import {
  createTemplateInputSchema,
  lintTemplateInputSchema,
  updateTemplateInputSchema,
  type TemplateDetail,
} from '@crm/contracts';
import { newRow } from './buttons';
import {
  contractIssues,
  hasHeaderFile,
  initialState,
  locationOf,
  previewOf,
  sanitizeName,
  stateFromDetail,
  tidyName,
  toCreateInput,
  toLintInput,
  toUpdateInput,
  withBody,
  withHeaderKind,
  withHeaderText,
  type FormState,
} from './form-model';

const CONN = '11111111-1111-4111-8111-111111111111';

const filled = (over: Partial<FormState> = {}): FormState => ({
  ...initialState(CONN),
  name: 'order_ready',
  body: 'Hi {{name}}, order {{order}} is ready',
  ...over,
});

describe('template name', () => {
  it('is lowercased and limited to a-z 0-9 _ while typing', () => {
    expect(sanitizeName('Order Ready!')).toBe('order_ready');
    expect(sanitizeName('a'.repeat(80))).toHaveLength(60);
  });
  it('collapses repeats and trims the edges on blur', () => {
    expect(tidyName('__order___ready__')).toBe('order_ready');
  });
});

describe('form state to API input', () => {
  it('produces input the contract accepts, with placeholders numbered', () => {
    let s = withBody(filled(), 'Hi {{name}}, order {{order}} is ready, {{name}}');
    s = { ...s, bodySlots: { ...s.bodySlots, name: { key: 'first_name', example: 'Asha' } } };
    const input = toCreateInput(s, true);
    expect(createTemplateInputSchema.parse(input)).toEqual(input);
    expect(input.body).toBe('Hi {{1}}, order {{2}} is ready, {{1}}');
    expect(input.variableMap?.body).toEqual([
      { num: 1, key: 'first_name', example: 'Asha' },
      { num: 2, key: 'order' },
    ]);
    expect(input.connectionId).toBe(CONN);
    expect(input.submit).toBe(true);
    expect(input.templateType).toBe('standard');
    expect(input.parameterFormat).toBe('POSITIONAL');
  });

  it('keeps Save draft from submitting', () => {
    expect(toCreateInput(filled(), false).submit).toBe(false);
  });

  it('sends a text header normalised, and a media header with its handle', () => {
    const text = withHeaderText(withHeaderKind(filled(), 'text'), 'Order {{id}}');
    expect(toCreateInput(text, false)).toMatchObject({
      header: 'Order {{1}}',
      attachmentType: 'none',
    });
    const media = {
      ...withHeaderKind(filled(), 'image'),
      headerHandle: 'h:123',
      headerFileName: 'a.png',
    };
    expect(toCreateInput(media, false)).toMatchObject({
      header: null,
      attachmentType: 'image',
      headerHandle: 'h:123',
      templateType: 'media',
    });
    expect(hasHeaderFile(media)).toBe(true);
    expect(hasHeaderFile(withHeaderKind(filled(), 'image'))).toBe(false);
  });

  it('drops the old header content when the header kind changes', () => {
    const media = {
      ...withHeaderKind(filled(), 'image'),
      headerHandle: 'h:1',
      headerFileName: 'a.png',
    };
    const text = withHeaderKind(media, 'text');
    expect(text.headerHandle).toBe('');
    expect(
      withHeaderKind(withHeaderText(withHeaderKind(filled(), 'text'), 'x'), 'none').headerText,
    ).toBe('');
  });

  it('maps buttons and an empty footer', () => {
    const s = filled({ footer: '  ', buttons: [{ ...newRow('quick_reply'), text: 'Yes' }] });
    const input = toCreateInput(s, false);
    expect(input.footer).toBeNull();
    expect(input.buttons).toEqual([{ type: 'QUICK_REPLY', text: 'Yes' }]);
  });

  it('builds an authentication template with the OTP button and expiry only', () => {
    const s = filled({
      metaCategory: 'AUTHENTICATION',
      otpExpiry: '10',
      body: 'ignored',
      footer: 'ignored',
    });
    const input = toCreateInput(s, true);
    expect(createTemplateInputSchema.parse(input)).toBeTruthy();
    expect(input).toMatchObject({
      templateType: 'auth',
      body: '',
      footer: null,
      header: null,
      codeExpirationMinutes: 10,
    });
    expect(input.buttons).toEqual([{ type: 'OTP', otp_type: 'COPY_CODE', text: 'Copy code' }]);
  });

  it('builds the update and lint inputs from the same fields', () => {
    const s = filled();
    const up = toUpdateInput(s, 4, false);
    expect(up.rowVersion).toBe(4);
    expect(updateTemplateInputSchema.parse(up)).toBeTruthy();
    expect(lintTemplateInputSchema.parse(toLintInput(s))).toBeTruthy();
    expect(toLintInput(s).hasHeaderFile).toBe(false);
  });
});

describe('contract issues', () => {
  it('reports a missing name, an over-long body and a bad expiry', () => {
    expect(contractIssues(filled({ name: '' })).name).toBeTruthy();
    expect(contractIssues(filled({ body: 'x'.repeat(1025) })).body).toBeTruthy();
    expect(
      contractIssues(filled({ metaCategory: 'AUTHENTICATION', otpExpiry: '120' }))
        .codeExpirationMinutes,
    ).toBeTruthy();
    expect(contractIssues(filled())).toEqual({});
  });
});

describe('editing a saved template', () => {
  const detail = {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'promo',
    language: 'en_GB',
    metaCategory: 'MARKETING',
    templateType: 'media',
    status: 'rejected',
    connectionId: CONN,
    header: null,
    attachmentType: 'image',
    headerSampleUrl: 'https://cdn.test/a.png',
    body: 'Hi {{1}}',
    footer: 'Bye',
    buttons: [{ type: 'URL', text: 'Shop', url: 'https://x.test' }],
    variableMap: { body: [{ num: 1, key: 'first_name', example: 'Asha' }] },
    codeExpirationMinutes: null,
    parameterFormat: 'POSITIONAL',
  } as unknown as TemplateDetail;

  it('loads into the form and keeps the saved header sample', () => {
    const s = stateFromDetail(detail);
    expect(s).toMatchObject({
      name: 'promo',
      language: 'en_GB',
      headerKind: 'image',
      connectionId: CONN,
    });
    expect(s.bodySlots['1']).toEqual({ key: 'first_name', example: 'Asha' });
    expect(s.buttons[0]).toMatchObject({ kind: 'url', text: 'Shop' });
    expect(hasHeaderFile(s)).toBe(true);
    expect(toUpdateInput(s, 2, true)).toMatchObject({
      attachmentType: 'image',
      headerSampleUrl: 'https://cdn.test/a.png',
      rowVersion: 2,
      submit: true,
    });
  });

  it('shows samples in the preview', () => {
    const p = previewOf(stateFromDetail(detail));
    expect(p.body).toBe('Hi Asha');
    expect(p.headerImageUrl).toBe('https://cdn.test/a.png');
    expect(p.footer).toBe('Bye');
    expect(p.buttons).toEqual([{ kind: 'url', text: 'Shop' }]);
  });

  it('shows the stored header file when Meta kept no sample URL', () => {
    const stored = {
      ...detail,
      headerSampleUrl: null,
      headerMediaUrl: 'https://cdn.test/stored.png',
    } as unknown as TemplateDetail;
    const s = stateFromDetail(stored);
    expect(s.headerPreviewUrl).toBe('https://cdn.test/stored.png');
    expect(previewOf(s).headerImageUrl).toBe('https://cdn.test/stored.png');
    // Nothing new was uploaded, so the save sends no key and the server keeps the stored file.
    expect(toUpdateInput(s, 2, false).headerMediaKey).toBeNull();
  });

  it('sends the key of a fresh upload so the file is kept with the template', () => {
    const key = 'template-media/7/1700000000_ab.png';
    const s = filled({ headerKind: 'image', headerHandle: '4::abc', headerMediaKey: key });
    expect(toUpdateInput(s, 2, false).headerMediaKey).toBe(key);
  });
});

describe('location header', () => {
  const pin = (over: Partial<FormState> = {}) =>
    filled({ headerKind: 'location', latitude: '19.0760', longitude: '72.8777', ...over });

  it('reads the typed coordinates, and refuses empty, non-numeric or out-of-range ones', () => {
    expect(locationOf(pin())).toEqual({
      latitude: 19.076,
      longitude: 72.8777,
      name: null,
      address: null,
    });
    expect(locationOf(pin({ latitude: '' }))).toBeNull();
    expect(locationOf(pin({ longitude: 'abc' }))).toBeNull();
    expect(locationOf(pin({ latitude: '91' }))).toBeNull();
    expect(locationOf(pin({ longitude: '-181' }))).toBeNull();
  });

  it('sends the pin with the name and address, and only for a location header', () => {
    const f = toCreateInput(pin({ locationName: ' HQ ', locationAddress: 'Mumbai' }), false);
    expect(f.attachmentType).toBe('location');
    expect(f.headerLocation).toEqual({
      latitude: 19.076,
      longitude: 72.8777,
      name: 'HQ',
      address: 'Mumbai',
    });
    expect(
      toCreateInput(filled({ latitude: '1', longitude: '2' }), false).headerLocation,
    ).toBeNull();
    expect(createTemplateInputSchema.safeParse(f).success).toBe(true);
  });

  it('clears the pin when the attachment changes', () => {
    const s = withHeaderKind(pin({ locationName: 'HQ' }), 'image');
    expect([s.latitude, s.longitude, s.locationName, s.locationAddress]).toEqual(['', '', '', '']);
  });
});
