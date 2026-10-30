import { WFL_ERROR_CODES } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';

export interface WaFormNotice {
  tone: 'success' | 'danger';
  text: string;
  /** The form cannot publish until a direct WhatsApp Cloud API connection exists: the notice says so and links to the channels. */
  connect?: boolean;
}

/** The notice for a failed save, publish or test. A form with no usable direct WhatsApp connection gets the connect hint. */
export function failureNotice(err: unknown, text: string): WaFormNotice {
  return {
    tone: 'danger',
    text,
    connect:
      err instanceof ApiError &&
      (err.code === WFL_ERROR_CODES.WFL_FORM_NO_WABA_CREDENTIALS ||
        err.code === WFL_ERROR_CODES.WFL_FORM_PARTNER_NUMBER),
  };
}
