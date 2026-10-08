/**
 * Public surface of the Google Sheets add-on part of the EXT domain (`chrome-extension-sheets-addon`). Other modules import from here,
 * never from the files behind it.
 *
 *   ChromeExtensionSheetsAddonModule  the HTTP side: a member's key, the setup page, the add-on API
 *   SheetsAppAccess                   whether the add-on is installed and active in a workspace (the Marketplace owns the install)
 *   SheetsKeyService                  a member's own key: status, generate, revoke
 */
export { ChromeExtensionSheetsAddonModule } from './chrome-extension-sheets-addon.module';
export { SheetsAppAccess, type SheetsInstall } from './sheets-app-access.service';
export { SheetsKeyService } from './sheets-key.service';
