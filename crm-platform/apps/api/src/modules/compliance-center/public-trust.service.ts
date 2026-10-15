import { HttpStatus, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ERROR_CODES, type PublicTrustPage } from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { ComplianceRepository } from './compliance.repository';

const missing = (): AppError =>
  new AppError(
    ERROR_CODES.COMPLIANCE_TRUST_PAGE_NOT_FOUND,
    'There is no public sub-processor page for this workspace.',
    HttpStatus.NOT_FOUND,
  );

/**
 * The optional public page of a workspace's sub-processors, `/trust/<workspace slug>` (BL-173). No login. It exists only when the
 * workspace switched it on, and shows nothing but the active vendors, the privacy and terms links and the name and address of the
 * privacy contact that the workspace chose to fill in. A missing, inactive or switched-off workspace answers the same 404.
 */
@Injectable()
export class PublicTrustService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: ComplianceRepository,
  ) {}

  async page(slug: string): Promise<PublicTrustPage> {
    if (!/^[A-Za-z0-9_-]{1,120}$/.test(slug)) throw missing();
    const org = await this.db.privileged(async (tx) => {
      const res = await tx.execute(
        sql`SELECT id, name FROM organizations WHERE slug = ${slug} AND status = 'active'`,
      );
      return res.rows[0] as { id: number | string; name: string } | undefined;
    });
    if (!org) throw missing();
    const orgId = Number(org.id);
    return this.db.txAs({ orgId, userId: null }, async (tx) => {
      const row = await this.repo.getSettings(tx, orgId);
      if (!row?.values.subprocessorsPublic) throw missing();
      const subs = (await this.repo.listSubprocessors(tx, orgId)).filter(
        (s) => s.status === 'active',
      );
      return {
        workspaceName: org.name,
        privacyUrl: row.values.privacyUrl,
        termsUrl: row.values.termsUrl,
        dpoName: row.values.dpo.name,
        dpoEmail: row.values.dpo.email,
        subprocessors: subs.map((s) => ({
          name: s.name,
          purpose: s.purpose,
          dataCategories: s.dataCategories,
          location: s.location,
          websiteUrl: s.websiteUrl,
        })),
      };
    });
  }
}
