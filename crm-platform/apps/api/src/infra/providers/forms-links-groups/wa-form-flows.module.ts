import { Module } from '@nestjs/common';
import { WaFormFlowsClient } from './wa-form-flows.client';
import { WA_FORM_FLOWS } from './wa-form-flows.port';

/** Meta Graph adapter for WhatsApp Forms' publish pipeline (TW-WFL-004). Depends on the global `WabaProvidersModule`'s `WabaHttp`. */
@Module({
  providers: [WaFormFlowsClient, { provide: WA_FORM_FLOWS, useExisting: WaFormFlowsClient }],
  exports: [WA_FORM_FLOWS],
})
export class WaFormFlowsModule {}
