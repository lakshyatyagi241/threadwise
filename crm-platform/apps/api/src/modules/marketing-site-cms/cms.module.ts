import { Module } from '@nestjs/common';
import { AnnouncementService } from './announcement.service';
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
import { PlatformSettingsModule } from '../platform-settings-branding-storage';
import { PricingService } from './pricing.service';
import { OperatorAnnouncementsController } from './operator-site.controller';
import { PublicCmsController } from './public-cms.controller';
import { CmsUploadService } from './upload.service';
import { WorkspaceAnnouncementsController } from './workspace-cms.controller';

/**
 * The marketing site, its page editor, blog, legal pages and contact inbox (domain CMS). The auth module is global
 * (guards, audit, sanitiser, captcha, rate limit, platform settings); the plan catalogue is read from its table with
 * PLAN's own card builder. Registered in app.module.ts.
 */
@Module({
  imports: [PlatformSettingsModule],
  controllers: [
    PublicCmsController,
    OperatorContentController,
    OperatorLegalController,
    OperatorBlogController,
    OperatorContactController,
    OperatorAnnouncementsController,
    WorkspaceAnnouncementsController,
  ],
  providers: [
    CmsStore,
    CmsContentService,
    LegalService,
    BlogService,
    ContactService,
    PricingService,
    AnnouncementService,
    CmsUploadService,
  ],
})
export class CmsModule {}
