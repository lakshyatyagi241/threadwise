import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  UseGuards,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  extSheetsContactsQuerySchema,
  extSheetsContactsSyncRequestSchema,
  extSheetsSyncRequestSchema,
  type ExtSheetsContactsQuery,
  type ExtSheetsContactsResponse,
  type ExtSheetsContactsSyncRequest,
  type ExtSheetsContactsSyncResponse,
  type ExtSheetsHealth,
  type ExtSheetsShopsResponse,
  type ExtSheetsSyncRequest,
  type ExtSheetsSyncResponse,
} from '@crm/contracts';
import { Public } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { RequirePlanFeature } from '../plans-subscriptions-trials';
import { SkipThrottle } from '../platform-infrastructure';
import { SheetsNeeds, SheetsCaller, type SheetsCallerState } from './sheets-access';
import { SheetsAddonService } from './sheets-addon.service';
import { SheetsCatalogService } from './sheets-catalog.service';
import { SheetsContactsService } from './sheets-contacts.service';
import { SheetsKeyGuard } from './sheets-key.guard';

/**
 * The API the Google Apps Script add-on calls (`/api/v1/sheets-addon`), authenticated by the member's Sheets key alone (see
 * `SheetsKeyGuard`). Same path, bearer scheme and snake_case body as WaDesk's add-on, so a client written for one works against the other.
 *
 *   - `@Public()`: the app-wide session guard stands aside; the key guard is the authentication.
 *   - `@SkipThrottle()`: the per-key limit in the guard is the limit the add-on is told about; the per-IP default must not stack on it.
 *   - `@RequirePlanFeature('marketplace')`: enforced by the guard once the key's workspace is known.
 *   - version-neutral: the path is exactly `/api/v1/sheets-addon/...`.
 */
@ApiTags('Google Sheets add-on')
@ApiBearerAuth('sheets-key')
@Public()
@UseGuards(SheetsKeyGuard)
@SkipThrottle()
@RequirePlanFeature('marketplace')
@Controller({ path: 'api/v1/sheets-addon', version: VERSION_NEUTRAL })
export class SheetsAddonController {
  constructor(
    private readonly addon: SheetsAddonService,
    private readonly catalog: SheetsCatalogService,
    private readonly contacts: SheetsContactsService,
  ) {}

  @Get('health')
  health(@SheetsCaller() caller: SheetsCallerState): ExtSheetsHealth {
    return this.addon.health(caller);
  }

  @Get('shops')
  @SheetsNeeds('readCatalog')
  shops(@SheetsCaller() caller: SheetsCallerState): Promise<ExtSheetsShopsResponse> {
    return this.catalog.listShops(caller.owner.orgUuid);
  }

  @Post('sync')
  @HttpCode(200)
  @SheetsNeeds('writeCatalog')
  sync(
    @SheetsCaller() caller: SheetsCallerState,
    @Body(zodPipe(extSheetsSyncRequestSchema)) body: ExtSheetsSyncRequest,
  ): Promise<ExtSheetsSyncResponse> {
    return this.catalog.sync(caller, body);
  }

  @Get('contacts')
  @SheetsNeeds('readContacts')
  pull(
    @Query(zodPipe(extSheetsContactsQuerySchema)) query: ExtSheetsContactsQuery,
  ): Promise<ExtSheetsContactsResponse> {
    return this.contacts.pull(query);
  }

  @Post('contacts/sync')
  @HttpCode(200)
  @SheetsNeeds('writeContacts')
  syncContacts(
    @SheetsCaller() caller: SheetsCallerState,
    @Body(zodPipe(extSheetsContactsSyncRequestSchema)) body: ExtSheetsContactsSyncRequest,
  ): Promise<ExtSheetsContactsSyncResponse> {
    return this.contacts.sync(caller, body);
  }
}
