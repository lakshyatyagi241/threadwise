import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  listContactStoreOrdersQuerySchema,
  type ContactStoreOrdersResponse,
  type ListContactStoreOrdersQuery,
} from '@crm/contracts';
import { ActorKinds, RequirePermission } from '../../common/decorators';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { StoreOrderSalesService } from './store-order-sales.service';

/**
 * Contact detail page: the Store orders tab (the owner's decision of 2026-10-05 that store buyers are contacts). Read-only, gated like
 * every other contact read (`record.contacts.read`, with its record scope applied by the service: an `own` grant reaches only its own
 * contacts and any other contact is a 404). Lives with the bridge, not in the contacts module, because the CRM module cannot import it.
 */
@ApiTags('contacts')
@ActorKinds('user')
@Controller({ path: 'contacts/:contactId/store-orders', version: '2' })
export class ContactStoreOrdersController {
  constructor(private readonly sales: StoreOrderSalesService) {}

  @Get()
  @RequirePermission('record.contacts.read')
  @ApiOperation({ summary: "List a contact's store orders (with their sales order and invoice)" })
  async list(
    @Param('contactId', ParseUUIDPipe) contactId: string,
    @Query(zodPipe(listContactStoreOrdersQuerySchema)) query: ListContactStoreOrdersQuery,
  ): Promise<ContactStoreOrdersResponse> {
    return this.sales.listForContact(contactId, query.limit);
  }
}
