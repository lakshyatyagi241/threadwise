import { Module } from '@nestjs/common';
import { AppointmentsBookingModule } from '../../../../appointments-booking';
import { MessageTemplatesModule } from '../../../../message-templates';
import { FlowRefResolver } from '../flow-refs';
import { BookNode } from './book-node';
import { CommerceNodes } from './commerce-nodes';
import { FormNode } from './form-node';
import { FlowShopGate } from './shop-port';
import { ShopNode } from './shop-node';
import { WaFormRecords } from './wa-form-records';
import { TemplateNode } from './template-node';

/** Imports the domains this node group calls (their public modules only); never the flow runtime module (it imports this one). */
@Module({
  imports: [MessageTemplatesModule, AppointmentsBookingModule],
  providers: [
    CommerceNodes,
    TemplateNode,
    FlowRefResolver,
    BookNode,
    ShopNode,
    FormNode,
    FlowShopGate,
    WaFormRecords,
  ],
  // The gate is where a store domain binds its adapter; the form records are what the worker's resume listener writes through.
  exports: [CommerceNodes, FlowShopGate, WaFormRecords],
})
export class CommerceNodesModule {}
