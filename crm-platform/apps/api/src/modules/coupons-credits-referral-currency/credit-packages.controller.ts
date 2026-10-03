import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createCreditPackageRequestSchema,
  setCreditPackageActiveRequestSchema,
  updateCreditPackageRequestSchema,
  uuidSchema,
  type CreateCreditPackagePayload,
  type SetCreditPackageActiveRequest,
  type UpdateCreditPackagePayload,
} from '@crm/contracts';
import { ActorKinds } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { OperatorGuard, OperatorRoles } from '../auth';
import { CreditPackageAdminService } from './credit-package-admin.service';

/**
 * The credit-package catalogue for platform operators (WD-CPN-009..013). Every operator role reads; only super admins write,
 * and every write is recorded in security_events.
 */
@ApiTags('platform')
@ActorKinds('platform_operator')
@UseGuards(OperatorGuard)
@Controller({ path: 'platform/credit-packages', version: '2' })
export class CreditPackagesController {
  constructor(private readonly packages: CreditPackageAdminService) {}

  @Get()
  @ApiOperation({ summary: 'Every credit package in display order (sort order, then id)' })
  list() {
    return this.packages.list();
  }

  @Get(':id')
  @ApiOperation({ summary: 'One credit package' })
  one(@Param('id', zodPipe(uuidSchema)) id: string) {
    return this.packages.get(id);
  }

  @Post()
  @OperatorRoles('super_admin')
  @ApiOperation({ summary: 'Create a credit package (a blank slug is derived from the name)' })
  create(@Body(zodPipe(createCreditPackageRequestSchema)) body: CreateCreditPackagePayload) {
    return this.packages.create(body);
  }

  @Patch(':id')
  @OperatorRoles('super_admin')
  @ApiOperation({ summary: 'Update a credit package (partial, optimistic-locked)' })
  update(
    @Param('id', zodPipe(uuidSchema)) id: string,
    @Body(zodPipe(updateCreditPackageRequestSchema)) body: UpdateCreditPackagePayload,
  ) {
    return this.packages.update(id, body);
  }

  @Patch(':id/active')
  @OperatorRoles('super_admin')
  @ApiOperation({ summary: 'Enable or disable a credit package' })
  setActive(
    @Param('id', zodPipe(uuidSchema)) id: string,
    @Body(zodPipe(setCreditPackageActiveRequestSchema)) body: SetCreditPackageActiveRequest,
  ) {
    return this.packages.setActive(id, body.isActive, body.rowVersion);
  }

  @Delete(':id')
  @OperatorRoles('super_admin')
  @ApiOperation({
    summary: 'Delete a credit package; orders and ledger rows keep their own price and credits',
  })
  async remove(@Param('id', zodPipe(uuidSchema)) id: string) {
    await this.packages.remove(id);
    return { ok: true as const };
  }
}
