import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  connectEngineRequestSchema,
  engineKeySchema,
  toggleExtensionRequestSchema,
  uuidSchema,
  verifyPurchaseRequestSchema,
  type ConnectEngineRequest,
  type EngineKey,
  type ToggleExtensionRequest,
  type VerifyPurchaseRequest,
} from '@crm/contracts';
import { ActorKinds } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { addonsConfig } from '../../config/domains/addons-extension-registry.env';
import { OperatorGuard, OperatorRoles } from '../auth';
import { EngineConnectionService } from './engine-connections.service';
import { ExtensionsService } from './extensions.service';
import { ModuleRegistryService } from './module-registry.service';

interface UploadedZip {
  buffer: Buffer;
}

/**
 * Code add-ons ("modules") for platform operators (TW-ADD-001..024). Every operator role reads; only super admins
 * change anything (Reference had one admin tier and no finer keys, so this is the closest it gets without inventing
 * permissions), and every change is audited. The IP allowlist and MFA rules are the OperatorGuard's.
 */
@ApiTags('platform')
@ActorKinds('platform_operator')
@UseGuards(OperatorGuard)
@Controller({ path: 'platform/extensions', version: '2' })
export class PlatformExtensionsController {
  constructor(
    private readonly extensions: ExtensionsService,
    private readonly engines: EngineConnectionService,
    private readonly registry: ModuleRegistryService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Installed packages, in-place modules, engine connections and the core version',
  })
  page() {
    return this.extensions.page();
  }

  @Get('nav')
  @ApiOperation({
    summary: 'Navigation entries the enabled modules add to the console and the workspace app',
  })
  async nav() {
    const [admin, user] = await Promise.all([
      this.registry.nav('admin'),
      this.registry.nav('user'),
    ]);
    return { admin, user };
  }

  @Post('verify')
  @OperatorRoles('super_admin')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Step 1 of the installer: check the purchase code (200 when ok, 422 when not)',
  })
  async verify(
    @Body(zodPipe(verifyPurchaseRequestSchema)) body: VerifyPurchaseRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.extensions.verify(body.purchaseCode ?? '');
    if (!result.ok) res.status(422);
    return result;
  }

  @Post('upload')
  @OperatorRoles('super_admin')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('extension', {
      limits: { fileSize: addonsConfig().ADDONS_MAX_PACKAGE_BYTES },
    }),
  )
  @ApiOperation({
    summary: 'Step 2 of the installer: upload a package (field "extension", optional "purchaseCode")',
  })
  upload(@UploadedFile() file: UploadedZip | undefined, @Body() body: { purchaseCode?: unknown }) {
    const code = typeof body?.purchaseCode === 'string' ? body.purchaseCode.slice(0, 191) : '';
    return this.extensions.upload(file?.buffer ?? Buffer.alloc(0), code);
  }

  @Post(':id/toggle')
  @OperatorRoles('super_admin')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Enable or disable an installed package (one switch: its routes, navigation and plan fields follow)',
  })
  toggle(
    @Param('id', zodPipe(uuidSchema)) id: string,
    @Body(zodPipe(toggleExtensionRequestSchema)) body: ToggleExtensionRequest,
  ) {
    return this.extensions.toggle(id, body.rowVersion);
  }

  @Delete(':id')
  @OperatorRoles('super_admin')
  @ApiOperation({ summary: 'Remove an installed package: deletes exactly the files it installed' })
  remove(@Param('id', zodPipe(uuidSchema)) id: string) {
    return this.extensions.remove(id);
  }

  @Post('modules/:slug/toggle')
  @OperatorRoles('super_admin')
  @HttpCode(200)
  @ApiOperation({ summary: 'Deactivate or re-activate an in-place module (files and data stay)' })
  toggleModule(@Param('slug') slug: string) {
    return this.extensions.toggleModule(slug);
  }

  @Post('engines/:engine/connect')
  @OperatorRoles('super_admin')
  @HttpCode(200)
  @ApiOperation({ summary: 'Save an engine URL, name and secret, then test the connection' })
  connect(
    @Param('engine', zodPipe(engineKeySchema)) engine: EngineKey,
    @Body(zodPipe(connectEngineRequestSchema)) body: ConnectEngineRequest,
  ) {
    return this.engines.connect(engine, body);
  }

  @Post('engines/:engine/disconnect')
  @OperatorRoles('super_admin')
  @HttpCode(200)
  @ApiOperation({ summary: 'Forget an engine URL and secret' })
  disconnect(@Param('engine', zodPipe(engineKeySchema)) engine: EngineKey) {
    return this.engines.disconnect(engine);
  }
}
