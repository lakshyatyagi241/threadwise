import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  blogAdminListQuerySchema,
  cmsContactListQuerySchema,
  createBlogPostRequestSchema,
  setCmsContactReadRequestSchema,
  toggleBlogPostRequestSchema,
  toggleLegalPageRequestSchema,
  updateBlogPostRequestSchema,
  updateLegalPageRequestSchema,
  uuidSchema,
  type BlogAdminListQuery,
  type CmsContactListQuery,
  type CreateBlogPostRequest,
  type SetCmsContactReadRequest,
  type ToggleBlogPostRequest,
  type ToggleLegalPageRequest,
  type UpdateBlogPostRequest,
  type UpdateLegalPageRequest,
} from '@crm/contracts';
import { ActorKinds } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { OperatorGuard, OperatorRoles } from '../auth';
import { BlogService } from './blog.service';
import { ContactService } from './contact.service';
import { LegalService } from './legal.service';

const categoryBodySchema = z.object({ name: z.string().trim().min(1).max(120) });

/** Legal pages (WD-CMS-033..035). Every operator role reads; super admins write. */
@ApiTags('platform')
@ActorKinds('platform_operator')
@UseGuards(OperatorGuard)
@Controller({ path: 'platform/cms/legal', version: '2' })
export class OperatorLegalController {
  constructor(private readonly legal: LegalService) {}

  @Get()
  @ApiOperation({ summary: 'The five legal documents' })
  list() {
    return this.legal.list();
  }

  @Get(':slug')
  @ApiOperation({ summary: 'One legal document (404 for anything but the five slugs)' })
  one(@Param('slug') slug: string) {
    return this.legal.get(slug);
  }

  @Put(':slug')
  @OperatorRoles('super_admin')
  @ApiOperation({
    summary:
      'Edit a legal document; sections are rebuilt and sanitised (409 on a stale rowVersion)',
  })
  update(
    @Param('slug') slug: string,
    @Body(zodPipe(updateLegalPageRequestSchema)) body: UpdateLegalPageRequest,
  ) {
    return this.legal.update(slug, body);
  }

  @Post(':slug/toggle')
  @HttpCode(200)
  @OperatorRoles('super_admin')
  @ApiOperation({ summary: 'Hide or publish a legal document' })
  toggle(
    @Param('slug') slug: string,
    @Body(zodPipe(toggleLegalPageRequestSchema)) body: ToggleLegalPageRequest,
  ) {
    return this.legal.toggle(slug, body.rowVersion);
  }
}

/** The blog (WD-CMS-029..032). */
@ApiTags('platform')
@ActorKinds('platform_operator')
@UseGuards(OperatorGuard)
@Controller({ path: 'platform/cms/blog', version: '2' })
export class OperatorBlogController {
  constructor(private readonly blog: BlogService) {}

  @Get()
  @ApiOperation({ summary: 'Posts newest-created first with the KPI summary (cursor pagination)' })
  list(@Query(zodPipe(blogAdminListQuerySchema)) q: BlogAdminListQuery) {
    return this.blog.adminList(q);
  }

  @Get('categories')
  @ApiOperation({ summary: 'Every category by name' })
  categories() {
    return this.blog.categories();
  }

  @Post('categories')
  @OperatorRoles('super_admin')
  @ApiOperation({ summary: 'Create a category (an existing name is reused)' })
  createCategory(@Body(zodPipe(categoryBodySchema)) body: { name: string }) {
    return this.blog.createCategory(body.name);
  }

  @Post()
  @OperatorRoles('super_admin')
  @ApiOperation({ summary: 'Create a post' })
  create(@Body(zodPipe(createBlogPostRequestSchema)) body: CreateBlogPostRequest) {
    return this.blog.create(body);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One post, for the editor' })
  one(@Param('id', zodPipe(uuidSchema)) id: string) {
    return this.blog.adminGet(id);
  }

  @Put(':id')
  @OperatorRoles('super_admin')
  @ApiOperation({ summary: 'Replace a post’s fields (409 on a stale rowVersion)' })
  update(
    @Param('id', zodPipe(uuidSchema)) id: string,
    @Body(zodPipe(updateBlogPostRequestSchema)) body: UpdateBlogPostRequest,
  ) {
    return this.blog.update(id, body);
  }

  @Post(':id/toggle')
  @HttpCode(200)
  @OperatorRoles('super_admin')
  @ApiOperation({ summary: 'Publish or unpublish a post' })
  toggle(
    @Param('id', zodPipe(uuidSchema)) id: string,
    @Body(zodPipe(toggleBlogPostRequestSchema)) body: ToggleBlogPostRequest,
  ) {
    return this.blog.toggle(id, body.rowVersion);
  }

  @Delete(':id')
  @OperatorRoles('super_admin')
  @ApiOperation({ summary: 'Delete a post permanently' })
  async remove(@Param('id', zodPipe(uuidSchema)) id: string) {
    await this.blog.remove(id);
    return { ok: true as const };
  }
}

/** The contact inbox (WD-CMS-042/043). Personal data: reading it is limited to operators like everything here. */
@ApiTags('platform')
@ActorKinds('platform_operator')
@UseGuards(OperatorGuard)
@Controller({ path: 'platform/cms/contact-messages', version: '2' })
export class OperatorContactController {
  constructor(private readonly contact: ContactService) {}

  @Get()
  @ApiOperation({ summary: 'Messages newest first, filter by read state, search' })
  list(@Query(zodPipe(cmsContactListQuerySchema)) q: CmsContactListQuery) {
    return this.contact.list(q);
  }

  @Post('read-all')
  @HttpCode(200)
  @OperatorRoles('super_admin', 'support')
  @ApiOperation({ summary: 'Mark every unread message read' })
  markAllRead() {
    return this.contact.markAllRead();
  }

  @Patch(':id/read')
  @OperatorRoles('super_admin', 'support')
  @ApiOperation({ summary: 'Mark a message read or unread' })
  setRead(
    @Param('id', zodPipe(uuidSchema)) id: string,
    @Body(zodPipe(setCmsContactReadRequestSchema)) body: SetCmsContactReadRequest,
  ) {
    return this.contact.setRead(id, body.isRead);
  }

  @Delete(':id')
  @OperatorRoles('super_admin')
  @ApiOperation({ summary: 'Delete a message permanently' })
  async remove(@Param('id', zodPipe(uuidSchema)) id: string) {
    await this.contact.remove(id);
    return { ok: true as const };
  }
}
