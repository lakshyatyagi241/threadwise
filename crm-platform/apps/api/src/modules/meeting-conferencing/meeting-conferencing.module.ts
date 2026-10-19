import { Global, Module } from '@nestjs/common';
import { CryptoService } from '../../common/crypto/crypto.service';
import { meetingConferencingEnv } from '../../config/domains/meeting-conferencing.env';
import {
  FakeVideoProvider,
  TeamsAdapter,
  VIDEO_PROVIDER_ADAPTERS,
  ZoomAdapter,
  type VideoProviderAdapters,
} from '../../infra/providers/meeting-conferencing';
import { AppointmentsBookingModule } from '../appointments-booking';
import { CrmModule, MEETING_CONFERENCING } from '../crm';
import { PlatformSettingsModule } from '../platform-settings-branding-storage';
import { ConferencingCallbackController } from './conferencing-callback.controller';
import { ConferencingConnectionRepository } from './conferencing-connection.repository';
import { ConferencingConnectService } from './conferencing-connect.service';
import { TeamsCredentialsSource, ZoomCredentialsSource } from './conferencing-config.service';
import { ConferencingTokens } from './conferencing-tokens.service';
import { MeetingConferencingController } from './meeting-conferencing.controller';
import { MeetingConferencingService } from './meeting-conferencing.service';

/**
 * Video conferencing and calendar entries for a contact's meetings (BL-360..BL-362): Zoom and Microsoft Teams are Marketplace integrations
 * the workspace installs, each person connects their own account, and only then does the Add meeting form offer them; Google Meet and
 * Teams-through-Outlook ride on the workspace's connected calendar (the appointments' own connection, tokens and refresh, no second OAuth).
 *
 *   /v2/conferencing/*                          capabilities, a person's connections, connect / confirm / disconnect (`record.contacts.update`)
 *   /v2/contacts/:contactId/meetings/:id/conferencing/retry
 *   /v2/public/conferencing/:provider/callback  the provider's redirect (no session; the signed state authenticates)
 *
 * Global because the crm module owns the meeting and cannot depend on this one (this one depends on the appointments calendar, which depends
 * on crm): crm declares the `MEETING_CONFERENCING` port, this module binds it, and a build without this module saves meetings exactly as before.
 * The real Zoom and Teams adapters are bound unless `CONFERENCING_FAKE=1`, which binds the in-memory fake (a development stack with no accounts).
 */
@Global()
@Module({
  imports: [AppointmentsBookingModule, CrmModule, PlatformSettingsModule],
  controllers: [MeetingConferencingController, ConferencingCallbackController],
  providers: [
    CryptoService,
    ZoomCredentialsSource,
    TeamsCredentialsSource,
    {
      provide: VIDEO_PROVIDER_ADAPTERS,
      inject: [ZoomCredentialsSource, TeamsCredentialsSource],
      useFactory: (
        zoom: ZoomCredentialsSource,
        teams: TeamsCredentialsSource,
      ): VideoProviderAdapters =>
        meetingConferencingEnv().CONFERENCING_FAKE === '1'
          ? { zoom: new FakeVideoProvider('zoom'), teams: new FakeVideoProvider('teams') }
          : { zoom: new ZoomAdapter(zoom), teams: new TeamsAdapter(teams) },
    },
    ConferencingConnectionRepository,
    ConferencingTokens,
    ConferencingConnectService,
    MeetingConferencingService,
    { provide: MEETING_CONFERENCING, useExisting: MeetingConferencingService },
  ],
  exports: [MEETING_CONFERENCING, MeetingConferencingService],
})
export class MeetingConferencingModule {}
