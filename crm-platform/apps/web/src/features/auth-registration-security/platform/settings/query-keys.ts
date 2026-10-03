/** React Query keys of the operator settings screens that more than one component touches. */
export const REGISTRATION_KEY = ['operator', 'settings', 'registration'] as const;
export const OTP_SENDERS_KEY = ['operator', 'settings', 'senders'] as const;
export const BRANDING_FOOTER_KEY = ['operator', 'settings', 'branding-footer'] as const;
export const OTP_TEMPLATES_KEY = ['operator', 'settings', 'otp-templates'] as const;

/**
 * The template picker's list depends on the saved sender and on the saved template, so both are in the key:
 * saving a sender, or creating or refreshing the template, reads the list again by itself.
 */
export function otpTemplatesKey(otp: {
  sender: string | null;
  template: { metaTemplateId: string | null; name: string; status: string } | null;
}) {
  return [
    ...OTP_TEMPLATES_KEY,
    otp.sender ?? '',
    otp.template?.metaTemplateId ?? otp.template?.name ?? '',
    otp.template?.status ?? '',
  ] as const;
}
