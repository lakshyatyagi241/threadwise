import { Module } from '@nestjs/common';
import { ContactConsentModule } from '../../../contact-consent';
import { CrmModule } from '../../../crm';
import { PlansCoreModule } from '../../../plans-subscriptions-trials';
import { WalletMessageBillingModule } from '../../../wallet-message-billing';
import { V1AccountController } from './account/account.controller';
import { AccountService } from './account/account.service';
import { V1ContactGroupsController } from './contact-groups/contact-groups.controller';
import { V1ContactGroupsService } from './contact-groups/contact-groups.service';
import { CompaniesPlanGuard } from './companies/companies-plan.guard';
import { V1CompaniesController } from './companies/companies.controller';
import { V1CompaniesService } from './companies/companies.service';
import { ContactExtrasRepository } from './contacts/contact-extras.repository';
import { V1ContactConsentController } from './contacts/contact-consent.v1.controller';
import { V1ContactsController } from './contacts/contacts.controller';
import { V1ContactsService } from './contacts/contacts.service';
import { DealsPlanGuard } from './deals/deals-plan.guard';
import { V1DealsController } from './deals/deals.controller';
import { V1DealsService } from './deals/deals.service';

/** Customer REST API v1 resources: crm (account, contacts, contact groups, deals, companies). The root module imports it. */
@Module({
  imports: [CrmModule, ContactConsentModule, PlansCoreModule, WalletMessageBillingModule],
  controllers: [
    V1AccountController,
    V1ContactsController,
    V1ContactConsentController,
    V1ContactGroupsController,
    V1DealsController,
    V1CompaniesController,
  ],
  providers: [
    AccountService,
    V1ContactsService,
    ContactExtrasRepository,
    V1ContactGroupsService,
    V1DealsService,
    DealsPlanGuard,
    V1CompaniesService,
    CompaniesPlanGuard,
  ],
})
export class V1CrmModule {}
