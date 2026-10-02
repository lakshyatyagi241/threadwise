import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppointmentResponse } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { CryptoService } from '../../common/crypto/crypto.service';
import type { Env } from '../../config/env.schema';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { APPOINTMENT_MODULE } from './appointment-rules';
import { appointmentEventPayload, toAppointmentResponse } from './appointments-booking.mapper';
import { AppointmentsRepository, type AppointmentRow } from './appointments.repository';

export interface RecordOptions {
  /** Audit action; omit for none (the sweeps write their own rows). */
  audit?: {
    action: 'insert' | 'update' | 'delete';
    delta?: Record<string, { old: unknown; new: unknown }>;
  };
  /** Outbox event type (`appointment.booked`) and extra payload keys. */
  event?: { type: string; extra?: Record<string, unknown> };
  /** For a caller with no request context (a sweep). */
  orgId?: number;
}

/**
 * Shared helpers of the appointments services: reading a row into its wire shape (decrypting what is encrypted at rest) and the one
 * place a change writes its audit row and outbox event, in the caller's transaction.
 */
@Injectable()
export class AppointmentsSupport {
  private readonly logger = new Logger(AppointmentsSupport.name);
  readonly webUrl: string;

  constructor(
    readonly repo: AppointmentsRepository,
    readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    config: ConfigService<Env, true>,
  ) {
    this.webUrl = config.get('WEB_APP_URL', { infer: true }).replace(/\/$/, '');
  }

  encrypt(value: string | null | undefined): string | null {
    return value ? this.crypto.encrypt(value) : null;
  }

  /** A value written under a key this process no longer has must not take a whole list down. */
  decrypt(cipher: string | null, what: string): string | null {
    if (cipher === null) return null;
    try {
      return this.crypto.decrypt(cipher);
    } catch (err) {
      this.logger.warn({ err, what }, 'could not decrypt appointment field');
      return null;
    }
  }

  manageUrlFor(token: string): string {
    return `${this.webUrl}/b/manage/${token}`;
  }

  manageUrlOf(row: AppointmentRow): string | null {
    const token = this.decrypt(row.manageTokenCipher, 'manage_token');
    return token ? this.manageUrlFor(token) : null;
  }

  toResponse(row: AppointmentRow): AppointmentResponse {
    return toAppointmentResponse(row, {
      notes: this.decrypt(row.notesCipher, 'notes'),
      manageUrl: this.manageUrlOf(row),
    });
  }

  /**
   * One change: its audit row and its outbox event, in the caller's transaction (both commit or neither). `row` is the appointment
   * AFTER the change. Nothing here carries the notes or the manage link: the audit delta and the event payload hold identifiers
   * and what a consumer decides on.
   */
  async record(tx: Tx, row: AppointmentRow, opts: RecordOptions): Promise<void> {
    const orgId = opts.orgId ?? RequestContextStore.require().orgId;
    if (opts.audit) {
      await this.audit.record(tx, {
        module: APPOINTMENT_MODULE,
        recordId: row.id,
        action: opts.audit.action,
        delta: opts.audit.delta,
      });
    }
    if (opts.event) {
      await this.outbox.emit(tx, {
        orgId,
        aggregateModule: APPOINTMENT_MODULE,
        aggregateId: row.id,
        eventType: opts.event.type,
        payload: { ...appointmentEventPayload(row), ...opts.event.extra },
      });
    }
  }
}
