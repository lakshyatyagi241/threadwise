'use client';

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
  const { toast } = useToast();
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
  if (!allowed) {
    return (
      <div className="fixed inset-0 z-40 grid place-items-center bg-background text-[13px] text-muted-foreground" role="alert">
        You do not have access to the flow builder.
      </div>
    );
  }
  return <BuilderScreen flowId={flowId} />;
}
