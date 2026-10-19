import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AuthFrame } from '@/features/auth/auth-frame';
import { Button } from '@/components/ui/button';
import { useGateSignOut } from './use-account-gate';

interface Props {
  /** The page's main line, in the brand band. */
  title: string;
  /** Cards: the first one overlaps the band. */
  children: ReactNode;
  /** Shows the Sign out button under the cards (every lock screen offers it: the person may be on the wrong account). */
  signOutDisabled?: boolean;
}

/** The frame of every lock screen: the brand band with the title, the cards, and a way out. */
export function GateFrame({ title, children, signOutDisabled }: Props) {
  const { t } = useTranslation();
  const out = useGateSignOut();
  return (
    <AuthFrame tagline={title} compact>
      {children}
      <Button
        variant="link"
        label={t('gates.signOut')}
        loading={out.pending}
        disabled={signOutDisabled}
        onPress={() => void out.signOut()}
      />
    </AuthFrame>
  );
}
