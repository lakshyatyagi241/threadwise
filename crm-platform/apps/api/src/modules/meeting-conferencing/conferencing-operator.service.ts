import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  CONFERENCING_APP_SLUG,
  CONNECTED_VIDEO_PROVIDERS,
  type ConferencingGap,
  type ConferencingOperatorProvider,
  type ConferencingOperatorStatus,
  type ConnectedVideoProvider,
} from '@crm/contracts';
import { meetingConferencingEnv } from '../../config/domains/meeting-conferencing.env';
import { PlatformStore } from '../auth';
import {
  TeamsCredentialsSource,
  ZoomCredentialsSource,
  type InspectableCredentialsSource,
} from './conferencing-config.service';

/**
 * The operator's read-only checklist for the two video integrations: what is set, what the listing is, and the exact redirect address to
 * register at the provider. It reads the same sources the connect flow uses, so the checklist can never disagree with what a workspace sees:
 * a provider the checklist calls ready is one a person can connect. It never returns a value, only whether one is set.
 */
@Injectable()
export class ConferencingOperatorService {
  constructor(
    private readonly platform: PlatformStore,
    private readonly zoom: ZoomCredentialsSource,
    private readonly teams: TeamsCredentialsSource,
  ) {}

  private source(provider: ConnectedVideoProvider): InspectableCredentialsSource {
    return provider === 'zoom' ? this.zoom : this.teams;
  }

  async status(): Promise<ConferencingOperatorStatus> {
    const slugs = CONNECTED_VIDEO_PROVIDERS.map((p) => CONFERENCING_APP_SLUG[p]);
    const listings = await this.platform.tx(async (tx) => {
      const res = await tx.execute(sql`
        SELECT slug, status, current_version_id FROM marketplace_apps
         WHERE slug IN (${sql.join(
           slugs.map((s) => sql`${s}`),
           sql`, `,
         )})`);
      return new Map(
        (res.rows as Array<{ slug: string; status: string; current_version_id: unknown }>).map(
          (r) => [r.slug, { status: r.status, hasVersion: r.current_version_id !== null }],
        ),
      );
    });
    const providers: ConferencingOperatorProvider[] = [];
    for (const provider of CONNECTED_VIDEO_PROVIDERS) {
      const slug = CONFERENCING_APP_SLUG[provider];
      const creds = await this.source(provider).describe();
      const found = listings.get(slug);
      const published = found?.status === 'published' && found.hasVersion;
      const gaps: ConferencingGap[] = [];
      if (creds.switchedOff) gaps.push('switched_off');
      if (!creds.hasClientId) gaps.push('client_id');
      if (!creds.hasClientSecret) gaps.push('client_secret');
      if (!found) gaps.push('listing_missing');
      else if (!published) gaps.push('listing_not_published');
      providers.push({
        provider,
        slug,
        credentialsSource: creds.source,
        hasClientId: creds.hasClientId,
        hasClientSecret: creds.hasClientSecret,
        switchedOff: creds.switchedOff,
        redirectUri: creds.redirectUri,
        listing: { exists: !!found, status: found?.status ?? null, published },
        gaps,
        ready: gaps.length === 0,
      });
    }
    return { providers, fakeAdapters: meetingConferencingEnv().CONFERENCING_FAKE === '1' };
  }
}
