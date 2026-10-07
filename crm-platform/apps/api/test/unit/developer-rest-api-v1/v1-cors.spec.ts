import { describe, expect, it } from 'vitest';
import {
  CUSTOMER_API_CORS,
  isCustomerApiPath,
} from '../../../src/modules/developer-rest-api-v1/http/v1-cors';

describe('customer API CORS (WD-API-005)', () => {
  it('applies to the customer API and its spec only', () => {
    for (const p of ['/api/v1/me', '/api/v1/contacts?search=a', '/api/v1', '/docs/api.json']) {
      expect(isCustomerApiPath(p), p).toBe(true);
    }
    for (const p of [
      '/v2/contacts',
      '/public/v1/leads',
      '/api/v10/x',
      '/docs',
      '/docs/api',
      '/api/whatsapp-message-settings',
    ]) {
      expect(isCustomerApiPath(p), p).toBe(false);
    }
  });

  it('answers every origin and never with credentials', () => {
    expect(CUSTOMER_API_CORS.origin).toBe('*');
    expect(CUSTOMER_API_CORS.credentials).toBe(false);
  });
});
