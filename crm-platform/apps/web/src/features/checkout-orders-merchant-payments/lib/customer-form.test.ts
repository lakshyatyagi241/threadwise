import { describe, expect, it } from 'vitest';
import {
  saveStoreCustomerSchema,
  updateStoreCustomerSchema,
  type StoreCustomer,
} from '@crm/contracts';
import {
  customerToForm,
  emptyCustomerForm,
  ordersHref,
  toSaveInput,
  toUpdateInput,
  validateCustomerForm,
} from './customer-form';

const customer: StoreCustomer = {
  id: '5b4d4a3c-2b8a-4f0e-9a52-0c3f6a8e1d11',
  phone: '919800000001',
  name: 'Asha Rao',
  company: null,
  address: '12 MG Road',
  hasProfile: true,
  hasSavedAddress: true,
  orderCount: 2,
  lifetimeTotals: [],
  lastOrderAt: null,
  contactId: null,
  rowVersion: 3,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
};

describe('validateCustomerForm', () => {
  it('needs a phone with at least one digit when adding', () => {
    expect(validateCustomerForm(emptyCustomerForm(), false).phone).toBe('phoneRequired');
    expect(validateCustomerForm({ ...emptyCustomerForm(), phone: 'abc' }, false).phone).toBe(
      'phoneInvalid',
    );
    expect(
      validateCustomerForm({ ...emptyCustomerForm(), phone: '+91 98000 00001' }, false),
    ).toEqual({});
    expect(
      validateCustomerForm({ ...emptyCustomerForm(), phone: '1'.repeat(33) }, false).phone,
    ).toBe('phoneInvalid');
  });
  it('does not check the phone when editing (it is the key and stays)', () => {
    expect(validateCustomerForm(emptyCustomerForm(), true)).toEqual({});
  });
});

describe('request bodies', () => {
  it('saves trimmed text and null for what is empty', () => {
    const body = toSaveInput({
      phone: ' +91 98000 00001 ',
      name: ' Asha ',
      company: '  ',
      address: '',
    });
    expect(body).toEqual({ phone: '+91 98000 00001', name: 'Asha', company: null, address: null });
    expect(saveStoreCustomerSchema.safeParse(body).success).toBe(true);
  });
  it('an edit sends no phone and carries the row version', () => {
    const body = toUpdateInput(customerToForm(customer), customer.rowVersion);
    expect(body).toEqual({ name: 'Asha Rao', company: null, address: '12 MG Road', rowVersion: 3 });
    expect(updateStoreCustomerSchema.safeParse(body).success).toBe(true);
  });
  it('editing a buyer known from orders only sends no row version (there is no profile to guard) and still validates', () => {
    const orderOnly: StoreCustomer = {
      ...customer,
      id: 'phone:919800000001',
      hasProfile: false,
      hasSavedAddress: false,
      address: null,
      rowVersion: 0,
    };
    const body = toUpdateInput(customerToForm(orderOnly), orderOnly.rowVersion);
    expect(body).toEqual({ name: 'Asha Rao', company: null, address: null });
    expect(updateStoreCustomerSchema.safeParse(body).success).toBe(true);
  });
});

describe('ordersHref', () => {
  it('filters the order list by the last 10 digits, which find the number however the order wrote it', () => {
    expect(ordersHref('+91 98000-00001')).toBe('/store/orders?q=9800000001');
    expect(ordersHref('9800000001')).toBe('/store/orders?q=9800000001');
    expect(ordersHref('12345')).toBe('/store/orders?q=12345');
  });
});
