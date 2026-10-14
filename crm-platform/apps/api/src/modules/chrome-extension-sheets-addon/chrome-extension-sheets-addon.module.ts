import { Module, type OnModuleInit } from '@nestjs/common';
import { registerProblemRenderer } from '../../common/filters/problem-exception.filter';
import { CatalogProductsModule } from '../catalog-products';
import { CrmModule } from '../crm';
import { PlansCoreModule } from '../plans-subscriptions-trials';
import { StorefrontBuilderModule } from '../storefront-builder';
import { SheetsAddonController } from './sheets-addon.controller';
import { SheetsAddonService } from './sheets-addon.service';
import { SheetsAppAccess } from './sheets-app-access.service';
import { SheetsCatalogService } from './sheets-catalog.service';
import { SheetsContactsService } from './sheets-contacts.service';
import { SHEETS_PATH_PREFIX, renderSheetsError } from './sheets-error-renderer';
import { SheetsFilesService } from './sheets-files.service';
import { SheetsKeyController } from './sheets-key.controller';
import { SheetsKeyGuard } from './sheets-key.guard';
import { SheetsKeyRepository } from './sheets-key.repository';
import { SheetsKeyService } from './sheets-key.service';
import { SheetsRunLog } from './sheets-run-log.service';
import { SheetsSetupService } from './sheets-setup.service';
import { SheetsWebhookService } from './sheets-webhook.service';

/**
 * The Google Sheets add-on (EXT, `chrome-extension-sheets-addon`; the Chrome extension is a separate part of the domain). Registered in
 * app.module.ts.
 *
 *   /v2/extension/sheets             a signed-in member: their key, the setup page, the add-on source (`app.google-sheets.use`)
 *   /api/v1/sheets-addon             the Apps Script client, authenticated by that key alone
 *
 * The add-on is a Marketplace `client` listing (slug `google-sheets`): installed once per workspace, used by each member with their own key
 * and under their own role. Contacts, products and shops are written through the services that own them (CRM, catalog-products,
 * storefront-builder), never by SQL from here. The key itself is stored in the columns Reference's `users` carried, kept in `user_settings`.
 */
@Module({
  imports: [CrmModule, CatalogProductsModule, StorefrontBuilderModule, PlansCoreModule],
  controllers: [SheetsKeyController, SheetsAddonController],
  providers: [
    SheetsKeyRepository,
    SheetsAppAccess,
    SheetsKeyService,
    SheetsKeyGuard,
    SheetsFilesService,
    SheetsSetupService,
    SheetsRunLog,
    SheetsAddonService,
    SheetsContactsService,
    SheetsCatalogService,
    SheetsWebhookService,
  ],
  exports: [SheetsKeyService, SheetsAppAccess],
})
export class ChromeExtensionSheetsAddonModule implements OnModuleInit {
  /** The add-on gets Reference's `{ ok: false, error }` envelope, whatever raised the error (a guard, a pipe, the router). */
  onModuleInit(): void {
    registerProblemRenderer(SHEETS_PATH_PREFIX, renderSheetsError);
  }
}
