import { Module } from '@nestjs/common';
import { CustomerTicketsController } from './customer-tickets.controller';
import { CustomerTicketsService } from './customer-tickets.service';
import { OperatorTicketsController } from './operator-tickets.controller';
import { OperatorTicketsService } from './operator-tickets.service';
import { SupportMailer } from './support-mailer.service';
import { SupportStore } from './support-store';

/**
 * Platform support desk (SUPP): the customer ticket form and the operator helpdesk. The operator guard comes from the
 * auth barrel; the mail port is global (infra providers).
 */
@Module({
  controllers: [CustomerTicketsController, OperatorTicketsController],
  providers: [CustomerTicketsService, OperatorTicketsService, SupportMailer, SupportStore],
})
export class PlatformSupportDeskModule {}
