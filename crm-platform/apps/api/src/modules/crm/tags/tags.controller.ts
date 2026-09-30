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
  createTagSchema,
  listTagsQuerySchema,
  setContactTagsSchema,
  updateTagSchema,
  type CreateTagInput,
  type ListTagsQuery,
  type SetContactTagsInput,
  type UpdateTagInput,
} from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../../common/decorators';
import { zodPipe } from '../../../common/pipes/zod-validation.pipe';
import { TagsService } from './tags.service';

/** Org-wide tags and their attachment to contacts. Phase 11 (docs/phase-plan.md). */
@ApiTags('tags')
@ActorKinds('user')
@Controller({ path: 'tags', version: '2' })
export class TagsController {
  constructor(private readonly tags: TagsService) {}

  @Get()
  @RequirePermission('record.tags.read')
  @ApiOperation({ summary: 'List tags (cursor paginated)' })
  async list(@Query(zodPipe(listTagsQuerySchema)) query: ListTagsQuery) {
    return this.tags.list(query);
  }

  @Post()
  @Idempotent()
  @RequirePermission('record.tags.create')
  @ApiOperation({ summary: 'Create a tag' })
  async create(@Body(zodPipe(createTagSchema)) body: CreateTagInput) {
    return this.tags.create(body);
  }

  @Patch(':id')
  @RequirePermission('record.tags.update')
  @ApiOperation({
    summary: 'Update a tag',
    description: 'Requires the rowVersion you read. A mismatch returns 409 ROW_VERSION_CONFLICT.',
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateTagSchema)) body: UpdateTagInput,
  ) {
    return this.tags.update(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('record.tags.delete')
  @ApiOperation({ summary: 'Delete a tag (removes it from every contact it was on)' })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.tags.remove(id);
  }

  @Post('attach')
  @Idempotent()
  @RequirePermission('record.tags.update')
  @ApiOperation({
    summary: 'Attach tags to contacts',
    description: 'Idempotent per (contact, tag) pair. Partial failure reported per contact id.',
  })
  async attach(@Body(zodPipe(setContactTagsSchema)) body: SetContactTagsInput) {
    return this.tags.attachToContacts(body);
  }
}
