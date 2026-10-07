/** Public surface of the customer REST API domain. Other domains import only from here. */
export { DeveloperRestApiV1Module } from './developer-rest-api-v1.module';
export { ApiKeysService } from './keys/api-keys.service';
export { ApiV1DocsService } from './docs/api-v1-docs.service';
export { CUSTOMER_API_CORS, isCustomerApiPath } from './http/v1-cors';
