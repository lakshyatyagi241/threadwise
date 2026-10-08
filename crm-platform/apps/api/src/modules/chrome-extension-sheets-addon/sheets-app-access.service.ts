import { HttpStatus, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ERROR_CODES, EXT_SHEETS_APP_SLUG } from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';

export interface SheetsInstall {
  /** The scopes the installing admin consented to: the ceiling for what any key of the workspace may do. */
  grantedScopes: readonly string[];
}

/**
 * Whether the Google Sheets add-on is installed and switched on in a workspace. The Marketplace owns installations; this reads the one
 * row that answers the question, under the workspace's own transaction (RLS), and nothing else. An uninstall deletes the row, a disable or
 * a platform kill changes its status, so either way the add-on stops at the next call.
 */
@Injectable()
export class SheetsAppAccess {
  constructor(private readonly db: DatabaseService) {}

  /** The install, or null when there is none or it is not active. */
  async find(orgId: number): Promise<SheetsInstall | null> {
    return this.db.txAs({ orgId }, async (tx) => {
      const res = await tx.execute(sql`
        SELECT i.status, i.granted_scopes
        FROM workspace_app_installations i
        JOIN marketplace_apps a ON a.id = i.app_id
        WHERE i.org_id = ${orgId} AND a.slug = ${EXT_SHEETS_APP_SLUG}`);
      const row = res.rows[0] as { status: string; granted_scopes: string[] } | undefined;
      return row && row.status === 'active' ? { grantedScopes: row.granted_scopes ?? [] } : null;
    });
  }

  async require(orgId: number): Promise<SheetsInstall> {
    const install = await this.find(orgId);
    if (!install) {
      throw new AppError(
        ERROR_CODES.EXT_APP_NOT_INSTALLED,
        'The Google Sheets add-on is not installed in this workspace. Ask an admin to install it from the Marketplace.',
        HttpStatus.FORBIDDEN,
      );
    }
    return install;
  }
}
