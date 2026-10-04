import { describe, expect, it } from 'vitest';
import {
  defaultDeviceId,
  hasOfficialSender,
  initialWizardForm,
  resolveMode,
  toSaveInput,
  validateWizard,
  type WizardDevice,
  type WizardShop,
} from './wizard-form';

const shop = (over: Partial<WizardShop> = {}): WizardShop => ({
  id: 's1',
  shopName: 'Acme',
  slug: 'acme',
  customDomain: null,
  customDomainVerified: false,
  enabled: true,
  deviceId: null,
  publicUrl: 'https://app.test/s/acme',
  sendingLabel: null,
  themeKey: 'aurora',
  ...over,
});
const device = (id: string): WizardDevice => ({ id, label: `Phone ${id}`, phone: '+1' });

describe('resolveMode', () => {
  const shops = [shop(), shop({ id: 's2' })];
  it('edits a known shop, adds on request or when empty, lists otherwise', () => {
    expect(resolveMode({ shop: 's2' }, shops)).toEqual({ kind: 'edit', shop: shops[1] });
    expect(resolveMode({ shop: 'zzz' }, shops)).toEqual({ kind: 'list' });
    expect(resolveMode({ action: 'add' }, shops)).toEqual({ kind: 'add' });
    expect(resolveMode({}, [])).toEqual({ kind: 'add' });
    expect(resolveMode({}, shops)).toEqual({ kind: 'list' });
  });
});

describe('validateWizard', () => {
  const ok = { shopName: 'Acme', customDomain: '', deviceId: '' };
  it('needs a name of at most 191 characters', () => {
    expect(validateWizard({ ...ok, shopName: '  ' }).shopName).toBe('nameRequired');
    expect(validateWizard({ ...ok, shopName: 'x'.repeat(192) }).shopName).toBe('nameTooLong');
    expect(validateWizard(ok)).toEqual({});
  });
  it('accepts a plain lower-case domain and rejects schemes and upper case', () => {
    expect(validateWizard({ ...ok, customDomain: 'shop.yourbiz.com' })).toEqual({});
    expect(validateWizard({ ...ok, customDomain: 'https://shop.yourbiz.com' }).customDomain).toBe(
      'domainInvalid',
    );
    expect(validateWizard({ ...ok, customDomain: 'Shop.Example.com' }).customDomain).toBe(
      'domainInvalid',
    );
    expect(validateWizard({ ...ok, customDomain: 'x'.repeat(200) }).customDomain).toBe(
      'domainTooLong',
    );
  });
});

describe('defaultDeviceId', () => {
  it('keeps the shop device, else the first one', () => {
    expect(defaultDeviceId(shop({ deviceId: 'd2' }), [device('d1'), device('d2')], false)).toBe(
      'd2',
    );
    expect(defaultDeviceId(null, [device('d1'), device('d2')], true)).toBe('d1');
  });
  it('keeps an official-number shop on the official API', () => {
    expect(defaultDeviceId(shop({ deviceId: null }), [device('d1')], true)).toBe('');
  });
  it('drops a bound device that is no longer connected', () => {
    expect(defaultDeviceId(shop({ deviceId: 'gone' }), [device('d1')], false)).toBe('d1');
    expect(defaultDeviceId(null, [], false)).toBe('');
  });
});

describe('hasOfficialSender', () => {
  const base = { hasSender: true, devices: [] as WizardDevice[], shops: [] as WizardShop[] };
  it('is false without any sender', () => {
    expect(hasOfficialSender({ ...base, hasSender: false })).toBe(false);
  });
  it('is true when no device is connected (the official number is the sender)', () => {
    expect(hasOfficialSender(base)).toBe(true);
  });
  it('is true when a shop already sends from an official number', () => {
    expect(
      hasOfficialSender({
        ...base,
        devices: [device('d1')],
        shops: [shop({ sendingLabel: '+1 555' })],
      }),
    ).toBe(true);
    expect(hasOfficialSender({ ...base, devices: [device('d1')], shops: [shop()] })).toBe(false);
  });
});

describe('initialWizardForm and toSaveInput', () => {
  it('prefills a new shop with the workspace name and the first device', () => {
    expect(initialWizardForm(null, [device('d1')], false, 'Acme Traders')).toEqual({
      shopName: 'Acme Traders',
      customDomain: '',
      deviceId: 'd1',
    });
  });
  it('an unnamed shop being edited shows the workspace name, as WaDesk does', () => {
    expect(initialWizardForm(shop({ shopName: null }), [], false, 'Acme Traders').shopName).toBe(
      'Acme Traders',
    );
    expect(initialWizardForm(shop({ shopName: 'Mine' }), [], false, 'Acme Traders').shopName).toBe(
      'Mine',
    );
  });
  it('shapes the save body: null for blanks, shopId only when editing', () => {
    expect(toSaveInput({ shopName: ' A ', customDomain: '', deviceId: '' })).toEqual({
      shopName: 'A',
      customDomain: null,
      deviceId: null,
    });
    expect(toSaveInput({ shopName: 'A', customDomain: 'a.b.co', deviceId: 'd1' }, 's1')).toEqual({
      shopId: 's1',
      shopName: 'A',
      customDomain: 'a.b.co',
      deviceId: 'd1',
    });
  });
});
