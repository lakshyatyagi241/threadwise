/** Public surface of the companies module (the service other modules call: the AI tools, flows, the public API). */
export { CompaniesService, COMPANY_MODULE } from './companies.service';
export { CompaniesRepository } from './companies.repository';
export { toCompanyResponse } from './companies.mapper';
export type { CompanyRow } from './companies.repository';
