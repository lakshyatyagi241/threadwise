import type {
  SaveStoreCustomerInput,
  StoreCustomer,
  UpdateStoreCustomerInput,
} from '@crm/contracts';
import { digits } from './format';

/** The saved-customer form: the phone is the key (WaDesk saves by phone), the rest is a name, a company and a delivery address. */

export interface CustomerForm {
  phone: string;
  name: string;
  company: string;
  address: string;
}

export type CustomerProblem = 'phoneRequired' | 'phoneInvalid';
export type CustomerProblems = Partial<Record<keyof CustomerForm, CustomerProblem>>;

export const emptyCustomerForm = (): CustomerForm => ({
  phone: '',
  name: '',
  company: '',
  address: '',
});

export function customerToForm(c: StoreCustomer): CustomerForm {
  return {
    phone: c.phone,
    name: c.name ?? '',
    company: c.company ?? '',
    address: c.address ?? '',
  };
}

/** A phone needs at least one digit (the server keeps only the digits and refuses an empty result). Editing keeps the saved phone. */
export function validateCustomerForm(f: CustomerForm, editing: boolean): CustomerProblems {
  if (editing) return {};
  const p: CustomerProblems = {};
  if (!f.phone.trim()) p.phone = 'phoneRequired';
  else if (digits(f.phone).length === 0 || f.phone.trim().length > 32) p.phone = 'phoneInvalid';
  return p;
}

const orNull = (s: string): string | null => (s.trim() ? s.trim() : null);

/** Creating (or saving over the same phone): the whole form. */
export function toSaveInput(f: CustomerForm): SaveStoreCustomerInput {
  return {
    phone: f.phone.trim(),
    name: orNull(f.name),
    company: orNull(f.company),
    address: orNull(f.address),
  };
}

/** Editing one customer: the phone stays, the rest is replaced; `rowVersion` guards against a parallel edit. */
export function toUpdateInput(f: CustomerForm, rowVersion: number): UpdateStoreCustomerInput {
  return {
    name: orNull(f.name),
    company: orNull(f.company),
    address: orNull(f.address),
    rowVersion,
  };
}

/** The customer's order list, filtered by the digits of the phone (orders are matched to customers by those digits). */
export function ordersHref(phone: string): string {
  return `/store/orders?q=${encodeURIComponent(digits(phone))}`;
}
