import { Module } from '@nestjs/common';
import {
  GOOGLE_ACCESS_TOKENS,
  GOOGLE_WORKSPACE,
  type GoogleAccessTokens,
} from '../../infra/providers/flow-runtime-engine/google-workspace.port';
import { HttpGoogleWorkspace } from '../../infra/providers/flow-runtime-engine/google-workspace.http.adapter';
import { AppointmentsBookingModule } from '../appointments-booking';
import { GoogleAccountController } from './google-account.controller';
import { GoogleConsentController } from './google-consent.controller';
import { GoogleFilesService } from './google-files.service';
import { WorkspaceGoogleAccessTokens } from './workspace-google-tokens.service';

/**
 * The workspace's Google account (TW-GACC): the page's API, and the real bindings for the flow nodes' Google port. It owns no table: the
 * grant is the appointments module's sealed connection, which this module reaches only through that module's barrel.
 *
 * Provides `GOOGLE_ACCESS_TOKENS` (the workspace's token for a capability) and `GOOGLE_WORKSPACE` (Sheets, Docs, Forms, Meet and the file
 * pickers over it), replacing the "no account" stub the flow nodes were bound to.
 */
@Module({
  imports: [AppointmentsBookingModule],
  controllers: [GoogleAccountController, GoogleConsentController],
  providers: [
    WorkspaceGoogleAccessTokens,
    GoogleFilesService,
    { provide: GOOGLE_ACCESS_TOKENS, useExisting: WorkspaceGoogleAccessTokens },
    {
      provide: GOOGLE_WORKSPACE,
      useFactory: (tokens: GoogleAccessTokens) => new HttpGoogleWorkspace(tokens),
      inject: [GOOGLE_ACCESS_TOKENS],
    },
  ],
  exports: [GOOGLE_ACCESS_TOKENS, GOOGLE_WORKSPACE, GoogleFilesService],
})
export class GoogleAccountModule {}
