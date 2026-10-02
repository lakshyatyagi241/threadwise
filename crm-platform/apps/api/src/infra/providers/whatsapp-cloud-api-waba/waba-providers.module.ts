import { Global, Module } from '@nestjs/common';
import { readWabaEnv, WABA_ENV } from '../../../config/domains/whatsapp-cloud-api-waba.env';
import { WabaAdminClient } from './waba-admin.client';
import { WABA_ADMIN } from './waba-admin.port';
import { WabaHttp } from './waba-http';
import { WabaTemplateClient } from './waba-template.client';
import { WABA_TEMPLATES } from './waba-template.port';

/** WhatsApp account adapters (Meta Graph + Interakt). Global so any domain can send or inspect through the ports. */
@Global()
@Module({
  providers: [
    { provide: WABA_ENV, useFactory: () => readWabaEnv(process.env) },
    WabaHttp,
    WabaAdminClient,
    { provide: WABA_ADMIN, useExisting: WabaAdminClient },
    WabaTemplateClient,
    { provide: WABA_TEMPLATES, useExisting: WabaTemplateClient },
  ],
  exports: [WABA_ENV, WabaHttp, WABA_ADMIN, WABA_TEMPLATES],
})
export class WabaProvidersModule {}
