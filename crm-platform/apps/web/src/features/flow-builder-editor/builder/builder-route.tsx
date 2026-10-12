'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useToast } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { flowsApi } from '../api/flows';
import { FLB_KEYS } from '../api/hooks';
import { FLASH_KEY } from '../components/flows-screen';
import { newHref } from '../lib/builder-mode';
import { BuilderScreen } from './builder-screen';

/**
 * The builder route: refuses people without the read key, and shows the one-time flash the list left (import, clone,
 * duplicate) the way Reference's redirect flash message does. When the platform admin offers only the Simple builder, a messaging
 * flow is sent there instead (a call flow, and "Generate with AI", have no Simple version and stay on the canvas).
 */
export function BuilderRoute({ flowId }: { flowId?: string }) {
  const allowed = useCan('flb.flows.read');
  const router = useRouter();
  const params = useSearchParams();
  const { toast } = useToast();
  const overview = useQuery({
    queryKey: FLB_KEYS.overview,
    queryFn: ({ signal }) => flowsApi.overview(signal),
  });
  const toSimple =
    overview.data?.builderMode === 'simple' &&
    params.get('type') !== 'call' &&
    !params.has('ai_prompt');
  // Reference sends an agent or viewer to the team inbox instead of leaving them on a dead end.
  useEffect(() => {
    if (!allowed) router.replace('/inbox');
    else if (toSimple)
      router.replace(
        flowId
          ? `/flows/simple/${flowId}`
          : newHref('simple', params.get('type') === 'web' ? 'web' : 'chat'),
      );
  }, [allowed, toSimple, flowId, router, params]);
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
  // Wait for the platform setting so the canvas does not flash for a workspace that only has the Simple builder.
  if (!allowed || toSimple || overview.isPending) return null;
  return <BuilderScreen flowId={flowId} />;
}
