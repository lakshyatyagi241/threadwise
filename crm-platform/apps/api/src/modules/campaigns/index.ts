/** Public surface of the campaigns domain. Other domains import only from here. */
export { CampaignsModule } from './campaigns.module';
export { CampaignsWorkerModule } from './campaigns-worker.module';
export { CampaignReceiptsService } from './campaign-receipts.service';
/** The seam the flow runtime binds into: flow campaigns start one run per recipient through it. */
export { CAMPAIGN_FLOW_STARTER, type CampaignFlowStarter } from './_shims/tokens';
export { NoFlowStarter } from './_shims/open-gates';
