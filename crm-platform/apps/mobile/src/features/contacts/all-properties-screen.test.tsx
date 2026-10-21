import type { FieldSectionResponse } from '@crm/contracts';
import type { QueryClient } from '@tanstack/react-query';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { fetchSession } from '@/lib/session/api';
import {
  assignees,
  field,
  profile,
  sessionProps,
  sessionPropsReadOnly,
  statusOptions,
} from '@/test/contact-properties-fixtures';
import { renderApp } from '@/test/render';
import * as api from './api';
import { AllPropertiesScreen } from './all-properties-screen';
import * as propertiesApi from './properties-api';

jest.mock('./api');
jest.mock('./properties-api');
jest.mock('@/lib/session/api');
jest.mock('expo-router', () => ({ useRouter: jest.fn(), useLocalSearchParams: jest.fn() }));

const sessionCall = jest.mocked(fetchSession);
const getCall = jest.mocked(api.getContact);
const fieldsCall = jest.mocked(propertiesApi.listContactFields);
const sectionsCall = jest.mocked(propertiesApi.listFieldSections);
const assigneesCall = jest.mocked(propertiesApi.listAssignees);
const statusCall = jest.mocked(propertiesApi.listContactStatusOptions);
const router = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn() };

const STAMP = '2026-09-01T08:00:00.000Z';
const section = (id: string, name: string, position: number): FieldSectionResponse => ({
  id,
  moduleKey: 'contacts',
  name,
  position,
  isActive: true,
  rowVersion: 1,
  createdAt: STAMP,
  updatedAt: STAMP,
});
const CONTACT_INFO = '41111111-1111-4111-8111-111111111111';
const SOCIAL = '42222222-2222-4222-8222-222222222222';

// A workspace like ISKM's: standard properties that are really columns of the contact, and a section with nothing filled in.
const emailField = field({
  key: 'email',
  label: 'Email address',
  fieldType: 'email',
  isSystem: true,
  sectionId: CONTACT_INFO,
});
const mobileField = field({
  key: 'mobile_phone_number',
  label: 'Mobile Phone Number',
  fieldType: 'phone',
  isSystem: true,
  sectionId: CONTACT_INFO,
});
const stageField = field({
  key: 'lifecycle_stage',
  label: 'Lifecycle Stage',
  fieldType: 'select',
  isSystem: true,
  sectionId: CONTACT_INFO,
});
const smsField = field({
  key: 'sms_subscription_status',
  label: 'SMS Subscription Status',
  fieldType: 'radio',
  isSystem: true,
  sectionId: CONTACT_INFO,
});
const cityField = field({ key: 'city', label: 'City', fieldType: 'text', sectionId: CONTACT_INFO });
const facebookField = field({
  key: 'facebook_profile',
  label: 'Facebook Profile',
  fieldType: 'text',
  sectionId: SOCIAL,
});

let client: QueryClient | undefined;
async function show() {
  const view = await renderApp(<AllPropertiesScreen />);
  client = view.queryClient;
  return view;
}
const settled = (queryClient: QueryClient) =>
  waitFor(() => expect(queryClient.isFetching()).toBe(0));

beforeEach(() => {
  for (const fake of [sessionCall, getCall, fieldsCall, sectionsCall, assigneesCall, statusCall]) {
    fake.mockReset();
  }
  client = undefined;
  jest.mocked(useRouter).mockReturnValue(router as unknown as ReturnType<typeof useRouter>);
  jest.mocked(useLocalSearchParams).mockReturnValue({ id: profile.id });
  router.canGoBack.mockReturnValue(true);
  sessionCall.mockResolvedValue(sessionProps);
  getCall.mockResolvedValue({
    ...profile,
    email: 'aarav@example.test',
    phone: '+919812345678',
    lifecycleStage: 'qualified',
    smsSubscriptionStatus: 'subscribed',
    customFields: { city: 'Pune' },
  });
  fieldsCall.mockResolvedValue([
    emailField,
    mobileField,
    stageField,
    smsField,
    cityField,
    facebookField,
  ]);
  sectionsCall.mockResolvedValue([
    section(CONTACT_INFO, 'Contact Information', 1),
    section(SOCIAL, 'Social Media Information', 2),
  ]);
  assigneesCall.mockResolvedValue(assignees);
  statusCall.mockResolvedValue(statusOptions);
});
afterEach(async () => {
  if (client) {
    const cache = client;
    await settled(cache);
  }
});

describe('AllPropertiesScreen', () => {
  it("lists the workspace's sections, the first open and the rest folded", async () => {
    await show();
    expect(await screen.findByRole('header', { name: 'All sections' })).toBeTruthy();
    const first = await screen.findByRole('button', { name: 'Contact Information' });
    expect(first.props.accessibilityState.expanded).toBe(true);
    const second = screen.getByRole('button', { name: 'Social Media Information' });
    expect(second.props.accessibilityState.expanded).toBe(false);
    expect(screen.queryByText('Facebook Profile')).toBeNull();
    await fireEvent.press(second);
    expect(await screen.findByText('Facebook Profile')).toBeTruthy();
    // Empty properties are listed too, as dashes.
    expect(screen.getByLabelText('Facebook Profile: --')).toBeTruthy();
    await fireEvent.press(first);
    expect(screen.queryByText('City')).toBeNull();
  });

  it('shows a standard property with what the contact holds in its own column', async () => {
    await show();
    expect(await screen.findByLabelText('Email address: aarav@example.test')).toBeTruthy();
    expect(screen.getByLabelText('Mobile Phone Number: +919812345678')).toBeTruthy();
    // The stage by the workspace's name for it, the subscription by its words, a custom property by its value.
    expect(screen.getByLabelText('Lifecycle Stage: Qualified')).toBeTruthy();
    expect(screen.getByLabelText('SMS Subscription Status: Subscribed')).toBeTruthy();
    expect(screen.getByLabelText('City: Pune')).toBeTruthy();
  });

  it('says why a standard property cannot be changed here, and offers a pencil on a custom one', async () => {
    await show();
    await fireEvent.press(await screen.findByLabelText('Email address: aarav@example.test'));
    expect(await screen.findByText("You can't edit Email address")).toBeTruthy();
    expect(screen.getByLabelText('City: Pune').props.accessibilityHint).toBeTruthy();
  });

  it('has no pencils for a person who may only read', async () => {
    sessionCall.mockResolvedValue(sessionPropsReadOnly);
    await show();
    const city = await screen.findByLabelText('City: Pune');
    expect(city.props.accessibilityRole).not.toBe('button');
  });

  it('says there is nothing to show when the workspace has no properties', async () => {
    fieldsCall.mockResolvedValue([]);
    sectionsCall.mockResolvedValue([]);
    getCall.mockResolvedValue({ ...profile, customFields: {} });
    await show();
    expect(await screen.findByText('No properties to show.')).toBeTruthy();
  });

  it('goes back to the contact', async () => {
    await show();
    await fireEvent.press(await screen.findByRole('button', { name: 'Back' }));
    expect(router.back).toHaveBeenCalled();
  });
});
