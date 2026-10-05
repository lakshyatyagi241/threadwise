import { describe, expect, it } from 'vitest';
import {
  buildSaveBody,
  credentialErrorKey,
  initialForm,
  isDirty,
  isSecretField,
  looksLikeMask,
  testOutcome,
  validateForm,
  withClear,
  withValue,
} from './gateway-form';
import { SHOP_A, razorpayDriver, savedGateway, stripeDriver } from './gateway-test-fixtures';

const [keyId, keySecret, webhook] = razorpayDriver.fields;

describe('initialForm', () => {
  it('starts blank for a new row: live and active', () => {
    const f = initialForm(razorpayDriver, undefined);
    expect(f.values).toEqual({ key_id: '', key_secret: '', webhook_secret: '' });
    expect(f.mode).toBe('live');
    expect(f.active).toBe(true);
    expect(f.clear).toEqual([]);
  });

  it('never prefills a saved value or its mask, only mode and active', () => {
    const f = initialForm(razorpayDriver, savedGateway({ mode: 'test', active: false }));
    expect(Object.values(f.values).every((v) => v === '')).toBe(true);
    expect(JSON.stringify(f)).not.toContain('••');
    expect(f.mode).toBe('test');
    expect(f.active).toBe(false);
  });
});

describe('secret fields', () => {
  it('password fields and the webhook secret are secrets, plain text is not', () => {
    expect(isSecretField(keyId!)).toBe(false);
    expect(isSecretField(keySecret!)).toBe(true);
    expect(isSecretField(webhook!)).toBe(true);
    expect(isSecretField({ ...keyId!, webhook: true })).toBe(true);
  });
});

describe('buildSaveBody', () => {
  const saved = savedGateway();

  it('keeps blank fields out: nothing typed means no credentials and no clear', () => {
    const body = buildSaveBody(
      razorpayDriver,
      saved,
      initialForm(razorpayDriver, saved),
      undefined,
    );
    expect(body).toEqual({ mode: 'test', active: true, rowVersion: 3 });
    expect('credentials' in body).toBe(false);
    expect('clear' in body).toBe(false);
  });

  it('sends only the typed fields, trimmed', () => {
    const form = withValue(initialForm(razorpayDriver, saved), 'key_secret', '  new-secret  ');
    const body = buildSaveBody(razorpayDriver, saved, form, undefined);
    expect(body.credentials).toEqual({ key_secret: 'new-secret' });
  });

  it('leaves storefrontId out for the workspace and sends it for a shop override', () => {
    const form = initialForm(razorpayDriver, undefined);
    expect('storefrontId' in buildSaveBody(razorpayDriver, undefined, form, undefined)).toBe(false);
    expect(buildSaveBody(razorpayDriver, undefined, form, SHOP_A).storefrontId).toBe(SHOP_A);
  });

  it('sends no rowVersion for a first save and the saved one for an update', () => {
    const form = initialForm(razorpayDriver, undefined);
    expect('rowVersion' in buildSaveBody(razorpayDriver, undefined, form, undefined)).toBe(false);
    expect(buildSaveBody(razorpayDriver, saved, form, undefined).rowVersion).toBe(3);
  });

  it('lists ticked clears for stored fields only', () => {
    let form = initialForm(razorpayDriver, saved);
    form = withClear(form, 'key_id', true);
    // webhook_secret holds nothing, so there is nothing to clear
    form = withClear(form, 'webhook_secret', true);
    expect(buildSaveBody(razorpayDriver, saved, form, undefined).clear).toEqual(['key_id']);
  });

  it('a field that is both typed and cleared is replaced, not cleared', () => {
    let form = withClear(initialForm(razorpayDriver, saved), 'key_id', true);
    form = withValue(form, 'key_id', 'rzp_test_new');
    expect(form.clear).toEqual([]);
    const body = buildSaveBody(razorpayDriver, saved, form, undefined);
    expect(body.credentials).toEqual({ key_id: 'rzp_test_new' });
    expect(body.clear).toBeUndefined();
  });

  it('ticking clear empties what was typed in the box', () => {
    let form = withValue(initialForm(razorpayDriver, saved), 'key_id', 'typed');
    form = withClear(form, 'key_id', true);
    expect(form.values.key_id).toBe('');
    expect(withClear(form, 'key_id', false).clear).toEqual([]);
  });

  it('never sends the mask the server showed, typed or pasted back', () => {
    for (const masked of ['••••••••9z9z', '••••••••']) {
      const form = withValue(initialForm(razorpayDriver, saved), 'key_secret', masked);
      const body = buildSaveBody(razorpayDriver, saved, form, undefined);
      expect(body.credentials).toBeUndefined();
    }
  });

  it('ignores keys that are not fields of the driver', () => {
    const form = withValue(initialForm(razorpayDriver, saved), 'rogue', 'x');
    expect(buildSaveBody(razorpayDriver, saved, form, undefined).credentials).toBeUndefined();
  });

  it('carries mode and active as chosen', () => {
    const form = { ...initialForm(razorpayDriver, saved), mode: 'live' as const, active: false };
    const body = buildSaveBody(razorpayDriver, saved, form, undefined);
    expect(body.mode).toBe('live');
    expect(body.active).toBe(false);
  });
});

