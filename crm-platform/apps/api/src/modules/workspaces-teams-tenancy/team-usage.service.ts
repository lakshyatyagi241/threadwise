import { Injectable } from '@nestjs/common';
import type { WspTeamDeletePreview } from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { TeamUsageRepository } from './team-usage.repository';
import { TeamsRepository } from './teams.repository';

/** The "what will change" preview of the delete-team confirmation (BL-380, gap 14). */
@Injectable()
export class TeamUsageService {
  constructor(
    private readonly db: DatabaseService,
    private readonly teams: TeamsRepository,
    private readonly usage: TeamUsageRepository,
  ) {}

  async forTeam(uuid: string): Promise<WspTeamDeletePreview> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const team = await this.teams.byUuid(tx, ctx.orgId, uuid);
      if (!team) throw AppError.notFound('Team', uuid);
      return this.usage.usage(tx, ctx.orgId, { id: team.id, uuid: team.uuid });
    });
  }
}
