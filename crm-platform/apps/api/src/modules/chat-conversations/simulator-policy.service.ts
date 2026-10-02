import { HttpStatus, Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@crm/contracts';
import { simulatorAllowed } from '../../config/domains/chat-conversations.env';
import { AppError } from '../../common/errors/app-error';

/**
 * Who may use the dev simulator. Evaluated on every call (not cached at boot) so the answer is always the environment's current one.
 * A simulator channel cannot be created, and its dev routes are not found, unless the flag is on and the environment is not
 * production. Refusing to boot a production process that sets the flag is the provider module's job; this is the second wall.
 */
@Injectable()
export class SimulatorPolicy {
  enabled(): boolean {
    return simulatorAllowed();
  }

  /** The 403 for creating a simulator channel while it is off. */
  assertCanCreate(): void {
    if (this.enabled()) return;
    throw new AppError(
      ERROR_CODES.CHANNEL_SIMULATOR_DISABLED,
      'The channel simulator is not enabled in this environment',
      HttpStatus.FORBIDDEN,
    );
  }

  /** The dev routes pretend not to exist while it is off. */
  assertRoutesVisible(): void {
    if (this.enabled()) return;
    throw AppError.notFound('Route');
  }
}
