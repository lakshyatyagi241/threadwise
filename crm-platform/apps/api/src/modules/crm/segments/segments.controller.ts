import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  addSegmentToGroupSchema,
  createSegmentSchema,
  exportSegmentSchema,
  listContactsQuerySchema,
  listSegmentsQuerySchema,
  previewSegmentSchema,
  segmentFromFiltersSchema,
  segmentUsageQuerySchema,
  tagSegmentSchema,
  updateSegmentSchema,
  type AddSegmentToGroupInput,
  type CreateSegmentInput,
  type ExportSegmentInput,
  type ListContactsQuery,
  type ListSegmentsQuery,
  type PreviewSegmentInput,
  type RecordScope,
  type SegmentFromFiltersInput,
  type SegmentUsageQuery,
  type TagSegmentInput,
  type UpdateSegmentInput,
} from '@crm/contracts';
import {
  ActorKinds,
  GrantedScope,
  Idempotent,
  RequirePermission,
} from '../../../common/decorators';
import { zodPipe } from '../../../common/pipes/zod-validation.pipe';
import { SegmentActionsService } from './segment-actions.service';
import { SegmentsService } from './segments.service';

/**
 * Segments: saved rules that fill themselves (a product extension). Literal routes (`usage`,
 * `preview`, `from-filters`) are declared before `:id`, which would otherwise swallow them.
 */
@ApiTags('segments')
@ActorKinds('user')
@Controller({ path: 'segments', version: '2' })
export class SegmentsController {
  constructor(
    private readonly segments: SegmentsService,
    private readonly actions: SegmentActionsService,
  ) {}

  @Get()
  @RequirePermission('record.segments.read')
  @ApiOperation({
    summary: 'List the segments the caller can see (newest first)',
    description:
      'Counts are the cached ones; a list never counts. Private segments are visible to their owner and to callers who can edit every segment; `specific` ones also to the people and teams they are shared with.',
  })
  async list(@Query(zodPipe(listSegmentsQuerySchema)) query: ListSegmentsQuery) {
    return this.segments.list(query);
  }

  @Get('usage')
  @RequirePermission('record.segments.read')
  @ApiOperation({
    summary: 'Segments that use a tag, group, stage, status, property or user',
    description: 'The warning to show before deleting one of them.',
  })
  async usage(@Query(zodPipe(segmentUsageQuerySchema)) query: SegmentUsageQuery) {
    return this.segments.usage(query);
  }

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('record.segments.read')
  @ApiOperation({
    summary: 'Count and first 10 contacts for a set of rules, without saving',
    description:
      'Rate limited per user. Counting stops after 3 seconds and answers `countApproximate: true`. Needs record.contacts.read.',
  })
  async preview(
    @Body(zodPipe(previewSegmentSchema)) body: PreviewSegmentInput,
    @GrantedScope('record.contacts.read') scope: RecordScope,
  ) {
    return this.segments.preview(body, scope);
  }

  @Post('from-filters')
  @Idempotent()
  @RequirePermission('record.segments.create')
  @ApiOperation({
    summary: 'Save the current contacts filter as a segment',
    description:
      'The filter is converted to rules (AND of its parts); a filter with no conditions is 422.',
  })
  async fromFilters(@Body(zodPipe(segmentFromFiltersSchema)) body: SegmentFromFiltersInput) {
    return this.segments.createFromFilters(body);
  }

  @Post()
  @Idempotent()
  @RequirePermission('record.segments.create')
  @ApiOperation({
    summary: 'Create a segment',
    description:
      'Rules that point at a tag, group, stage, status, user or property that does not exist are 422 SEG_RULES_INVALID. A name another segment has is 409 SEG_NAME_TAKEN. With visibility `specific`, `sharedWith` must name at least one person or team of this workspace (422 SEG_SHARE_EMPTY / SEG_SHARE_USER_NOT_FOUND / SEG_SHARE_TEAM_NOT_FOUND).',
  })
  async create(@Body(zodPipe(createSegmentSchema)) body: CreateSegmentInput) {
    return this.segments.create(body);
  }

  @Get(':id')
  @RequirePermission('record.segments.read')
  @ApiOperation({
    summary: 'Get one segment with its member count',
    description:
      'The count is cached for 5 minutes and computed under a 3 second ceiling (`countApproximate`). `invalidConditions` lists conditions whose tag, group, stage, status, user or property was deleted: they match nothing.',
  })
  async get(@Param('id', ParseUUIDPipe) id: string) {
    return this.segments.get(id);
  }

  @Patch(':id')
  @RequirePermission('record.segments.update')
  @ApiOperation({
    summary: 'Update a segment',
    description:
      'Requires the rowVersion you read (409 ROW_VERSION_CONFLICT otherwise). Callers with an `own` scope may edit only segments they own. `sharedWith`, when sent, replaces the people list; sharing never grants edit rights.',
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateSegmentSchema)) body: UpdateSegmentInput,
  ) {
    return this.segments.update(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('record.segments.delete')
  @ApiOperation({ summary: 'Delete a segment (its contacts are untouched: it never owned them)' })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.segments.remove(id);
  }

  @Post(':id/refresh-count')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('record.segments.read')
  @ApiOperation({ summary: 'Recount the members now (rate limited) and store the count' })
  async refreshCount(@Param('id', ParseUUIDPipe) id: string) {
    return this.segments.refreshCount(id);
  }

  @Get(':id/contacts')
  @RequirePermission('record.contacts.read')
  @ApiOperation({
    summary: 'The contacts in a segment (cursor paginated)',
    description:
      'Same query, filters and `expand` as GET /contacts: it is GET /contacts?segmentId=:id.',
  })
  async members(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(zodPipe(listContactsQuerySchema)) query: ListContactsQuery,
    @GrantedScope('record.contacts.read') scope: RecordScope,
  ) {
    return this.segments.members(id, query, scope);
  }

  @Post(':id/export')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('record.contacts.export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @ApiOperation({
    summary: 'Export the members as CSV',
    description: 'The contacts export, over the segment. At most 200,000 rows.',
  })
  async export(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(exportSegmentSchema)) body: ExportSegmentInput,
    @GrantedScope('record.contacts.export') scope: RecordScope,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { stream, fileName } = await this.actions.export(id, body, scope);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    return new StreamableFile(stream);
  }

  @Post(':id/tag')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('record.contacts.update')
  @ApiOperation({
    summary: 'Tag every current member (a snapshot)',
    description:
      'By tagId or by name (a new name creates the tag: needs record.tags.create and counts against the plan). Contacts that join the segment later are not tagged.',
  })
  async tag(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(tagSegmentSchema)) body: TagSegmentInput,
    @GrantedScope('record.contacts.update') scope: RecordScope,
  ) {
    return this.actions.tag(id, body, scope);
  }

  @Post(':id/add-to-group')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('record.contacts.update')
  @ApiOperation({
    summary: 'Copy the current members into a group (a snapshot)',
    description:
      'More than 1000 members are added by a background job in chunks: the answer is `queued: true` with `changed: 0`.',
  })
  async addToGroup(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(addSegmentToGroupSchema)) body: AddSegmentToGroupInput,
    @GrantedScope('record.contacts.update') scope: RecordScope,
  ) {
    return this.actions.addToGroup(id, body, scope);
  }
}
