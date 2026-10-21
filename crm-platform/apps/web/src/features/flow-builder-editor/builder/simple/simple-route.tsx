'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { flowsApi } from '../../api/flows';
import { FLB_KEYS } from '../../api/hooks';
import { SimpleScreen } from './simple-screen';

/**
 * `/flows/simple` and `/flows/simple/<id>`: refuses people without the read key (as the Advanced route does) and, when the
 * workspace builds in Advanced, sends the person to the Advanced canvas. A website chat bot stays here whatever the workspace uses.
 */
export function SimpleRoute({ flowId }: { flowId?: string }) {
  const allowed = useCan('flb.flows.read');
  const router = useRouter();
  const params = useSearchParams();
  const channel = params.get('type') === 'web' ? 'web' : 'chat';
  const overview = useQuery({
    queryKey: FLB_KEYS.overview,
    queryFn: ({ signal }) => flowsApi.overview(signal),
  });
  const mode = overview.data?.builderMode;
  // A bot (WhatsApp or website chat) stays here whatever the workspace uses; a saved flow's type decides, and a new one is a bot.
  // Only an Advanced workspace needs the type, and the Simple screen loads the same flow with the same options.
  const flow = useQuery({
    queryKey: FLB_KEYS.flow(flowId ?? ''),
    queryFn: ({ signal }) => flowsApi.get(flowId!, signal),
    enabled: !!flowId && mode === 'advanced',
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const isBot = flowId ? flow.data?.flowType === 'chat' || flow.data?.flowType === 'web' : true;
  // Until the workspace mode and a saved flow's type are known, wait rather than mount the Simple screen for a flow that may belong on the canvas.
  const deciding = !!flowId && (overview.isPending || (mode === 'advanced' && flow.isPending));
  const redirectToAdvanced = mode === 'advanced' && !isBot && !deciding;
  useEffect(() => {
    if (!allowed) router.replace('/inbox');
    else if (redirectToAdvanced && flowId) router.replace(`/flows/builder/${flowId}`);
  }, [allowed, redirectToAdvanced, flowId, router]);
  if (!allowed || redirectToAdvanced || deciding) return null;
  return <SimpleScreen flowId={flowId} channel={channel} />;
}
