import { Inject, Injectable } from '@nestjs/common';
import { RequestContextStore } from '../../../../common/context/request-context';
import { DatabaseService } from '../../../../infra/db/database.service';
import { SENDER_DIRECTORY, type SenderDirectory } from '../../../broadcasts';
import { senderKeyCandidates } from './bulk-input';

/**
 * The public `device_id` as the sender key the staff services take (WD-API-095). WaDesk's id was an integer or `cfg_<n>` in two tables;
 * ours is a uuid, either bare or as `<engine>:<uuid>`. Only a connected sender of this workspace resolves, through the same directory the
 * dashboard's pickers use, so another workspace's sender is never nameable.
 */
@Injectable()
export class V1SenderKeys {
  constructor(
    private readonly db: DatabaseService,
    @Inject(SENDER_DIRECTORY) private readonly senders: SenderDirectory,
  ) {}

  /** `<engine>:<uuid>` of the sender, or null when none was named or it is not a connected sender here. */
  async resolve(deviceId: string | null | undefined): Promise<string | null> {
    const candidates = senderKeyCandidates(deviceId);
    if (candidates.length === 0) return null;
    const { orgId } = RequestContextStore.require();
    const [hit] = await this.db.tx((tx) => this.senders.resolve(tx, orgId, candidates));
    return hit?.key ?? null;
  }
}
