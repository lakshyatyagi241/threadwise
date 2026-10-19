import {
  bookingPageSettingsResponseSchema,
  type BookingPageAssetSlot,
  type BookingPageSettingsResponse,
  type UpdateBookingPageThemeInput,
  type UpdateBookingTypePageThemeInput,
} from '@crm/contracts';
import { toApiError } from '@/lib/api/errors';
import { call } from './http';

/**
 * The booking page appearance calls (BL-355..BL-358): the workspace theme and one service's override. Always the real API, with no
 * stand-in for the development switch: a fake answer here would show a theme that no customer will ever see.
 *
 * A scope is the workspace (`null`) or a booking type (its uuid). Both answer with the same view: what is saved, what a visitor sees,
 * what an empty field inherits, and the row version the next save must carry.
 */
export type ThemeScope = string | null;

const base = (scope: ThemeScope) =>
  scope === null ? '/booking-page/theme' : `/booking-types/${encodeURIComponent(scope)}/page-theme`;

export const pageThemeApi = {
  get(scope: ThemeScope, signal?: AbortSignal): Promise<BookingPageSettingsResponse> {
    return call(base(scope), { schema: bookingPageSettingsResponseSchema, signal });
  },
  saveWorkspace(input: UpdateBookingPageThemeInput): Promise<BookingPageSettingsResponse> {
    return call(base(null), {
      method: 'PUT',
      body: input,
      schema: bookingPageSettingsResponseSchema,
    });
  },
  saveType(
    typeId: string,
    input: UpdateBookingTypePageThemeInput,
  ): Promise<BookingPageSettingsResponse> {
    return call(base(typeId), {
      method: 'PUT',
      body: input,
      schema: bookingPageSettingsResponseSchema,
    });
  },
  /** Back to the workspace look: the service's override and its pictures are deleted. */
  reset(typeId: string): Promise<BookingPageSettingsResponse> {
    return call(base(typeId), { method: 'DELETE', schema: bookingPageSettingsResponseSchema });
  },
  removeAsset(scope: ThemeScope, slot: BookingPageAssetSlot): Promise<BookingPageSettingsResponse> {
    return call(`${base(scope)}/assets/${slot}`, {
      method: 'DELETE',
      schema: bookingPageSettingsResponseSchema,
    });
  },
  /** `apiFetch` only speaks JSON, so the multipart upload follows its conventions by hand (as the branding upload does). */
  async putAsset(
    scope: ThemeScope,
    slot: BookingPageAssetSlot,
    file: File,
  ): Promise<BookingPageSettingsResponse> {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`/api/v2${base(scope)}/assets/${slot}`, {
      method: 'PUT',
      body: form,
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'X-Request-Id': crypto.randomUUID(),
        'Idempotency-Key': crypto.randomUUID(),
      },
    });
    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    if (!res.ok) {
      throw toApiError(
        res.status,
        json,
        res.headers.get('x-request-id'),
        res.headers.get('retry-after'),
      );
    }
    return bookingPageSettingsResponseSchema.parse(json);
  },
};
