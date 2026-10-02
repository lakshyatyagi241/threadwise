import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createAddonRequestSchema,
  setAddonActiveRequestSchema,
  updateAddonRequestSchema,
  uuidSchema,
  type CreateAddonPayload,
  type SetAddonActiveRequest,
  type UpdateAddonPayload,
} from '@crm/contracts';
import { ActorKinds } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { OperatorGuard, OperatorRoles } from '../auth';
import { AddonPackService } from './addon-pack.service';

/** The billing add-on catalogue for platform operators (TW-ADD-025..030). Reads for every role, writes for super admins. */
@ApiTags('platform')
@ActorKinds('platform_operator')
@UseGuards(OperatorGuard)
@Controller({ path: 'platform/addons', version: '2' })
export class PlatformAddonsController {
  constructor(private readonly packs: AddonPackService) {}

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

  @Delete(':id')
  @OperatorRoles('super_admin')
  @ApiOperation({ summary: 'Delete a pack nobody has bought' })
  async remove(@Param('id', zodPipe(uuidSchema)) id: string) {
    await this.packs.remove(id);
    return { ok: true as const };
  }
}
