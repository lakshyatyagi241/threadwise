import type { ContactResponse } from '@crm/contracts';
import { renderHook } from '@testing-library/react-native';
import { useContactActions } from './use-contact-actions';

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/lib/session/use-session', () => ({
  useSession: () => ({ data: null }),
  can: () => true,
}));
jest.mock('./chat-api');

const contact = { id: 'c1', phone: '+919876543210', email: 'a@b.test' } as ContactResponse;

describe('useContactActions', () => {
  it('draws chat as the green WhatsApp mark and the others in the app accent', async () => {
    const { result } = await renderHook(() => useContactActions(contact, jest.fn()));
    const chat = result.current.find((a) => a.key === 'chat');
    expect(chat).toMatchObject({ icon: 'logo-whatsapp', color: 'whatsapp' });
    for (const a of result.current.filter((a) => a.key !== 'chat')) {
      expect(a.color).toBeUndefined();
    }
  });
});
