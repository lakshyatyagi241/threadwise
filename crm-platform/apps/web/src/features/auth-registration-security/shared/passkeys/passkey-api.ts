import type {
  PasskeyItem,
  PasskeyListResponse,
  PasskeyRegisterRequest,
  WebauthnOptionsResponse,
} from '@crm/contracts';

/**
 * What the passkeys card needs from the API. Workspace staff and platform operators have the same four calls under
 * different prefixes (`/v2/account/passkeys`, `/v2/platform/auth/passkeys`), so the card takes the calls as a value.
 */
export interface PasskeyApi {
  list: () => Promise<PasskeyListResponse>;
  /** Registration options. `password` only after the API answered AUTH_REAUTH_REQUIRED. */
  options: (password?: string) => Promise<WebauthnOptionsResponse>;
  register: (body: PasskeyRegisterRequest) => Promise<PasskeyItem>;
  remove: (id: string, password: string) => Promise<void>;
}
