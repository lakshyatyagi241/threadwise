import { Module } from '@nestjs/common';
import { BlogService } from './blog.service';
import { CmsStore } from './cms-store';
import { ContactService } from './contact.service';
import { CmsContentService } from './content.service';
import { LegalService } from './legal.service';
import {
  OperatorBlogController,
  OperatorContactController,
  OperatorLegalController,
} from './operator-pages.controller';
import { OperatorContentController } from './operator-content.controller';
import { PricingService } from './pricing.service';
import { PublicCmsController } from './public-cms.controller';

/**
 * The marketing site, its page editor, blog, legal pages and contact inbox (domain CMS). The auth module is global
 * (guards, audit, sanitiser, captcha, rate limit, platform settings); the plan catalogue is read from its table with
 * PLAN's own card builder. Registered in app.module.ts.
 */
@Module({
  controllers: [
    PublicCmsController,
    OperatorContentController,
    OperatorLegalController,
    OperatorBlogController,
    OperatorContactController,
  ],
  providers: [
    CmsStore,
    CmsContentService,
    LegalService,
    BlogService,
    ContactService,
    PricingService,
  ],
})
export class CmsModule {}
