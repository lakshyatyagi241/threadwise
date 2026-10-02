import { mockEnabled } from './http';
import { mockAppointmentsApi, mockPublicApi } from './mock-service';
import { realAppointmentsApi, realPublicApi } from './real-service';

export type { AppointmentPageResult, AppointmentSource } from './real-service';

/**
 * Every call the screens make, one function each. Normally these are the real API's (`./real-service`, converted by `./wire`);
 * with the development switch on (`mockEnabled`, see `./http`) the same functions answer from the in-memory stand-in. The
 * choice is made at each call, so switching it needs no rebuild.
 */
function pick<T extends object>(real: T, mock: T): T {
  return new Proxy(real, {
    get: (_target, key) => (mockEnabled() ? mock : real)[key as keyof T],
  });
}

export const appointmentsApi = pick<typeof realAppointmentsApi>(
  realAppointmentsApi,
  mockAppointmentsApi as typeof realAppointmentsApi,
);
export const publicApi = pick<typeof realPublicApi>(
  realPublicApi,
  mockPublicApi as typeof realPublicApi,
);
