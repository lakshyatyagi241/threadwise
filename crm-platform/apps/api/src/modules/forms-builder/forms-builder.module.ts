import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { CrmModule } from '../crm';
import { PlansCoreModule } from '../plans-subscriptions-trials';
import { FormCatalogueService } from './form-catalogue.service';
import { FormLookupService } from './form-lookup.service';
import { FormsPlan } from './form-plan';
import { FormPublicService } from './form-public.service';
import { FormSubmissionsController } from './form-submissions.controller';
import { FormSubmissionsRepository } from './form-submissions.repository';
import { FormSubmissionsService } from './form-submissions.service';
import { FormSubmitService } from './form-submit.service';
import { FormThrottle } from './form-throttle';
import { FormsController } from './forms.controller';
import { FormsRepository } from './forms.repository';
import { FormsService } from './forms.service';
import { FormsPreflightMiddleware } from './forms-preflight.middleware';
import { FormEmbedController, PublicFormsController } from './public-forms.controller';

/**
 * Forms (the Form Builder add-on, docs/specs/forms-builder-app.md; backlog BL-093): the admin API under `/v2/forms`, the public form under
 * `/v2/public/forms/<publicKey>` and the embed loader at `/form-embed/<publicKey>/embed.js`.
 *
 * A paid Marketplace app: every admin route needs the plan feature `form_builder` (granted only by owning the app), and the public routes
 * answer 404 for a workspace that does not own it. The outbox consumers (notifications) and the retention sweep are
 * `FormsBuilderWorkerModule` (the worker process only).
 */
@Module({
  // CrmModule: contacts (find-or-create by identity), companies, tags, the timeline. PlansCoreModule: the feature flag and the caps.
  imports: [CrmModule, PlansCoreModule],
  controllers: [
    // `templates` and `meta/properties` are literal paths declared before `:id` inside FormsController; `export` before `:sid`.
    FormsController,
    FormSubmissionsController,
    PublicFormsController,
    FormEmbedController,
  ],
  providers: [
    FormsRepository,
    FormSubmissionsRepository,
    FormsPlan,
    FormThrottle,
    FormLookupService,
    FormsService,
    FormCatalogueService,
    FormSubmissionsService,
    FormSubmitService,
    FormPublicService,
    FormsPreflightMiddleware,
  ],
  exports: [FormsPreflightMiddleware],
})
export class FormsBuilderModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // The form's own CORS preflight, in the module so a test app (no main.ts) behaves like the real one.
    consumer.apply(FormsPreflightMiddleware).forRoutes('*');
  }
}
