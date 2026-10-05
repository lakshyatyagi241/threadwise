import { Module } from '@nestjs/common';
import { RolesPermissionsModule } from '../roles-permissions';
import { AgentsService } from './agents.service';
import { BoardService } from './board.service';
import { CustomerTicketsController } from './customer-tickets.controller';
import { CustomerTicketsService } from './customer-tickets.service';
import { CustomersService } from './customers.service';
import { DeskController } from './desk.controller';
import { OperatorTicketsController } from './operator-tickets.controller';
import { OperatorTicketsService } from './operator-tickets.service';
import { PlatformInboxController } from './platform-inbox.controller';
import { PlatformInboxService } from './platform-inbox.service';
import { PlaybooksService } from './playbooks.service';
import { ReportsService } from './reports.service';
import { SlaService } from './sla.service';
import { SupportMailer } from './support-mailer.service';
import { SupportStore } from './support-store';
import { TicketActions } from './ticket-actions.service';

/**
 * Platform support desk (SUPP): the customer ticket form, the operator helpdesk and the platform inbox. The operator guards
 * come from the auth and roles-permissions barrels; the mail port is global (infra providers).
 */
@Module({
  imports: [RolesPermissionsModule],
  controllers: [
    CustomerTicketsController,
    OperatorTicketsController,
    DeskController,
    PlatformInboxController,
  ],
  providers: [
    CustomerTicketsService,
    OperatorTicketsService,
    TicketActions,
    SlaService,
    BoardService,
    AgentsService,
    CustomersService,
    PlaybooksService,
    ReportsService,
    PlatformInboxService,
    SupportMailer,
    SupportStore,
  ],
})
export class PlatformSupportDeskModule {}
