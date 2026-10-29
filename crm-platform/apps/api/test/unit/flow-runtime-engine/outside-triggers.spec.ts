import { describe, expect, it } from 'vitest';
import { flbExtractTrigger, flbTriggerConfig } from '@crm/contracts';
import {
  deliveryKey,
  payloadVariables,
  personOf,
  rowVariables,
  variableName,
} from '../../../src/modules/flow-runtime-engine/triggers/external-payload';
import {
  flowHookToken,
  flowHookTokenMatches,
} from '../../../src/modules/flow-runtime-engine/triggers/flow-hook-token';
import { maskSecretUrl } from '../../../src/common/logging/mask-secret-url';

const A = '0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b';
const B = '1c1c1c1c-1c1c-4c1c-8c1c-1c1c1c1c1c1c';
const KEY = 'k'.repeat(44);

describe('the webhook token', () => {
  it('is per flow, per secret, stable, and long enough to be unguessable', () => {
    const t = flowHookToken(KEY, A);
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(flowHookToken(KEY, A)).toBe(t);
    expect(flowHookToken(KEY, B)).not.toBe(t);
    expect(flowHookToken('j'.repeat(44), A)).not.toBe(t);
    expect(flowHookToken(KEY, A.toUpperCase())).toBe(t);
  });

  it('matches only its own flow, accepts a retired secret, and refuses any wrong or odd-length value', () => {
    const t = flowHookToken(KEY, A);
    expect(flowHookTokenMatches([KEY], A, t)).toBe(true);
    expect(flowHookTokenMatches([KEY], B, t)).toBe(false);
    expect(flowHookTokenMatches(['j'.repeat(44), KEY], A, t)).toBe(true);
    expect(flowHookTokenMatches(['j'.repeat(44)], A, t)).toBe(false);
    for (const bad of [
      '',
      'x',
      t.slice(1),
      `${t}x`,
      t.replace(/.$/, t.endsWith('A') ? 'B' : 'A'),
    ]) {
      expect(flowHookTokenMatches([KEY], A, bad)).toBe(false);
    }
  });

  it('is masked in a logged address', () => {
    const t = flowHookToken(KEY, A);
    const masked = maskSecretUrl(`/v2/public/flow-hooks/${A}/${t}`);
    expect(masked).toBe(`/v2/public/flow-hooks/${A}/[secret]`);
  });
});

describe('payload to variables and a person', () => {
  it('flattens nested objects, keeps arrays as text, and drops reserved or prototype names', () => {
    const vars = payloadVariables(
      JSON.parse(
        '{"Order No.":7,"customer":{"Name":"Asha","address":{"city":"Pune"}},"items":[1,2],"ok":true,"__proto__":{"x":"1"},"__trigger_hops":"9","nil":null}',
      ),
    );
    expect(vars).toMatchObject({
      order_no: '7',
      customer_name: 'Asha',
      customer_address_city: 'Pune',
      items: '[1,2]',
      ok: 'true',
    });
    expect(Object.keys(vars).some((k) => k.startsWith('__'))).toBe(false);
    expect('nil' in vars).toBe(false);
    expect(variableName('  First Name!! ')).toBe('first_name');
  });

  it('caps the number and length of values', () => {
    const big: Record<string, string> = {};
    for (let i = 0; i < 300; i++) big[`k${i}`] = 'v';
    expect(Object.keys(payloadVariables(big)).length).toBe(100);
    expect(payloadVariables({ a: 'x'.repeat(5000) }).a!.length).toBe(1000);
  });

  it('reads who it is about from the usual names, phone before email', () => {
    expect(personOf({ mobile: ' +9198 ', email: 'a@b.test', full_name: 'Asha' })).toEqual({
      phone: '+9198',
      email: 'a@b.test',
      name: 'Asha',
    });
    expect(personOf({ foo: 'bar' })).toEqual({ phone: null, email: null, name: null });
  });

  it('names a delivery by the sender id, else by the exact body', () => {
    const body = Buffer.from('{"phone":"1"}');
    expect(deliveryKey('abc-1', body)).toBe('id:abc-1');
    expect(deliveryKey(undefined, body)).toBe(deliveryKey(undefined, Buffer.from('{"phone":"1"}')));
    expect(deliveryKey(undefined, body)).not.toBe(
      deliveryKey(undefined, Buffer.from('{"phone":"2"}')),
    );
    expect(deliveryKey('has space or ;', body)).toMatch(/^sha:/);
  });

  it('turns a sheet row into variables by header, with the row number', () => {
    expect(rowVariables(['Name', 'Mobile No', '', 'Topic'], ['Meera', '+91', 'x', ''], 5)).toEqual({
      row_number: '5',
      name: 'Meera',
      mobile_no: '+91',
    });
  });
});

describe('the two trigger kinds in the contracts', () => {
  const node = (data: Record<string, unknown>) =>
    ({ flowNodes: [{ id: 't', type: 'trigger', data }] }) as never;

  it('extracts a webhook trigger with no value and an empty config', () => {
    const x = flbExtractTrigger(node({ kind: 'webhook' }));
    expect(x).toMatchObject({ kind: 'webhook', valueKind: 'zero', config: {} });
  });

  it('cleans a sheet trigger: a pasted link becomes the id, the interval stays within 1 to 5', () => {
    const cfg = flbTriggerConfig('google_sheet', {
      sheetId: 'https://docs.google.com/spreadsheets/d/1AbC_-xyz/edit#gid=0',
      tabName: ' Leads ',
      phoneColumn: ' Mobile ',
      intervalMinutes: 99,
    });
    expect(cfg).toEqual({
      sheetId: '1AbC_-xyz',
      tabName: 'Leads',
      phoneColumn: 'Mobile',
      emailColumn: '',
      nameColumn: '',
      intervalMinutes: 5,
    });
    expect(flbTriggerConfig('google_sheet', { intervalMinutes: 0 })).toMatchObject({
      intervalMinutes: 1,
    });
    expect(flbTriggerConfig('google_sheet', {})).toMatchObject({ sheetId: '', intervalMinutes: 5 });
    expect(flbExtractTrigger(node({ kind: 'google_sheet' })).valueKind).toBe('zero');
  });
});
