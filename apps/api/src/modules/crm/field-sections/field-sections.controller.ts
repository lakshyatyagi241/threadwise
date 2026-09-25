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
  createFieldSectionSchema,
  listFieldSectionsQuerySchema,
  reorderFieldSectionsSchema,
  updateFieldSectionSchema,
  type CreateFieldSectionInput,
  type ListFieldSectionsQuery,
  type ReorderFieldSectionsInput,
  type UpdateFieldSectionInput,
} from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../../common/decorators';
import { zodPipe } from '../../../common/pipes/zod-validation.pipe';
import { anyPropertyPermission } from '../field-metadata-permission';
import { FieldSectionsService } from './field-sections.service';

/**
 * Settings > Data Management > Contact Properties AND Company Properties
 * (moduleKey picks which): section groups a field renders under. Phase 7 +
 * Phase 8 (docs/phase-plan.md) — stays out of /docs via @ApiExcludeController
 * until every route in both phases' exit criteria is built and has a
 * docs/api-testing.md entry.
 */
@ApiTags('field-sections')
@ApiExcludeController()
@ActorKinds('user')
@Controller({ path: 'field-sections', version: '2' })
export class FieldSectionsController {
  constructor(private readonly sections: FieldSectionsService) {}

  @Get()
  @RequirePermission(...anyPropertyPermission('read'))
  @ApiOperation({ summary: 'List field sections for a module (e.g. contacts)' })
  async list(@Query(zodPipe(listFieldSectionsQuerySchema)) query: ListFieldSectionsQuery) {
    return this.sections.list(query);
  }

  @Post()
  @Idempotent()
  @RequirePermission(...anyPropertyPermission('create'))
  @ApiOperation({ summary: 'Add a section' })
  async create(@Body(zodPipe(createFieldSectionSchema)) body: CreateFieldSectionInput) {
    return this.sections.create(body);
  }

  @Patch(':id')
  @RequirePermission(...anyPropertyPermission('update'))
  @ApiOperation({
    summary: 'Rename or (de)activate a section',
    description: 'Requires the rowVersion you read. A mismatch returns 409 ROW_VERSION_CONFLICT.',
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateFieldSectionSchema)) body: UpdateFieldSectionInput,
  ) {
    return this.sections.update(id, body);
  }

  @Post('reorder')
  @RequirePermission(...anyPropertyPermission('update'))
  @ApiOperation({ summary: 'Reorder sections within a module' })
  async reorder(@Body(zodPipe(reorderFieldSectionsSchema)) body: ReorderFieldSectionsInput) {
    await this.sections.reorder(body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(...anyPropertyPermission('delete'))
  @ApiOperation({
    summary: 'Delete a section',
    description: 'Fields in the section become sectionless, not deleted.',
  })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.sections.remove(id);
  }
}
