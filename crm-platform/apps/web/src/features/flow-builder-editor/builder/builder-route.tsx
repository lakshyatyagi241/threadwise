'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useToast } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { FLASH_KEY } from '../components/flows-screen';
import { BuilderScreen } from './builder-screen';

/**
 * The builder route: refuses people without the read key, and shows the one-time flash the list left (import, clone,
 * duplicate) the way Reference's redirect flash message does.
 */
export function BuilderRoute({ flowId }: { flowId?: string }) {
  const allowed = useCan('flb.flows.read');
  const router = useRouter();
  const { toast } = useToast();
  // Reference sends an agent or viewer to the team inbox instead of leaving them on a dead end.
  useEffect(() => {
    if (!allowed) router.replace('/inbox');
  }, [allowed, router]);
  useEffect(() => {
    try {
      const m = sessionStorage.getItem(FLASH_KEY);
      if (m) {
        sessionStorage.removeItem(FLASH_KEY);
        toast(m, 'success');
      }
    } catch {
      /* no storage: nothing to show */
    }
  }, [toast]);
  if (!allowed) return null;
  return <BuilderScreen flowId={flowId} />;
}
