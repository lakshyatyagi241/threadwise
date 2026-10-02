import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  blogPublicQuerySchema,
  type BlogPublicQuery,
  type CmsContactSubmitResponse,
} from '@crm/contracts';
import { Public } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { BlogService } from './blog.service';
import { CmsContentService } from './content.service';
import { ContactService } from './contact.service';
import { LegalService } from './legal.service';
import { PricingService } from './pricing.service';

/**
 * What a visitor of the marketing site reads (WD-CMS-001..015). No sign-in, no tenant: the content tables are readable
 * by every connection, so none of these reads needs a privileged transaction.
 */
@ApiTags('public-cms')
@Public()
@Controller({ path: 'public/cms', version: '2' })
export class PublicCmsController {
  constructor(
    private readonly content: CmsContentService,
    private readonly legal: LegalService,
    private readonly blog: BlogService,
    private readonly pricing: PricingService,
    private readonly contact: ContactService,
  ) {}

  @Get('content')
  @ApiOperation({ summary: 'Published copy, colours and section layout, plus the homepage switch' })
  getContent() {
    return this.content.publicContent();
  }

  @Get('pricing')
  @ApiOperation({ summary: 'Active plans as public pricing cards' })
  getPricing() {
    return this.pricing.publicPricing();
  }

  @Get('legal')
  @ApiOperation({ summary: 'The published legal documents' })
  legalList() {
    return this.legal.publicList();
  }

  @Get('legal/:slug')
  @ApiOperation({ summary: 'One legal document (404 when hidden or not one of the five)' })
  legalOne(@Param('slug') slug: string) {
    return this.legal.publicGet(slug);
  }

  @Get('blog')
  @ApiOperation({ summary: 'Live posts, newest first, with the featured post and the categories' })
  blogIndex(@Query(zodPipe(blogPublicQuerySchema)) q: BlogPublicQuery) {
    return this.blog.publicIndex(q);
  }

  @Get('blog/:slug')
  @ApiOperation({ summary: 'One live post (counts a view); drafts and scheduled posts are 404' })
  blogOne(@Param('slug') slug: string) {
    return this.blog.publicPost(slug);
  }

  @Get('sitemap')
  @ApiOperation({ summary: 'What sitemap.xml lists' })
  sitemap() {
    return this.blog.sitemap();
  }

  @Post('contact')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Send a message to the team',
    description:
      'Six per minute per client. A filled honeypot field (`website`) answers like success and stores nothing.',
  })
  async submit(@Body() body: unknown): Promise<CmsContactSubmitResponse> {
    await this.contact.submit(body);
    return { ok: true };
  }
}