describe('looksLikeMask', () => {
  it('recognises the server mask and bullet runs, not real keys', () => {
    expect(looksLikeMask('••••••••9z9z', '••••••••9z9z')).toBe(true);
    expect(looksLikeMask('•••••', null)).toBe(true);
    expect(looksLikeMask('***abcd', null)).toBe(false);
    expect(looksLikeMask('rzp_test_1234', '••••••••9z9z')).toBe(false);
    expect(looksLikeMask('   ', null)).toBe(false);
  });
});

describe('validateForm', () => {
  it('a first save needs every required field', () => {
    const problems = validateForm(
      razorpayDriver,
      undefined,
      initialForm(razorpayDriver, undefined),
    );
    expect(problems).toEqual([
      { key: 'key_id', kind: 'required' },
      { key: 'key_secret', kind: 'required' },
    ]);
  });

  it('whitespace is not a value', () => {
    const form = withValue(initialForm(razorpayDriver, undefined), 'key_id', '   ');
    expect(validateForm(razorpayDriver, undefined, form).map((p) => p.key)).toContain('key_id');
  });

  it('a mask typed into a required field does not count', () => {
    const form = withValue(initialForm(razorpayDriver, undefined), 'key_id', '••••••••');
    expect(validateForm(razorpayDriver, undefined, form).map((p) => p.key)).toContain('key_id');
  });

  it('is clean once the required fields are typed; optional ones may stay empty', () => {
    let form = initialForm(razorpayDriver, undefined);
    form = withValue(form, 'key_id', 'rzp_test_x');
    form = withValue(form, 'key_secret', 'secret');
    expect(validateForm(razorpayDriver, undefined, form)).toEqual([]);
  });

  it('a saved row keeps its required fields when left blank', () => {
    const saved = savedGateway();
    expect(validateForm(razorpayDriver, saved, initialForm(razorpayDriver, saved))).toEqual([]);
  });

  it('clearing a required field of a saved row needs a replacement', () => {
    const saved = savedGateway();
    const cleared = withClear(initialForm(razorpayDriver, saved), 'key_secret', true);
    expect(validateForm(razorpayDriver, saved, cleared)).toEqual([
      { key: 'key_secret', kind: 'required' },
    ]);
    expect(validateForm(razorpayDriver, saved, withValue(cleared, 'key_secret', 'n'))).toEqual([]);
  });

  it('clearing an optional field is fine', () => {
    const saved = savedGateway({
      credentials: [
        { key: 'key_id', hasValue: true, masked: '••••••••cdef' },
        { key: 'key_secret', hasValue: true, masked: '••••••••9z9z' },
        { key: 'webhook_secret', hasValue: true, masked: '••••••••wxyz' },
      ],
    });
    const form = withClear(initialForm(razorpayDriver, saved), 'webhook_secret', true);
    expect(validateForm(razorpayDriver, saved, form)).toEqual([]);
  });

  it('a select must hold one of its options', () => {
    let form = withValue(initialForm(stripeDriver, undefined), 'secret_key', 'sk');
    form = withValue(form, 'region', 'mars');
    expect(validateForm(stripeDriver, undefined, form)).toEqual([
      { key: 'region', kind: 'option' },
    ]);
    form = withValue(form, 'region', 'eu');
    expect(validateForm(stripeDriver, undefined, form)).toEqual([]);
  });
});

describe('isDirty', () => {
  const saved = savedGateway();
  it('a new row is always dirty; an untouched saved row is not', () => {
    expect(isDirty(razorpayDriver, undefined, initialForm(razorpayDriver, undefined))).toBe(true);
    expect(isDirty(razorpayDriver, saved, initialForm(razorpayDriver, saved))).toBe(false);
  });
  it('mode, active, typed values and clears make it dirty', () => {
    const base = initialForm(razorpayDriver, saved);
    expect(isDirty(razorpayDriver, saved, { ...base, mode: 'live' })).toBe(true);
    expect(isDirty(razorpayDriver, saved, { ...base, active: false })).toBe(true);
    expect(isDirty(razorpayDriver, saved, withValue(base, 'key_id', 'x'))).toBe(true);
    expect(isDirty(razorpayDriver, saved, withClear(base, 'key_id', true))).toBe(true);
  });
});

describe('credentialErrorKey', () => {
  it('strips the credentials prefix of a server field path', () => {
    expect(credentialErrorKey('credentials.key_id')).toBe('key_id');
    expect(credentialErrorKey('mode')).toBe('mode');
  });
});

describe('testOutcome', () => {
  it('verified is the only result that says the provider accepted the keys', () => {
    expect(
      testOutcome({ ok: true, level: 'verified', message: 'ok', missing: [] }, undefined),
    ).toEqual({
      kind: 'verified',
    });
  });

  it('a fields-level pass is said to be only a field check', () => {
    expect(testOutcome({ ok: true, level: 'fields', message: '', missing: [] }, undefined)).toEqual(
      {
        kind: 'fieldsOnly',
      },
    );
  });

  it('lists missing fields by their label', () => {
    const out = testOutcome(
      { ok: false, level: 'fields', message: 'x', missing: ['key_id', 'unknown_key'] },
      razorpayDriver,
    );
    expect(out).toEqual({ kind: 'missing', fields: ['Key ID', 'unknown_key'] });
  });

  it('a verified-level failure is a rejection and carries the provider text', () => {
    expect(
      testOutcome(
        { ok: false, level: 'verified', message: 'Invalid key', missing: [] },
        razorpayDriver,
      ),
    ).toEqual({ kind: 'rejected', detail: 'Invalid key' });
  });
});
