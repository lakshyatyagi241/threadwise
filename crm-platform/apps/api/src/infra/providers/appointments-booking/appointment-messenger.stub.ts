import { Injectable, Logger } from '@nestjs/common';
import type {
  AppointmentMessenger,
  BookingMessage,
  BookingMessageResult,
} from './appointment-messenger.port';

/**
 * The messenger until a channel domain registers a real one: it delivers nothing and says so (`skipped`, so the outbox does not
 * retry). The finished message is logged at debug level without the body or the recipient, so a missing channel is visible in
 * development without writing a customer's phone number to a log.
 */
@Injectable()
export class NoAppointmentMessenger implements AppointmentMessenger {
  readonly name = 'none';
  private readonly logger = new Logger(NoAppointmentMessenger.name);

  async send(message: BookingMessage): Promise<BookingMessageResult> {
    this.logger.debug(
      { event: message.event, channel: message.channel, appointmentId: message.appointmentId },
      'booking message not delivered: no channel adapter is registered',
    );
    return { status: 'skipped', reason: 'no_channel_adapter' };
  }
}
