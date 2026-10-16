/**
 * Public surface of the Meta lead ads door (BL-011). The HTTP side is imported by AppModule, the worker side by WorkersModule only.
 * Nothing else leaves the module: the lead pipeline is reached through its ports, the Facebook channel through its barrel.
 */
export { MetaLeadAdsModule } from './meta-lead-ads.module';
export { MetaLeadAdsWorkerModule } from './meta-lead-ads-worker.module';
