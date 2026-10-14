import { Module } from '@nestjs/common';
import { PlansCoreModule } from '../plans-subscriptions-trials';
import { EmailTemplatesController } from './email-templates.controller';
import { EmailTemplatesReader } from './email-templates.reader';
import { EmailTemplatesRepository } from './email-templates.repository';
import { EmailTemplatesService } from './email-templates.service';

/**
 * Email templates (BL-004 / E-14): the library behind the email composer's Templates picker. The API serves the library; the team inbox
 * renders a template for a conversation (`EmailTemplatesService.renderFor`) and asks the reader what a reply from a template is; the
 * email channel counts the use after the provider accepted the mail (`EmailTemplatesReader.recordUse`).
 */
@Module({
  imports: [PlansCoreModule],
  controllers: [EmailTemplatesController],
  providers: [EmailTemplatesRepository, EmailTemplatesService, EmailTemplatesReader],
  exports: [EmailTemplatesService, EmailTemplatesReader],
})
export class EmailTemplatesModule {}
