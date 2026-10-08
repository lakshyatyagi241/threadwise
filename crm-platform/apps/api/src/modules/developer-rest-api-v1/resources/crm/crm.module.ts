import { Module } from '@nestjs/common';
import { CrmModule } from '../../../crm';
import { PlansCoreModule } from '../../../plans-subscriptions-trials';
import { WalletMessageBillingModule } from '../../../wallet-message-billing';
import { V1AccountController } from './account/account.controller';
import { AccountService } from './account/account.service';
import { V1ContactGroupsController } from './contact-groups/contact-groups.controller';
import { V1ContactGroupsService } from './contact-groups/contact-groups.service';
import { ContactExtrasRepository } from './contacts/contact-extras.repository';
import { V1ContactsController } from './contacts/contacts.controller';
import { V1ContactsService } from './contacts/contacts.service';
import { DealsPlanGuard } from './deals/deals-plan.guard';
import { V1DealsController } from './deals/deals.controller';
import { V1DealsService } from './deals/deals.service';

/** Customer REST API v1 resources: crm (account, contacts, contact groups, deals). The root module imports it. */
@Module({
  imports: [CrmModule, PlansCoreModule, WalletMessageBillingModule],
  controllers: [
    V1AccountController,
    V1ContactsController,
    V1ContactGroupsController,
    V1DealsController,
  ],
  providers: [
    AccountService,
    V1ContactsService,
    ContactExtrasRepository,
    V1ContactGroupsService,
    V1DealsService,
    DealsPlanGuard,
  ],
})
export class V1CrmModule {}
