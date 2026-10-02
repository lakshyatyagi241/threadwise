import { HttpStatus } from '@nestjs/common';
import { ERROR_CODES } from '@crm/contracts';
import { AppError } from '../../../common/errors/app-error';

/** What an admin flagged on a lifecycle stage (status_options.is_won / is_lost). Never both. */
export interface StageFlags {
  isWon: boolean;
  isLost: boolean;
}

export const NO_STAGE_FLAGS: StageFlags = { isWon: false, isLost: false };

/** The part of a contact the stage move reads. */
export interface StageState {
  wonAt: Date | null;
  lostAt: Date | null;
  lostReason: string | null;
  otherLostReason: string | null;
}

const filled = (v: string | null | undefined): v is string =>
  typeof v === 'string' && v.trim() !== '';

/**
 * The columns a contact gets for entering `next`, given what that stage was flagged as.
 *
 * - won: `won_at` is stamped, `lost_at` and any lost reason are cleared (the contact came back from lost);
 * - lost: `lost_at` is stamped and a lost reason is required: a catalogue value (`lostReason`) or free text
 *   (`otherLostReason`), from the request or already on the contact (422 CON_LOST_REASON_REQUIRED otherwise);
 * - any other stage: both stamps are cleared, and so is a lost reason the contact only had because it was lost.
 *
 * A reason the caller sends explicitly always wins, so a lost reason can still be recorded on an unflagged stage
 * (the contract has always allowed it).
 */
export function stageEntryValues(args: {
  flags: StageFlags;
  current: StageState;
  lostReason?: string | null;
  otherLostReason?: string | null;
  now: Date;
}): Record<string, unknown> {
  const { flags, current, now } = args;
  const out: Record<string, unknown> = {};
  const lostReason = args.lostReason !== undefined ? args.lostReason : current.lostReason;
  const otherLostReason =
    args.otherLostReason !== undefined ? args.otherLostReason : current.otherLostReason;

  if (flags.isLost) {
    if (!filled(lostReason) && !filled(otherLostReason)) {
      throw new AppError(
        ERROR_CODES.CON_LOST_REASON_REQUIRED,
        'Choose a lost reason before moving the contact to a lost stage.',
        HttpStatus.UNPROCESSABLE_ENTITY,
        [{ path: 'lostReason', message: 'required' }],
      );
    }
    out.lostAt = now;
    out.wonAt = null;
    if (args.lostReason !== undefined) out.lostReason = args.lostReason;
    if (args.otherLostReason !== undefined) out.otherLostReason = args.otherLostReason;
    return out;
  }

  out.wonAt = flags.isWon ? now : null;
  out.lostAt = null;
  if (current.lostAt !== null) {
    // Leaving lost: the reason described that loss, not this stage.
    out.lostReason = args.lostReason !== undefined ? args.lostReason : null;
    out.otherLostReason = args.otherLostReason !== undefined ? args.otherLostReason : null;
  } else {
    if (args.lostReason !== undefined) out.lostReason = args.lostReason;
    if (args.otherLostReason !== undefined) out.otherLostReason = args.otherLostReason;
  }
  return out;
}
