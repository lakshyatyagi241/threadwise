'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useToast } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { flowsApi } from '../api/flows';
import { FLB_KEYS } from '../api/hooks';
import { FLASH_KEY } from '../components/flows-screen';
import { isSimpleBot, newHref } from '../lib/builder-mode';
import { BuilderScreen } from './builder-screen';

/**
 * The builder route: refuses people without the read key, and shows the one-time flash the list left (import, clone,
 * duplicate) the way Reference's redirect flash message does. When the platform admin offers only the Simple builder, a bot
 * (WhatsApp or website chat, see `isSimpleBot`) is sent to the Simple builder. A saved automation (a messaging flow built on the
 * canvas, a call flow) stays on the canvas, and so does "Generate with AI": they have no Simple version. The flow's own type and
 * builder decide, not the URL, so a link from the list never opens an automation in the Simple builder.
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
  const simpleOnly =
    overview.data?.builderMode === 'simple' &&
    params.get('type') !== 'call' &&
    !params.has('ai_prompt');
  const flow = useQuery({
    queryKey: FLB_KEYS.flow(flowId ?? ''),
    queryFn: ({ signal }) => flowsApi.get(flowId!, signal),
    enabled: !!flowId && simpleOnly,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
    retry: false,
  });
  // Until the saved flow's type and builder are known, wait rather than mount the canvas (or the Simple screen) for a bot.
  const deciding = simpleOnly && !!flowId && flow.isPending;
  // A failed load keeps the old answer for a Simple-only workspace: the Simple builder, which shows its own error.
  const toSimple =
    simpleOnly &&
    (!flowId ||
      flow.isError ||
      (!!flow.data && isSimpleBot(flow.data.flowType, flow.data.builder)));
  // Reference sends an agent or viewer to the team inbox instead of leaving them on a dead end.
  useEffect(() => {
    if (!allowed) router.replace('/inbox');
    else if (toSimple)
      router.replace(
        flowId ? `/flows/simple/${flowId}` : newHref(params.get('type') === 'web' ? 'web' : 'chat'),
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
  if (!allowed || toSimple || deciding || overview.isPending) return null;
  return <BuilderScreen flowId={flowId} />;
}
