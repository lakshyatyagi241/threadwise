import { Body, Controller, Delete, Get, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createAddonRequestSchema,
  setAddonActiveRequestSchema,
  setAddonPlanOffersRequestSchema,
  updateAddonRequestSchema,
  uuidSchema,
  type CreateAddonPayload,
  type SetAddonActiveRequest,
  type SetAddonPlanOffersPayload,
  type UpdateAddonPayload,
} from '@crm/contracts';
import { ActorKinds } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { OperatorGuard, OperatorRoles } from '../auth';
import { AppError } from '../../common/errors/app-error';
import { AddonPackService } from './addon-pack.service';
import { WorkspaceAddonsService } from './workspace-addons.service';

/** The billing add-on catalogue for platform operators (TW-ADD-025..030). Reads for every role, writes for super admins. */
@ApiTags('platform')
@ActorKinds('platform_operator')
@UseGuards(OperatorGuard)
@Controller({ path: 'platform/addons', version: '2' })
export class PlatformAddonsController {
  constructor(
    private readonly packs: AddonPackService,
    private readonly workspaces: WorkspaceAddonsService,
  ) {}

  @Get('workspaces/:id')
  @ApiOperation({
    summary:
      "One workspace's add-ons as it sees them, plus the ones its plan hides and the feature overrides that win over the plan",
  })
  async forWorkspace(@Param('id', zodPipe(uuidSchema)) id: string) {
    const orgId = await this.packs.workspaceOrgId(id);
    if (orgId === null) throw AppError.notFound('Workspace');
    return this.workspaces.forOperator(orgId);
  }

  @Get()
  @ApiOperation({ summary: 'Every add-on pack with what it grants and how many workspaces own it' })
  list() {
    return this.packs.list();
  }

  @Get('fields')
  @ApiOperation({
    summary: 'The flags and caps a pack can grant: the core registry plus enabled modules',
  })
  fields() {
    return this.packs.fields();
  }

  @Get(':id')
  @ApiOperation({ summary: 'One add-on pack (a plan id is a 404 here)' })
  one(@Param('id', zodPipe(uuidSchema)) id: string) {
    return this.packs.get(id);
  }

  @Post()
  @OperatorRoles('super_admin')
  @ApiOperation({ summary: 'Create an add-on pack (the slug is derived from the name)' })
  create(@Body(zodPipe(createAddonRequestSchema)) body: CreateAddonPayload) {
    return this.packs.create(body);
  }

  @Patch(':id')
  @OperatorRoles('super_admin')
  @ApiOperation({ summary: 'Update an add-on pack (partial; rowVersion is required)' })
  update(
    @Param('id', zodPipe(uuidSchema)) id: string,
    @Body(zodPipe(updateAddonRequestSchema)) body: UpdateAddonPayload,
  ) {
    return this.packs.update(id, body);
  }

  @Patch(':id/active')
  @OperatorRoles('super_admin')
  @ApiOperation({ summary: 'Put a pack on or off sale; existing owners keep it' })
  setActive(
    @Param('id', zodPipe(uuidSchema)) id: string,
    @Body(zodPipe(setAddonActiveRequestSchema)) body: SetAddonActiveRequest,
  ) {
    return this.packs.setActive(id, body.isActive, body.rowVersion);
  }

  @Put(':id/plans')
  @OperatorRoles('super_admin')
  @ApiOperation({
    summary:
      'How each plan offers this add-on: included, paid (optional plan price) or hidden; plans not named keep theirs',
  })
  setPlanOffers(
    @Param('id', zodPipe(uuidSchema)) id: string,
    @Body(zodPipe(setAddonPlanOffersRequestSchema)) body: SetAddonPlanOffersPayload,
  ) {
    return this.packs.setPlanOffers(id, body);
  }

  @Delete(':id')
  @OperatorRoles('super_admin')
  @ApiOperation({ summary: 'Delete a pack nobody has bought' })
  async remove(@Param('id', zodPipe(uuidSchema)) id: string) {
    await this.packs.remove(id);
    return { ok: true as const };
  }
}
