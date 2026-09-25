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
  createContactViewSchema,
  listContactViewsQuerySchema,
  reorderContactViewsSchema,
  updateContactViewSchema,
  type CreateContactViewInput,
  type ListContactViewsQuery,
  type ReorderContactViewsInput,
  type UpdateContactViewInput,
} from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../../common/decorators';
import { zodPipe } from '../../../common/pipes/zod-validation.pipe';
import { ContactViewsService } from './contact-views.service';

/**
 * Saved contact list views. Phase 11 (docs/phase-plan.md) —
 * @ApiExcludeController until every route in that phase's exit criteria is
 * built and has a docs/api-testing.md entry.
 */
@ApiTags('contact-views')
@ApiExcludeController()
@ActorKinds('user')
@Controller({ path: 'contact-views', version: '2' })
export class ContactViewsController {
  constructor(private readonly views: ContactViewsService) {}

  @Get()
  @RequirePermission('record.contact-views.read')
  @ApiOperation({ summary: 'List views visible to the caller (their own + org-shared)' })
  async list(@Query(zodPipe(listContactViewsQuerySchema)) query: ListContactViewsQuery) {
    return this.views.list(query);
  }

  @Post()
  @Idempotent()
  @RequirePermission('record.contact-views.create')
  @ApiOperation({ summary: 'Create a saved view' })
  async create(@Body(zodPipe(createContactViewSchema)) body: CreateContactViewInput) {
    return this.views.create(body);
  }

  @Patch(':id')
  @RequirePermission('record.contact-views.update')
  @ApiOperation({
    summary: 'Update a saved view',
    description: 'Requires the rowVersion you read. A mismatch returns 409 ROW_VERSION_CONFLICT.',
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodPipe(updateContactViewSchema)) body: UpdateContactViewInput,
  ) {
    return this.views.update(id, body);
  }

  @Post('reorder')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('record.contact-views.update')
  @ApiOperation({ summary: 'Reorder views' })
  async reorder(@Body(zodPipe(reorderContactViewsSchema)) body: ReorderContactViewsInput) {
    await this.views.reorder(body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('record.contact-views.delete')
  @ApiOperation({ summary: 'Delete a saved view' })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.views.remove(id);
  }

  @Post(':id/favorite')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('record.contact-views.read')
  @ApiOperation({ summary: "Pin a shared view onto the caller's own sidebar" })
  async favorite(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.views.favorite(id);
  }

  @Delete(':id/favorite')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('record.contact-views.read')
  @ApiOperation({ summary: 'Unpin a view — the view itself is not deleted' })
  async unfavorite(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.views.unfavorite(id);
  }
}
