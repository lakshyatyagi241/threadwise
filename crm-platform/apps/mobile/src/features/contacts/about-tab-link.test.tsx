import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useRouter } from 'expo-router';
import { fetchSession } from '@/lib/session/api';
import {
  assignees,
  fieldDefinitions,
  profile,
  sessionProps,
  sessionPropsReadOnly,
} from '@/test/contact-properties-fixtures';
import { sessionFull } from '@/test/contacts-fixtures';
import { renderApp } from '@/test/render';
import { AboutTab } from './about-tab';
import * as api from './api';
import * as propertiesApi from './properties-api';

jest.mock('./api');
jest.mock('./properties-api');
jest.mock('@/lib/session/api');
jest.mock('expo-router', () => ({ useRouter: jest.fn() }));

const sessionCall = jest.mocked(fetchSession);
const router = { push: jest.fn() };

beforeEach(() => {
  for (const fake of [
    sessionCall,
    jest.mocked(api.getContact),
    jest.mocked(propertiesApi.listContactFields),
    jest.mocked(propertiesApi.listFieldSections),
    jest.mocked(propertiesApi.listAssignees),
  ]) {
    fake.mockReset();
  }
  router.push.mockReset();
  jest.mocked(useRouter).mockReturnValue(router as unknown as ReturnType<typeof useRouter>);
  sessionCall.mockResolvedValue(sessionProps);
  jest.mocked(propertiesApi.listContactFields).mockResolvedValue(fieldDefinitions);
  jest.mocked(propertiesApi.listFieldSections).mockResolvedValue([]);
  jest.mocked(propertiesApi.listAssignees).mockResolvedValue(assignees);
});

describe('the About tab link to every property', () => {
  it('opens the All sections screen of this contact', async () => {
    await renderApp(<AboutTab contact={profile} tags={[]} />);
    await fireEvent.press(await screen.findByRole('button', { name: 'View all properties' }));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/contact-properties',
      params: { id: profile.id },
    });
  });

  it('is left out for a person who may not read the properties', async () => {
    sessionCall.mockResolvedValue(sessionFull);
    await renderApp(<AboutTab contact={profile} tags={[]} />);
    await screen.findByText('You can customize the properties you see here from your web app.');
    await waitFor(() => expect(sessionCall).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'View all properties' })).toBeNull();
  });

  it('is there for a person who may only read, since the screen only shows values', async () => {
    sessionCall.mockResolvedValue(sessionPropsReadOnly);
    await renderApp(<AboutTab contact={profile} tags={[]} />);
    expect(await screen.findByRole('button', { name: 'View all properties' })).toBeTruthy();
  });
});
