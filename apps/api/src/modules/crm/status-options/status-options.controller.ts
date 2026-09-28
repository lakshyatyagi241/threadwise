import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createStatusOptionSchema,
  listStatusOptionsQuerySchema,
  reorderStatusOptionsSchema,
  updateStatusOptionSchema,
  type CreateStatusOptionInput,
  type ListStatusOptionsQuery,
  type ReorderStatusOptionsInput,
  type UpdateStatusOptionInput,
} from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../../common/decorators';
import { zodPipe } from '../../../common/pipes/zod-validation.pipe';
import { anyPropertyPermission } from '../field-metadata-permission';
import { StatusOptionsService } from './status-options.service';

/**
 * Settings > Data Management: org-extensible enum groups (lifecycle_stage,
 * deal_status, subscription statuses, ...) for both Contacts and Companies
 * (moduleKey picks which). Phase 7 + Phase 8 (docs/phase-plan.md).
 */
@ApiTags('status-options')
@ActorKinds('user')
@Controller({ path: 'status-options', version: '2' })
export class StatusOptionsController {
  constructor(private readonly statusOptions: StatusOptionsService) {}

  @Get()
  @RequirePermission(...anyPropertyPermission('read'))
  @ApiOperation({ summary: 'List status options for a module, optionally one group' })
  async list(@Query(zodPipe(listStatusOptionsQuerySchema)) query: ListStatusOptionsQuery) {
    return this.statusOptions.list(query);
  }

  @Post()
  @Idempotent()
  @RequirePermission(...anyPropertyPermission('create'))
  @ApiOperation({ summary: 'Add a status option to a group' })
  async create(@Body(zodPipe(createStatusOptionSchema)) body: CreateStatusOptionInput) {
    return this.statusOptions.create(body);
  }

  @Patch(':id')
  @RequirePermission(...anyPropertyPermission('update'))
  @ApiOperation({
    summary: 'Update a status option',
    description: 'Requires the rowVersion you read. A mismatch returns 409 ROW_VERSION_CONFLICT.',
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateStatusOptionSchema)) body: UpdateStatusOptionInput,
  ) {
    return this.statusOptions.update(id, body);
  }

  @Post('reorder')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(...anyPropertyPermission('update'))
  @ApiOperation({ summary: 'Reorder options within a group' })
  async reorder(@Body(zodPipe(reorderStatusOptionsSchema)) body: ReorderStatusOptionsInput) {
    await this.statusOptions.reorder(body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(...anyPropertyPermission('delete'))
  @ApiOperation({ summary: 'Delete a status option' })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.statusOptions.remove(id);
  }
}
