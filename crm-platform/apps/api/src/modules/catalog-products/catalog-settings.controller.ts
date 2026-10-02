import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  updateCatalogSettingsSchema,
  type CatalogSettingsResponse,
  type UpdateCatalogSettingsInput,
} from '@crm/contracts';
import { ActorKinds } from '../../common/decorators';
import { RequestContextStore } from '../../common/context/request-context';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { OperatorGuard, OperatorRoles } from '../auth';
import { CatalogSettingsService } from './catalog-settings.service';

/**
 * The operator console's "WhatsApp Catalog" settings page (WD-CAT-030; WaDesk `admin/settings/catalog`). WaDesk gated it by "is
 * an admin"; here every operator may read and only a super admin saves, with the IP allowlist and MFA from OperatorGuard.
 */
@ApiTags('platform')
@ActorKinds('platform_operator')
@UseGuards(OperatorGuard)
@Controller({ path: 'platform/settings/catalog', version: '2' })
export class CatalogSettingsController {
  constructor(private readonly settings: CatalogSettingsService) {}

  @Get()
  @ApiOperation({
    summary:
      'Catalog settings, the three usage tiles and whether an app secret is saved (never the secret)',
  })
  read(): Promise<CatalogSettingsResponse> {
    return this.settings.read();
  }

  @Patch()
  @OperatorRoles('super_admin')
  @ApiOperation({
    summary: 'Save the catalog settings',
    description:
      'Requires the rowVersion you read (409 ROW_VERSION_CONFLICT otherwise). A field that is not sent keeps its value; a blank ' +
      'app secret keeps the saved one; a blank Graph version clears it so the default applies. 422 for a version that is not vNN.N.',
  })
  update(
    @Body(zodPipe(updateCatalogSettingsSchema)) body: UpdateCatalogSettingsInput,
  ): Promise<CatalogSettingsResponse> {
    return this.settings.update(body, RequestContextStore.require().actorId!);
  }
}
