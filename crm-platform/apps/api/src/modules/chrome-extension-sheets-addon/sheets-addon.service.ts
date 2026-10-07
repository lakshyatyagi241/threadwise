import { Injectable } from '@nestjs/common';
import { EXT_SHEETS_MAX_PULL, EXT_SHEETS_MAX_ROWS, type ExtSheetsHealth } from '@crm/contracts';
import { toHealthCan, type SheetsCallerState } from './sheets-access';

/** `GET /health`: proves the key works and says, in the add-on's own words, what it may do. */
@Injectable()
export class SheetsAddonService {
  health(caller: SheetsCallerState): ExtSheetsHealth {
    const { owner } = caller;
    return {
      ok: true,
      user: { id: owner.userUuid, name: owner.userName, email: owner.userEmail },
      workspace: { id: owner.orgUuid, name: owner.orgName },
      can: toHealthCan(caller.can),
      limits: { max_rows: EXT_SHEETS_MAX_ROWS, max_pull: EXT_SHEETS_MAX_PULL },
      api_version: 1,
      server_time: new Date().toISOString(),
    };
  }
}
