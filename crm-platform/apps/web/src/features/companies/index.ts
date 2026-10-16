/** Public surface of the companies domain. Other domains import from here, never from the folders below. */
export { CompaniesScreen } from './components/companies-screen';
export { CompanyDetail } from './components/company-detail';
export { CompanyLink, type CompanyLinkProps } from './components/company-link';
export { CompaniesProviders } from './components/providers';
export {
  CompanyPicker,
  useCanPickCompany,
  type CompanyPickerProps,
} from './components/company-picker';
export type { CompanyRef } from './lib/picker';
