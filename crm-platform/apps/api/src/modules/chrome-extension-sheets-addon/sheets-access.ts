import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { SheetsKeyOwner } from './sheets-key.repository';
import type { SheetsInstall } from './sheets-app-access.service';
import { SHEETS_CAPABILITIES, type SheetsCapability } from './sheets-key.rules';

export const SHEETS_NEEDS_KEY = 'ext:sheets-needs';

/** The capabilities a route needs; every one must be both consented at install and held by the key owner's role. */
export const SheetsNeeds = (...caps: SheetsCapability[]) => SetMetadata(SHEETS_NEEDS_KEY, caps);

/** What the guard learned about the caller, put on the request for the handlers (`@SheetsCaller()`). */
export interface SheetsCallerState {
  owner: SheetsKeyOwner & { settingsId: number };
  install: SheetsInstall;
  /** Each capability: consented at install AND held by the member's role. */
  can: Record<SheetsCapability, boolean>;
  /** The member's own permission keys, for per-row decisions (a create-only role cannot update). */
  holds: (permissionKey: string) => boolean;
}

/**
 * Whether the member's role holds what a capability needs. The rules differ per capability on purpose: a role that may only create, or
 * only update, contacts can still run a contact sync (each row is then checked against what it needs); a catalog write needs the shop
 * permission because every product sync also writes the shop.
 */
export function roleHolds(cap: SheetsCapability, holds: (key: string) => boolean): boolean {
  switch (cap) {
    case 'readContacts':
      return holds('record.contacts.read');
    case 'writeContacts':
      return holds('record.contacts.create') || holds('record.contacts.update');
    case 'readCatalog':
      return holds('cat.products.read') && holds('store.storefront.read');
    case 'writeCatalog':
      return (
        holds('store.shops.manage') &&
        (holds('cat.products.create') || holds('cat.products.update'))
      );
  }
}

export function capabilitiesOf(
  install: SheetsInstall,
  holds: (key: string) => boolean,
): Record<SheetsCapability, boolean> {
  const out = {} as Record<SheetsCapability, boolean>;
  for (const cap of Object.keys(SHEETS_CAPABILITIES) as SheetsCapability[]) {
    out[cap] =
      install.grantedScopes.includes(SHEETS_CAPABILITIES[cap].scope) && roleHolds(cap, holds);
  }
  return out;
}

/** The caller the guard resolved. Only valid on a route behind `SheetsKeyGuard`. */
export const SheetsCaller = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): SheetsCallerState =>
    ctx.switchToHttp().getRequest<Request & { extSheets: SheetsCallerState }>().extSheets,
);

/** The capability map in the add-on API's snake_case. */
export function toHealthCan(can: Record<SheetsCapability, boolean>) {
  return {
    read_contacts: can.readContacts,
    write_contacts: can.writeContacts,
    read_catalog: can.readCatalog,
    write_catalog: can.writeCatalog,
  };
}
