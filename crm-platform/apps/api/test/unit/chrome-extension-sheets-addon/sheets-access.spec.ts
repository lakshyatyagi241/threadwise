import { describe, expect, it } from 'vitest';
import {
  capabilitiesOf,
  roleHolds,
} from '../../../src/modules/chrome-extension-sheets-addon/sheets-access';

const holding =
  (...keys: string[]) =>
  (k: string) =>
    keys.includes(k);
const ALL_SCOPES = {
  grantedScopes: ['contacts.read', 'contacts.write', 'catalog.read', 'catalog.write'],
};

/** WD-EXT-004, 013: what a key may do is the install consent AND the member's role. */
describe('what a key may do', () => {
  it('lets a create-only or update-only role run a contact sync, but not a role with neither', () => {
    expect(roleHolds('writeContacts', holding('record.contacts.create'))).toBe(true);
    expect(roleHolds('writeContacts', holding('record.contacts.update'))).toBe(true);
    expect(roleHolds('writeContacts', holding('record.contacts.read'))).toBe(false);
  });

  it('needs the shop permission for any product sync, because a sync always writes the shop', () => {
    expect(roleHolds('writeCatalog', holding('cat.products.create'))).toBe(false);
    expect(roleHolds('writeCatalog', holding('store.shops.manage'))).toBe(false);
    expect(roleHolds('writeCatalog', holding('store.shops.manage', 'cat.products.update'))).toBe(
      true,
    );
  });

  it('needs both read keys to read the catalog', () => {
    expect(roleHolds('readCatalog', holding('cat.products.read'))).toBe(false);
    expect(roleHolds('readCatalog', holding('cat.products.read', 'store.storefront.read'))).toBe(
      true,
    );
  });

  it('is limited by what the install consented to, whatever the role holds', () => {
    const everything = holding(
      'record.contacts.read',
      'record.contacts.create',
      'cat.products.read',
      'store.storefront.read',
      'store.shops.manage',
      'cat.products.create',
    );
    expect(capabilitiesOf(ALL_SCOPES, everything)).toEqual({
      readContacts: true,
      writeContacts: true,
      readCatalog: true,
      writeCatalog: true,
    });
    expect(capabilitiesOf({ grantedScopes: ['contacts.read'] }, everything)).toEqual({
      readContacts: true,
      writeContacts: false,
      readCatalog: false,
      writeCatalog: false,
    });
    expect(capabilitiesOf({ grantedScopes: [] }, everything)).toEqual({
      readContacts: false,
      writeContacts: false,
      readCatalog: false,
      writeCatalog: false,
    });
  });

  it('gives a viewer who may only read nothing that writes', () => {
    const viewer = holding('record.contacts.read', 'cat.products.read', 'store.storefront.read');
    expect(capabilitiesOf(ALL_SCOPES, viewer)).toEqual({
      readContacts: true,
      writeContacts: false,
      readCatalog: true,
      writeCatalog: false,
    });
  });
});
