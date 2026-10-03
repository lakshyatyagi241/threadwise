import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  createFbPostSchema,
  listFbPostsQuerySchema,
  type CreateFbPostInput,
  type ListFbPostsQuery,
} from '@crm/contracts';
import { ActorKinds, Idempotent, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { PostsService } from './posts.service';

/** Facebook posts: compose, schedule, list, retry, delete, and the live grid of the Page's feed (TW-FB-016 to 018). */
@ApiTags('facebook')
@ActorKinds('user')
@Controller({ path: 'facebook', version: '2' })
export class PostsController {
  constructor(private readonly posts: PostsService) {}

  @Get('posts')
  @RequirePermission('fb.posts.read')
  @ApiOperation({
    summary: 'Posts with the KPI counts, filters (status, type, range, search, Page) and 15 a page',
    description:
      'Scheduled posts first, then failed or draft, then the rest. `failed` counts and filters drafts too. The counts ignore every filter but the Page.',
  })
  list(@Query(zodPipe(listFbPostsQuerySchema)) query: ListFbPostsQuery) {
    return this.posts.list(query);
  }

  @Post('posts')
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('fb.posts.manage')
  @ApiOperation({
    summary: 'Make a post on a Page: publish now, or schedule it 10 minutes to 75 days ahead',
    description:
      '422 FB_PAGE_UNAVAILABLE, FB_POST_INVALID (nothing in it, photos and a link together, a video address that is not HTTPS) or FB_SCHEDULE_INVALID. ' +
      'The post is saved before Meta is called. A refusal by Meta is a 201 whose post has `status = failed` and `error`, and can be retried.',
  })
  create(@Body(zodPipe(createFbPostSchema)) body: CreateFbPostInput) {
    return this.posts.create(body);
  }

  @Post('posts/:id/publish')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('fb.posts.manage')
  @ApiOperation({
    summary: 'Publish a draft or failed post now (retry)',
    description: '409 FB_POST_INVALID for a post that is already published or scheduled.',
  })
  publish(@Param('id', ParseUUIDPipe) id: string) {
    return this.posts.publish(id);
  }

  @Delete('posts/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('fb.posts.manage')
  @ApiOperation({
    summary: 'Delete a post: from Facebook too when it has been published or scheduled, then here',
  })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.posts.remove(id);
  }

  @Get('my-posts')
  @RequirePermission('fb.posts.read')
  @ApiQuery({
    name: 'page',
    required: false,
    description: 'A Page id; the first connected Page when absent.',
  })
  @ApiOperation({
    summary: "The Page's 50 newest published posts, read live from Facebook (nothing is stored)",
    description: 'Facebook not answering is an empty list, never an error.',
  })
  myPosts(@Query('page', new ParseUUIDPipe({ optional: true })) page: string | undefined) {
    return this.posts.myPosts(page);
  }
}
