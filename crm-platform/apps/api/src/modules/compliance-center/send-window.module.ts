import { Module } from '@nestjs/common';
import { ComplianceRepository } from './compliance.repository';
import { SendWindowService } from './send-window.service';

/**
 * The quiet hours and calling window decision (BL-177), on its own so the dispatchers can import it without pulling in the Compliance
 * center's screens: the broadcast, campaign and scheduled-message workers, the chat dispatcher and the dialler. The database is global.
 */
@Module({
  providers: [ComplianceRepository, SendWindowService],
  exports: [SendWindowService],
})
export class SendWindowModule {}
