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
  createFieldDependencySchema,
  createFieldOptionDependencySchema,
  createFieldOptionSchema,
  createFieldSchema,
  listFieldsQuerySchema,
  reorderFieldOptionsSchema,
  reorderFieldsSchema,
  updateFieldOptionSchema,
  updateFieldSchema,
  type CreateFieldDependencyInput,
  type CreateFieldInput,
  type CreateFieldOptionDependencyInput,
  type CreateFieldOptionInput,
  type ListFieldsQuery,
  type ReorderFieldOptionsInput,
  type ReorderFieldsInput,
  type UpdateFieldInput,
  type UpdateFieldOptionInput,
} from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../../common/decorators';
import { zodPipe } from '../../../common/pipes/zod-validation.pipe';
import { anyPropertyPermission } from '../field-metadata-permission';
import { FieldsService } from './fields.service';

/**
 * Settings > Data Management > Contact Properties AND Company Properties
 * (moduleKey picks which): the field registry itself, plus its options and
 * dependency edges as nested sub-resources — neither makes sense outside the
 * context of one field. Phase 7 + Phase 8 (docs/phase-plan.md) —
 * @ApiExcludeController until every route in both phases' exit criteria is
 * built and has a docs/api-testing.md entry.
 */
@ApiTags('fields')
@ApiExcludeController()
@ActorKinds('user')
@Controller({ path: 'fields', version: '2' })
export class FieldsController {
  constructor(private readonly fields: FieldsService) {}

  @Get()
  @RequirePermission(...anyPropertyPermission('read'))
  @ApiOperation({ summary: 'List fields for a module (optionally one section)' })
  async list(@Query(zodPipe(listFieldsQuerySchema)) query: ListFieldsQuery) {
    return this.fields.list(query);
  }

  @Get(':id')
  @RequirePermission(...anyPropertyPermission('read'))
  @ApiOperation({ summary: 'Get one field by uuid' })
  async get(@Param('id', ParseUUIDPipe) id: string) {
    return this.fields.getByUuid(id);
  }

  @Post()
  @Idempotent()
  @RequirePermission(...anyPropertyPermission('create'))
  @ApiOperation({
    summary: 'Add a field',
    description: '`key` and `fieldType` are immutable once created — see UpdateField for why.',
  })
  async create(@Body(zodPipe(createFieldSchema)) body: CreateFieldInput) {
    return this.fields.create(body);
  }

  @Patch(':id')
  @RequirePermission(...anyPropertyPermission('update'))
  @ApiOperation({
    summary: 'Update a field',
    description:
      'Every flag except key/fieldType. Requires the rowVersion you read; a mismatch returns 409 ROW_VERSION_CONFLICT.',
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateFieldSchema)) body: UpdateFieldInput,
  ) {
    return this.fields.update(id, body);
  }

  @Post('reorder')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(...anyPropertyPermission('update'))
  @ApiOperation({ summary: 'Reorder fields within a section' })
  async reorder(@Body(zodPipe(reorderFieldsSchema)) body: ReorderFieldsInput) {
    await this.fields.reorder(body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(...anyPropertyPermission('delete'))
  @ApiOperation({
    summary: 'Deactivate a field',
    description: 'Soft delete (isActive=false) — a system field (isSystem) returns 409 instead.',
  })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.fields.remove(id);
  }

  // --- options (select/multiselect/radio) --------------------------------

  @Get(':id/options')
  @RequirePermission(...anyPropertyPermission('read'))
  @ApiOperation({ summary: "List a field's options" })
  async listOptions(@Param('id', ParseUUIDPipe) id: string) {
    return this.fields.listOptions(id);
  }

  @Post(':id/options')
  @Idempotent()
  @RequirePermission(...anyPropertyPermission('create'))
  @ApiOperation({ summary: 'Add an option' })
  async createOption(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(createFieldOptionSchema)) body: CreateFieldOptionInput,
  ) {
    return this.fields.createOption(id, body);
  }

  @Patch('options/:optionId')
  @RequirePermission(...anyPropertyPermission('update'))
  @ApiOperation({ summary: 'Update an option' })
  async updateOption(
    @Param('optionId', ParseUUIDPipe) optionId: string,
    @Body(zodPipe(updateFieldOptionSchema)) body: UpdateFieldOptionInput,
  ) {
    return this.fields.updateOption(optionId, body);
  }

  @Post(':id/options/reorder')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(...anyPropertyPermission('update'))
  @ApiOperation({ summary: "Reorder a field's options" })
  async reorderOptions(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(reorderFieldOptionsSchema)) body: ReorderFieldOptionsInput,
  ) {
    await this.fields.reorderOptions(id, body);
  }

  @Delete('options/:optionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(...anyPropertyPermission('delete'))
  @ApiOperation({ summary: 'Delete an option' })
  async removeOption(@Param('optionId', ParseUUIDPipe) optionId: string): Promise<void> {
    await this.fields.removeOption(optionId);
  }

  // --- dependencies -------------------------------------------------------

  @Get(':id/dependencies')
  @RequirePermission(...anyPropertyPermission('read'))
  @ApiOperation({ summary: "List a field's dependencies" })
  async listDependencies(@Param('id', ParseUUIDPipe) id: string) {
    return this.fields.listDependencies(id);
  }

  @Post('dependencies')
  @Idempotent()
  @RequirePermission(...anyPropertyPermission('create'))
  @ApiOperation({
    summary: 'Make a field depend on another field',
    description: 'Rejected with 409 DEPENDENCY_CYCLE_DETECTED if it would close a cycle.',
  })
  async createDependency(
    @Body(zodPipe(createFieldDependencySchema)) body: CreateFieldDependencyInput,
  ) {
    return this.fields.createDependency(body);
  }

  @Delete('dependencies/:dependencyId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(...anyPropertyPermission('delete'))
  @ApiOperation({ summary: 'Remove a field dependency' })
  async removeDependency(
    @Param('dependencyId', ParseUUIDPipe) dependencyId: string,
  ): Promise<void> {
    await this.fields.removeDependency(dependencyId);
  }

  @Get('options/:optionId/dependencies')
  @RequirePermission(...anyPropertyPermission('read'))
  @ApiOperation({ summary: "List an option's child-option dependencies" })
  async listOptionDependencies(@Param('optionId', ParseUUIDPipe) optionId: string) {
    return this.fields.listOptionDependencies(optionId);
  }

  @Post('options/dependencies')
  @Idempotent()
  @RequirePermission(...anyPropertyPermission('create'))
  @ApiOperation({ summary: 'Make a child option selectable when a parent option is chosen' })
  async createOptionDependency(
    @Body(zodPipe(createFieldOptionDependencySchema)) body: CreateFieldOptionDependencyInput,
  ) {
    return this.fields.createOptionDependency(body);
  }

  @Delete('options/dependencies/:dependencyId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(...anyPropertyPermission('delete'))
  @ApiOperation({ summary: 'Remove an option-level dependency' })
  async removeOptionDependency(
    @Param('dependencyId', ParseUUIDPipe) dependencyId: string,
  ): Promise<void> {
    await this.fields.removeOptionDependency(dependencyId);
  }
}
