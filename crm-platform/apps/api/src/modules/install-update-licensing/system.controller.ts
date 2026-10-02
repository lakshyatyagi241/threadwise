import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  verifyLicenceRequestSchema,
  type SystemStatusResponse,
  type VerifyLicenceRequest,
  type VerifyLicenceResponse,
} from '@crm/contracts';
import { ActorKinds } from '../../common/decorators';
import { RequestContextStore } from '../../common/context/request-context';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { OperatorGuard, OperatorRoles } from '../auth';
import { SystemService } from './system.service';

/**
 * The Updater page's data. Reading is open to every platform operator; the one write, verifying the purchase
 * code, is for the super admin (WaDesk's controller says the same and enforces it nowhere). There is no route that
 * changes code, schema or files: a deploy is an image plus the migrator.
 */
@ApiTags('platform')
@ActorKinds('platform_operator')
@UseGuards(OperatorGuard)
@Controller({ path: 'platform/system', version: '2' })
export class SystemController {
  constructor(private readonly system: SystemService) {}

  @Get()
  @ApiOperation({ summary: 'Version, build, licence, migration ledger and dependency checks' })
  status(): Promise<SystemStatusResponse> {
    return this.system.status();
  }

  @Post('licence')
  @HttpCode(HttpStatus.OK)
  @OperatorRoles('super_admin')
  @ApiOperation({ summary: 'Verify and store the purchase code (Updater step 1)' })
  verifyLicence(
    @Body(zodPipe(verifyLicenceRequestSchema)) body: VerifyLicenceRequest,
  ): Promise<VerifyLicenceResponse> {
    return this.system.verifyLicence(
      body.purchaseCode,
      RequestContextStore.peek()?.actorId ?? null,
    );
  }
}
