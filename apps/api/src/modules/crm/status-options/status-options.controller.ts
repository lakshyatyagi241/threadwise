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
import { ApiExcludeController, ApiOperation, ApiTags } from '@nestjs/swagger';
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
import { StatusOptionsService } from './status-options.service';

/**
 * Settings > Data Management: org-extensible enum groups (lifecycle_stage,
 * deal_status, subscription statuses, ...). Phase 8 (docs/phase-plan.md) —
 * @ApiExcludeController until every route in that phase's exit criteria is
 * built and has a docs/api-testing.md entry.
 */
@ApiTags('status-options')
@ApiExcludeController()
@ActorKinds('user')
@Controller({ path: 'status-options', version: '2' })
export class StatusOptionsController {
  constructor(private readonly statusOptions: StatusOptionsService) {}

  @Get()
  @RequirePermission('record.contact-properties.read')
  @ApiOperation({ summary: 'List status options for a module, optionally one group' })
  async list(@Query(zodPipe(listStatusOptionsQuerySchema)) query: ListStatusOptionsQuery) {
    return this.statusOptions.list(query);
  }

  @Post()
  @Idempotent()
  @RequirePermission('record.contact-properties.create')
  @ApiOperation({ summary: 'Add a status option to a group' })
  async create(@Body(zodPipe(createStatusOptionSchema)) body: CreateStatusOptionInput) {
    return this.statusOptions.create(body);
  }

  @Patch(':id')
  @RequirePermission('record.contact-properties.update')
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
  @RequirePermission('record.contact-properties.update')
  @ApiOperation({ summary: 'Reorder options within a group' })
  async reorder(@Body(zodPipe(reorderStatusOptionsSchema)) body: ReorderStatusOptionsInput) {
    await this.statusOptions.reorder(body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('record.contact-properties.delete')
  @ApiOperation({ summary: 'Delete a status option' })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.statusOptions.remove(id);
  }
}
