import { Body, Delete, Get, Param, Post, Res } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import type { Response } from 'express';
import { v1CreateContactGroupSchema, type V1CreateContactGroup } from '@crm/contracts';
import { zodPipe } from '../../../../../common/pipes/zod-validation.pipe';
import { RequireApiScope } from '../../../auth/api-scope';
import { V1Controller } from '../../../http/v1-controller.decorator';
import { countMeta, ok } from '../../../http/v1-envelope';
import { V1ContactGroupsService } from './contact-groups.service';

@V1Controller('contact-groups')
export class V1ContactGroupsController {
  constructor(private readonly groups: V1ContactGroupsService) {}

  @Get()
  @RequireApiScope('contact-groups:read')
  @ApiOperation({ summary: 'Every group with its member count, newest first' })
  async list() {
    const groups = await this.groups.list();
    return ok(groups, countMeta(groups.length));
  }

  // 201 for a new group; a name the workspace already has (compared ignoring case) answers that group with 200, where Reference made a twin.
  @Post()
  @RequireApiScope('contact-groups:write')
  @ApiOperation({ summary: 'Create a group' })
  async create(
    @Body(zodPipe(v1CreateContactGroupSchema)) body: V1CreateContactGroup,
    @Res() res: Response,
  ) {
    const { group, created } = await this.groups.create(body);
    res.status(created ? 201 : 200).json(ok(group, created ? undefined : { existing: true }));
  }

  @Delete(':id')
  @RequireApiScope('contact-groups:write')
  @ApiOperation({ summary: 'Delete a group; its contacts are detached and kept' })
  async remove(@Param('id') id: string) {
    return ok(await this.groups.remove(id));
  }
}
