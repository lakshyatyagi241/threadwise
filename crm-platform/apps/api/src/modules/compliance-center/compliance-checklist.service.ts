import { Injectable } from '@nestjs/common';
import type { ComplianceChecklist } from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { DatabaseService } from '../../infra/db/database.service';
import { ConsentSettingsService } from '../contact-consent';
import { buildChecklist, type ChecklistFacts } from './compliance-checklist.rules';
import { ComplianceRepository } from './compliance.repository';
import { ComplianceSettingsService } from './compliance-settings.service';

/**
 * The checklist (BL-174): reads what the workspace has actually set up (consent settings, notices, requests, recording retention,
 * officer contacts, the sub-processor list) and hands it to the pure rules. Read-only. The wording of the result is always "tools to help
 * you comply": it reports tools that are in place, never that a law is satisfied.
 */
@Injectable()
export class ComplianceChecklistService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: ComplianceRepository,
    private readonly consent: ConsentSettingsService,
  ) {}

  async build(): Promise<ComplianceChecklist> {
    const orgId = RequestContextStore.orgId();
    const consent = await this.consent.effective(orgId);
    const facts = await this.db.tx(async (tx): Promise<ChecklistFacts> => {
      const [row, notices, requests, recording, subs] = await Promise.all([
        this.repo.getSettings(tx, orgId),
        this.repo.noticeFacts(tx, orgId),
        this.repo.requestFacts(tx, orgId),
        this.repo.recordingFacts(tx, orgId),
        this.repo.listSubprocessors(tx, orgId),
      ]);
      const active = subs.filter((s) => s.status === 'active');
      return {
        settings: ComplianceSettingsService.valuesOf(row),
        consent: {
          detectionEnabled: consent.detectionEnabled,
          requireConsentForMarketing: consent.requireConsentForMarketing,
        },
        notices,
        requests,
        recording,
        subprocessors: {
          active: active.length,
          withLocation: active.filter((s) => s.location.trim() !== '').length,
        },
      };
    });
    return buildChecklist(facts, facts.settings.regimes);
  }
}
