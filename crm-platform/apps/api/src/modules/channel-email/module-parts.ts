import type { Provider, Type } from '@nestjs/common';

/**
 * Where the Phase 2 features plug into `ChannelEmailModule` / `ChannelEmailWorkerModule` without editing them: each feature appends to
 * its OWN block below (a blank line between blocks), so parallel builds never touch the same lines. Provider drivers and their clients
 * go in `drivers/driver-providers.ts` instead.
 */

/** HTTP controllers. */
export const MAIL_EXTRA_CONTROLLERS: Type<unknown>[] = [
  // TW-MAIL-035 personal mailboxes: the workspace settings controller
  // TW-MAIL-027 signatures and composer attachments: the signatures controller, the upload controller
  // TW-MAIL-033 Gmail push: the public push controller (Pub/Sub) and the Graph notification controller of 034 if shared
];

/** Providers (services, repositories) available to the API and the worker. */
export const MAIL_EXTRA_PROVIDERS: Provider[] = [
  // TW-MAIL-035 personal mailboxes
  // TW-MAIL-027 signatures and composer attachments
  // TW-MAIL-032 rate limits and bounces
  // TW-MAIL-033 Gmail push
];

/** What `ChannelEmailModule` exports (to the worker module and to other modules). */
export const MAIL_EXTRA_EXPORTS: Provider[] = [
  // append the classes the worker module needs
];

/** Worker-only providers (sweeps and processors); `ChannelEmailWorkerModule` registers them. */
export const MAIL_WORKER_PROVIDERS: Provider[] = [
  // TW-MAIL-033 push renewal sweep
  // TW-MAIL-027 staged attachment cleanup sweep
];
