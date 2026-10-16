import type { Provider, Type } from '@nestjs/common';
import { MailAccess } from './mail-access.service';
import { MailSettingsController } from './mail-settings.controller';
import { MailSettingsRepository } from './mail-settings.repository';
import { MailSettingsService } from './mail-settings.service';
import { MailLimits } from './mail-limits';
import { GoogleOidcVerifier } from '../../infra/providers/channel-email';
import { MailAttachmentScanner } from './mail-attachment-scanner';
import { MailOutboundAttachmentsController } from './mail-outbound-attachments.controller';
import { MailOutboundAttachmentsRepository } from './mail-outbound-attachments.repository';
import { MailOutboundAttachmentsSweep } from './mail-outbound-attachments.sweep';
import { MailOutboundAttachments } from './mail-outbound-attachments.service';
import { MailSignaturesController } from './mail-signatures.controller';
import { MailSignaturesRepository } from './mail-signatures.repository';
import { MailSignaturesService } from './mail-signatures.service';
import { MailPushController } from './mail-push.controller';
import { MailPushRepository } from './mail-push.repository';
import { MailPushService } from './mail-push.service';
import { MailPushSweep } from './mail-push.sweep';
import { MailTimelineRepository } from './mail-timeline.repository';
import { MailTimeline } from './mail-timeline.service';

/**
 * Where the Phase 2 features plug into `ChannelEmailModule` / `ChannelEmailWorkerModule` without editing them: each feature appends to
 * its OWN block below (a blank line between blocks), so parallel builds never touch the same lines. Provider drivers and their clients
 * go in `drivers/driver-providers.ts` instead.
 */

/** HTTP controllers. */
export const MAIL_EXTRA_CONTROLLERS: Type<unknown>[] = [
  // TW-MAIL-035 personal mailboxes: the workspace settings controller
  MailSettingsController,
  // TW-MAIL-027 signatures and composer attachments: the signatures controller, the upload controller
  MailSignaturesController,
  MailOutboundAttachmentsController,
  // TW-MAIL-033 Gmail push: the public push controller (Pub/Sub) and the Graph notification controller of 034 if shared
  MailPushController,
];

/** Providers (services, repositories) available to the API and the worker. */
export const MAIL_EXTRA_PROVIDERS: Provider[] = [
  // TW-MAIL-035 personal mailboxes
  MailAccess,
  MailSettingsRepository,
  MailSettingsService,
  // TW-MAIL-027 signatures and composer attachments
  MailAttachmentScanner,
  MailSignaturesRepository,
  MailSignaturesService,
  MailOutboundAttachmentsRepository,
  MailOutboundAttachments,
  // TW-MAIL-032 rate limits and bounces
  MailLimits,
  // TW-MAIL-033 Gmail push
  GoogleOidcVerifier,
  MailPushRepository,
  MailPushService,
  // E-19 contact timeline
  MailTimelineRepository,
  MailTimeline,
];

/** What `ChannelEmailModule` exports (to the worker module and to other modules). */
export const MAIL_EXTRA_EXPORTS: Provider[] = [
  // append the classes the worker module needs
  MailPushService,
  MailPushRepository,
  // TW-MAIL-027 (the worker's sweep and the sending adapter use them)
  MailOutboundAttachments,
  MailSignaturesRepository,
];

/** Worker-only providers (sweeps and processors); `ChannelEmailWorkerModule` registers them. */
export const MAIL_WORKER_PROVIDERS: Provider[] = [
  // TW-MAIL-033 push renewal sweep
  MailPushSweep,
  // TW-MAIL-027 staged attachment cleanup sweep
  MailOutboundAttachmentsSweep,
];
