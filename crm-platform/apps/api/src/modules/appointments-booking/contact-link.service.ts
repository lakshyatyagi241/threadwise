import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { canonicalizePhone, ERROR_CODES } from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { ContactsService } from '../crm';
import { AppointmentsRepository } from './appointments.repository';

export interface InviteeFacts {
  name: string | null;
  email: string | null;
  phone: string | null;
}

/** The phone in E.164, or 422 when it cannot be read as one. */
export function normalizePhone(
  raw: string | null | undefined,
  path = 'invitee.phone',
): string | null {
  if (!raw || raw.trim() === '') return null;
  const c = canonicalizePhone({ number: raw });
  if (!c) {
    throw AppError.validation('That phone number cannot be read. Include the country code.', [
      { path, message: 'invalid_phone' },
    ]);
  }
  return c.e164;
}

export const normalizeEmail = (raw: string | null | undefined): string | null =>
  raw && raw.trim() !== '' ? raw.trim().toLowerCase() : null;

/**
 * Links a booking to a contact (TW-APPT-033, EXT-APPT-02): find-or-create by phone and email through the contacts service, whose
 * create is identity-first (a phone or email that already belongs to a contact IS that contact). It runs BEFORE the booking
 * transaction (the contacts service opens its own), so a booking that then fails leaves a contact behind: a lead who tried to book is a
 * lead, and Reference's chat already had one.
 *
 * A contact cap (plan limit) never blocks a booking: the invitee's details live on the appointment, so the booking goes ahead
 * without a contact link.
 */
@Injectable()
export class ContactLinkService {
  private readonly logger = new Logger(ContactLinkService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly contacts: ContactsService,
    private readonly appts: AppointmentsRepository,
  ) {}

  /** The internal id of the contact for this invitee, creating it when needed; null when none can be made. */
  async resolve(invitee: InviteeFacts, hostUuid: string | null): Promise<number | null> {
    if (!invitee.email && !invitee.phone) return null;
    try {
      const make = (ownerId: string | undefined) =>
        this.contacts.create({
          name: invitee.name ?? undefined,
          email: invitee.email ?? undefined,
          phone: invitee.phone ?? undefined,
          ownerId,
          source: 'appointment',
          customFields: {},
        });
      let created;
      try {
        created = await make(hostUuid ?? undefined);
      } catch (err) {
        // AZ-007: a caller whose record scope does not reach the host (own scope, or a host outside their teams) may not
        // hand a contact to them. The booking still goes ahead; the contact is then owned by the caller, as for any create.
        if (!(hostUuid && err instanceof AppError && err.getStatus() === HttpStatus.FORBIDDEN)) {
          throw err;
        }
        created = await make(undefined);
      }
      return await this.idOf(created.id);
    } catch (err) {
      if (err instanceof AppError && err.code === ERROR_CODES.PLAN_LIMIT_REACHED) {
        this.logger.warn('contact cap reached: booking without a contact link');
        return null;
      }
      // A contact that cannot be made (a validation edge) must not lose the booking either.
      if (err instanceof AppError && err.getStatus() === HttpStatus.UNPROCESSABLE_ENTITY) {
        this.logger.warn(
          { code: err.code },
          'contact could not be created: booking without a contact link',
        );
        return null;
      }
      throw err;
    }
  }

  private async idOf(uuid: string): Promise<number | null> {
    const orgId = RequestContextStore.require().orgId;
    return this.db.tx(
      async (tx) => (await this.appts.resolveContactIdByUuid(tx, orgId, uuid)) ?? null,
    );
  }
}
